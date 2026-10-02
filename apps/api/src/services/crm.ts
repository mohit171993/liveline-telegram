import { prisma } from "@liveline/db";
import type { Prisma } from "@prisma/client";
import { formatIst } from "@liveline/shared";
import { miniAppLink } from "../env";
import { redis } from "../redis";
import { isBlocked, tgCall } from "../telegram";
import { httpError } from "../httpError";
import { maskPhone } from "./automation";

/* ------------------------------------------------------------------ filters */

export interface CrmFilter {
  q?: string;
  verified?: "yes" | "no" | "any";
  source?: string; // exact tag, "direct", "referral", "group", "squad" or prefix with trailing *
  language?: string;
  joinedFrom?: string; // YYYY-MM-DD (IST)
  joinedTo?: string;
  activeWithinDays?: number;
  inactiveDays?: number;
  minPoints?: number;
  predicted?: "yes" | "no";
  tag?: string;
  reachable?: "yes";
  sort?: "joined" | "active" | "points";
}

const DAY = 24 * 3600_000;

function istStart(day: string): Date {
  return new Date(`${day}T00:00:00+05:30`);
}

export function parseFilter(input: unknown): CrmFilter {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof raw[k] === "string" && String(raw[k]).trim() ? String(raw[k]).trim().slice(0, 80) : undefined);
  const num = (k: string) => (raw[k] !== undefined && raw[k] !== "" && Number.isFinite(Number(raw[k])) ? Number(raw[k]) : undefined);
  const pick = <T extends string>(k: string, ok: readonly T[]) => (ok as readonly string[]).includes(String(raw[k])) ? (String(raw[k]) as T) : undefined;
  return {
    q: str("q"),
    verified: pick("verified", ["yes", "no", "any"] as const),
    source: str("source"),
    language: str("language"),
    joinedFrom: str("joinedFrom")?.match(/^\d{4}-\d{2}-\d{2}$/) ? str("joinedFrom") : undefined,
    joinedTo: str("joinedTo")?.match(/^\d{4}-\d{2}-\d{2}$/) ? str("joinedTo") : undefined,
    activeWithinDays: num("activeWithinDays"),
    inactiveDays: num("inactiveDays"),
    minPoints: num("minPoints"),
    predicted: pick("predicted", ["yes", "no"] as const),
    tag: str("tag"),
    reachable: raw.reachable === "yes" || raw.reachable === true ? "yes" : undefined,
    sort: pick("sort", ["joined", "active", "points"] as const),
  };
}

export function sourceBucket(startParam?: string | null): string {
  const p = (startParam || "").trim();
  if (!p) return "direct";
  if (/^ref_?\d+$/.test(p)) return "referral";
  if (p.startsWith("grp_")) return "group";
  if (p.startsWith("sq_")) return "squad";
  if (/^(match|predict|lino)_/.test(p) || /^(live|predict|spin|board|alerts|lino|buddy|home|play|pass|admin|rewards|leaderboard|reminders)$/.test(p)) return "deeplink";
  if (/^[br]_/.test(p)) return "message";
  if (p.startsWith("web_")) return "website";
  return p.slice(0, 64);
}

export function crmWhere(f: CrmFilter): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [{ isDemo: false }];
  if (f.q) {
    const q = f.q.replace(/^@/, "");
    and.push({
      OR: [
        { telegramId: { contains: q } },
        { username: { contains: q, mode: "insensitive" } },
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (f.verified === "yes") and.push({ phoneVerifiedAt: { not: null } });
  if (f.verified === "no") and.push({ phoneVerifiedAt: null });
  if (f.source) {
    const s = f.source;
    if (s === "direct") and.push({ OR: [{ startParam: null }, { startParam: "" }] });
    else if (s === "referral") and.push({ startParam: { startsWith: "ref" } });
    else if (s === "group") and.push({ startParam: { startsWith: "grp_" } });
    else if (s === "squad") and.push({ startParam: { startsWith: "sq_" } });
    else if (s.endsWith("*")) and.push({ startParam: { startsWith: s.slice(0, -1) } });
    else and.push({ startParam: s });
  }
  if (f.language) and.push({ languageCode: f.language });
  if (f.joinedFrom) and.push({ createdAt: { gte: istStart(f.joinedFrom) } });
  if (f.joinedTo) and.push({ createdAt: { lt: new Date(istStart(f.joinedTo).getTime() + DAY) } });
  if (f.activeWithinDays) and.push({ lastSeenAt: { gte: new Date(Date.now() - f.activeWithinDays * DAY) } });
  if (f.inactiveDays) and.push({ OR: [{ lastSeenAt: { lt: new Date(Date.now() - f.inactiveDays * DAY) } }, { lastSeenAt: null }] });
  if (f.minPoints !== undefined) and.push({ points: { gte: f.minPoints } });
  if (f.predicted === "yes") and.push({ predictions: { some: {} } });
  if (f.predicted === "no") and.push({ predictions: { none: {} } });
  if (f.reachable === "yes") and.push({ optOut: false, botBlockedAt: null, blockedAt: null, NOT: { telegramId: { startsWith: "web:" } } });
  return { AND: and };
}

async function withTags<T extends { id: string }>(rows: T[]) {
  const tags = rows.length ? await prisma.crmTag.findMany({ where: { userId: { in: rows.map((r) => r.id) } } }) : [];
  const map = new Map<string, string[]>();
  for (const t of tags) map.set(t.userId, [...(map.get(t.userId) || []), t.tag]);
  return map;
}

async function tagFilterIds(f: CrmFilter): Promise<string[] | null> {
  if (!f.tag) return null;
  const rows = await prisma.crmTag.findMany({ where: { tag: f.tag.toLowerCase() }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

async function fullWhere(f: CrmFilter): Promise<Prisma.UserWhereInput> {
  const where = crmWhere(f);
  const ids = await tagFilterIds(f);
  if (ids) (where.AND as Prisma.UserWhereInput[]).push({ id: { in: ids } });
  return where;
}

function orderOf(f: CrmFilter): Prisma.UserOrderByWithRelationInput[] {
  if (f.sort === "active") return [{ lastSeenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];
  if (f.sort === "points") return [{ points: "desc" }, { createdAt: "desc" }];
  return [{ createdAt: "desc" }];
}

export async function listCrmUsers(f: CrmFilter, page = 0, size = 50) {
  const where = await fullWhere(f);
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: orderOf(f),
      skip: Math.max(0, page) * size,
      take: Math.min(200, size),
      include: { _count: { select: { predictions: true, spins: true } } },
    }),
  ]);
  const tags = await withTags(rows);
  return {
    total,
    page,
    size,
    users: rows.map((u) => ({
      id: u.id,
      telegramId: u.telegramId,
      username: u.username,
      name: [u.firstName, u.lastName].filter(Boolean).join(" "),
      language: u.languageCode,
      verified: Boolean(u.phoneVerifiedAt),
      status: u.status,
      source: u.startParam || "",
      bucket: sourceBucket(u.startParam),
      points: u.points,
      predictions: u._count.predictions,
      spins: u._count.spins,
      joinedAt: u.createdAt.toISOString(),
      lastSeenAt: u.lastSeenAt?.toISOString() || null,
      optOut: u.optOut,
      botBlocked: Boolean(u.botBlockedAt),
      banned: Boolean(u.blockedAt) || u.status === "BLOCKED",
      premium: u.isPremium,
      tags: tags.get(u.id) || [],
    })),
  };
}

export async function filterOptions() {
  const [langs, sources, tags] = await Promise.all([
    prisma.user.groupBy({ by: ["languageCode"], where: { isDemo: false }, _count: { _all: true } }),
    prisma.user.groupBy({ by: ["startParam"], where: { isDemo: false }, _count: { _all: true } }),
    prisma.crmTag.groupBy({ by: ["tag"], _count: { _all: true } }),
  ]);
  const buckets = new Map<string, number>();
  for (const s of sources) {
    const b = sourceBucket(s.startParam);
    buckets.set(b, (buckets.get(b) || 0) + s._count._all);
  }
  return {
    languages: langs.map((l) => ({ value: l.languageCode, count: l._count._all })),
    sources: [...buckets.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count })),
    tags: tags.map((t) => ({ value: t.tag, count: t._count._all })),
  };
}

/* ------------------------------------------------------------------ profile */

export async function crmProfile(id: string) {
  const user = await prisma.user.findFirst({ where: { OR: [{ id }, { telegramId: id }] } });
  if (!user) throw httpError(404, "NOT_FOUND");
  const [tags, notes, preds, spins, sessions, deliveries, autos, predCount, correct, firstPred] = await Promise.all([
    prisma.crmTag.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.crmNote.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.prediction.findMany({ where: { userId: user.id }, orderBy: { lockedAt: "desc" }, take: 30 }),
    prisma.spin.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.session.findMany({ where: { userId: user.id }, orderBy: { startedAt: "desc" }, take: 30 }),
    prisma.broadcastDelivery.findMany({ where: { userId: user.id }, orderBy: { sentAt: "desc" }, take: 20, include: { broadcast: { select: { text: true } } } }),
    prisma.autoSend.findMany({ where: { userId: user.id }, orderBy: { sentAt: "desc" }, take: 30 }),
    prisma.prediction.count({ where: { userId: user.id } }),
    prisma.prediction.count({ where: { userId: user.id, correct: true } }),
    prisma.prediction.findFirst({ where: { userId: user.id }, orderBy: { lockedAt: "asc" } }),
  ]);
  type Ev = { at: string; kind: string; text: string };
  const tl: Ev[] = [];
  tl.push({ at: user.createdAt.toISOString(), kind: "start", text: `Started the bot${user.startParam ? ` via ${user.startParam}` : ""}` });
  if (user.phoneVerifiedAt) tl.push({ at: user.phoneVerifiedAt.toISOString(), kind: "verify", text: "Verified phone" });
  if (user.termsAcceptedAt) tl.push({ at: user.termsAcceptedAt.toISOString(), kind: "terms", text: "Accepted terms" });
  if (firstPred) tl.push({ at: firstPred.lockedAt.toISOString(), kind: "first_prediction", text: `First prediction (${firstPred.kind})` });
  for (const p of preds) tl.push({ at: p.lockedAt.toISOString(), kind: "prediction", text: `Predicted ${p.kind}: ${p.pick}${p.correct === true ? ` ✓ +${p.points}` : p.correct === false ? " ✗" : ""}` });
  for (const s of spins) tl.push({ at: s.createdAt.toISOString(), kind: "spin", text: `Spin (${s.source}): ${s.result}` });
  for (const s of sessions) tl.push({ at: s.startedAt.toISOString(), kind: "session", text: `Opened the app${s.matchKey ? ` · ${s.matchKey}` : ""}` });
  for (const d of deliveries) if (d.sentAt) tl.push({ at: d.sentAt.toISOString(), kind: "broadcast", text: `Broadcast ${d.status}${d.openedAt ? " · opened" : ""}: ${d.broadcast.text.slice(0, 60)}` });
  for (const a of autos) tl.push({ at: a.sentAt.toISOString(), kind: "auto", text: `Auto ${a.ruleKey}${a.step ? ` #${a.step + 1}` : ""}: ${a.status}${a.openedAt ? " · opened" : ""}` });
  for (const n of notes) tl.push({ at: n.createdAt.toISOString(), kind: "note", text: `Note by ${n.actorName || "admin"}: ${n.body.slice(0, 80)}` });
  tl.sort((a, b) => b.at.localeCompare(a.at));
  return {
    user: {
      id: user.id,
      telegramId: user.telegramId,
      username: user.username,
      name: [user.firstName, user.lastName].filter(Boolean).join(" "),
      language: user.languageCode,
      phone: maskPhone(user.phone),
      verified: Boolean(user.phoneVerifiedAt),
      verifiedAt: user.phoneVerifiedAt?.toISOString() || null,
      status: user.status,
      ageStatus: user.ageStatus,
      source: user.startParam || "",
      bucket: sourceBucket(user.startParam),
      points: user.points,
      xp: user.xp,
      streak: user.dailyStreak,
      leagueTier: user.leagueTier,
      referrals: user.referralCount,
      premium: user.isPremium,
      joinedAt: user.createdAt.toISOString(),
      lastSeenAt: user.lastSeenAt?.toISOString() || null,
      optOut: user.optOut,
      botBlocked: Boolean(user.botBlockedAt),
      banned: Boolean(user.blockedAt) || user.status === "BLOCKED",
    },
    stats: { predictions: predCount, correct, accuracy: predCount ? Math.round((correct / predCount) * 100) : 0, spins: spins.length, sessions: sessions.length },
    tags: tags.map((t) => t.tag),
    notes: notes.map((n) => ({ id: n.id, body: n.body, by: n.actorName, at: n.createdAt.toISOString() })),
    timeline: tl.slice(0, 120),
  };
}

function cleanTag(tag: string): string {
  const t = tag.trim().toLowerCase().replace(/[^a-z0-9_\- ]/g, "").replace(/\s+/g, "-").slice(0, 32);
  if (!t) throw httpError(400, "BAD_TAG", "Tags use letters, numbers, - and _.");
  return t;
}

export async function addTag(userId: string, tag: string, actor?: string) {
  const t = cleanTag(tag);
  await prisma.crmTag.upsert({ where: { userId_tag: { userId, tag: t } }, update: {}, create: { userId, tag: t, createdBy: actor || null } });
  return { ok: true, tag: t };
}

export async function removeTag(userId: string, tag: string) {
  await prisma.crmTag.deleteMany({ where: { userId, tag: tag.toLowerCase() } });
  return { ok: true };
}

export async function bulkTag(filter: CrmFilter, tag: string, actor?: string) {
  const t = cleanTag(tag);
  const ids = (await prisma.user.findMany({ where: await fullWhere(filter), select: { id: true }, take: 20_000 })).map((u) => u.id);
  await prisma.crmTag.createMany({ data: ids.map((userId) => ({ userId, tag: t, createdBy: actor || null })), skipDuplicates: true });
  return { ok: true, tag: t, count: ids.length };
}

export async function addNote(userId: string, body: string, actor: { id?: string; name?: string }) {
  const text = body.trim().slice(0, 2000);
  if (!text) throw httpError(400, "EMPTY");
  const note = await prisma.crmNote.create({ data: { userId, body: text, actorId: actor.id || null, actorName: actor.name || null } });
  return { id: note.id };
}

/* ------------------------------------------------------------------ segments */

export async function listSegments() {
  const rows = await prisma.crmSegment.findMany({ orderBy: { updatedAt: "desc" } });
  const out = [];
  for (const r of rows) {
    let filter: CrmFilter = {};
    try { filter = parseFilter(JSON.parse(r.filter)); } catch { /* keep empty */ }
    const count = await prisma.user.count({ where: await fullWhere(filter) });
    out.push({ id: r.id, name: r.name, filter, count, updatedAt: r.updatedAt.toISOString() });
  }
  return out;
}

export async function saveSegment(input: { id?: string; name: string; filter?: unknown }, actor?: string) {
  const name = String(input.name || "").trim().slice(0, 60);
  if (!name) throw httpError(400, "NO_NAME", "Give the segment a name.");
  const filter = JSON.stringify(parseFilter(input.filter));
  if (input.id) return prisma.crmSegment.update({ where: { id: input.id }, data: { name, filter } });
  return prisma.crmSegment.create({ data: { name, filter, createdBy: actor || null } });
}

export async function deleteSegment(id: string) {
  await prisma.crmSegment.delete({ where: { id } }).catch(() => undefined);
  return { ok: true };
}

/* ------------------------------------------------------------------ funnel & attribution */

async function cohort(days: number, source?: string) {
  const since = new Date(Date.now() - Math.max(1, Math.min(365, days)) * DAY);
  const where = crmWhere({ source });
  (where.AND as Prisma.UserWhereInput[]).push({ createdAt: { gte: since } });
  return prisma.user.findMany({ where, select: { id: true, createdAt: true, phoneVerifiedAt: true, startParam: true } });
}

async function engagement(ids: string[]) {
  if (!ids.length) return { predicted: new Set<string>(), returned: new Set<string>() };
  const predicted = new Set((await prisma.prediction.groupBy({ by: ["userId"], where: { userId: { in: ids } } })).map((r) => r.userId));
  // Returned: any app session at least 24h after the user first joined.
  const sessions = await prisma.session.findMany({ where: { userId: { in: ids } }, select: { userId: true, startedAt: true } });
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, createdAt: true } });
  const joined = new Map(users.map((u) => [u.id, u.createdAt.getTime()]));
  const returned = new Set<string>();
  for (const s of sessions) if (s.startedAt.getTime() - (joined.get(s.userId) || 0) >= DAY) returned.add(s.userId);
  return { predicted, returned };
}

export async function funnel(days = 30, source?: string) {
  const users = await cohort(days, source);
  const ids = users.map((u) => u.id);
  const { predicted, returned } = await engagement(ids);
  const verified = users.filter((u) => u.phoneVerifiedAt).length;
  const steps = [
    { key: "start", label: "Started", count: users.length },
    { key: "verify", label: "Verified phone", count: verified },
    { key: "first_prediction", label: "First prediction", count: predicted.size },
    { key: "return", label: "Came back (24h+)", count: returned.size },
  ];
  return { days, source: source || null, steps: steps.map((s, i) => ({ ...s, pct: users.length ? Math.round((s.count / users.length) * 100) : 0, step: i === 0 || !steps[i - 1].count ? 100 : Math.round((s.count / steps[i - 1].count) * 100) })) };
}

export async function attribution(days = 30) {
  const users = await cohort(days);
  const ids = users.map((u) => u.id);
  const { predicted, returned } = await engagement(ids);
  const map = new Map<string, { source: string; started: number; verified: number; predicted: number; returned: number }>();
  for (const u of users) {
    const key = sourceBucket(u.startParam);
    const row = map.get(key) || { source: key, started: 0, verified: 0, predicted: 0, returned: 0 };
    row.started += 1;
    if (u.phoneVerifiedAt) row.verified += 1;
    if (predicted.has(u.id)) row.predicted += 1;
    if (returned.has(u.id)) row.returned += 1;
    map.set(key, row);
  }
  const rows = [...map.values()].sort((a, b) => b.started - a.started).map((r) => ({
    ...r,
    verifyRate: r.started ? Math.round((r.verified / r.started) * 100) : 0,
    predictRate: r.started ? Math.round((r.predicted / r.started) * 100) : 0,
    returnRate: r.started ? Math.round((r.returned / r.started) * 100) : 0,
  }));
  return { days, rows };
}

/* ------------------------------------------------------------------ CSV */

function cell(value: unknown): string {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // no spreadsheet formulas
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(head: string[], rows: unknown[][]): string {
  return `\ufeff${[head, ...rows].map((r) => r.map(cell).join(",")).join("\n")}\n`;
}

export async function crmCsv(f: CrmFilter): Promise<string> {
  const head = ["telegram_id", "username", "name", "language", "verified", "status", "source", "source_bucket", "points", "predictions", "spins", "joined_ist", "last_seen_ist", "opted_out", "bot_blocked", "tags"];
  const rows: unknown[][] = [];
  for (let page = 0; page < 200; page++) {
    const chunk = await listCrmUsers(f, page, 200);
    for (const u of chunk.users) {
      rows.push([u.telegramId, u.username || "", u.name, u.language, u.verified ? "yes" : "no", u.status, u.source, u.bucket, u.points, u.predictions, u.spins,
        formatIst(new Date(u.joinedAt)), u.lastSeenAt ? formatIst(new Date(u.lastSeenAt)) : "", u.optOut ? "yes" : "no", u.botBlocked ? "yes" : "no", u.tags.join(" ")]);
    }
    if (chunk.users.length < 200) break;
  }
  return toCsv(head, rows);
}

/* ------------------------------------------------------------------ messaging helpers */

const ALLOWED_TAGS = /&lt;(\/?)(b|i|u|s|code|blockquote)&gt;/g;
/** Admin copy → safe Telegram HTML: everything escaped except <b> <i> <u> <s> <code> <blockquote>. */
export function safeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(ALLOWED_TAGS, "<$1$2>");
}

export const BUTTON_TARGETS = ["home", "live", "predict", "spin", "board", "alerts", "lino", "play", "pass"] as const;

export function trackedLink(prefix: "b" | "r", id: string, target: string): string {
  const t = (BUTTON_TARGETS as readonly string[]).includes(target) ? target : "home";
  return miniAppLink(`${prefix}_${id}__${t}`);
}

/** startapp=b_<broadcastId>__<target> / r_<autoSendId>__<target>: record the open, return the screen. */
export async function trackOpen(param: string, userId: string): Promise<{ target: string | null }> {
  const m = param.match(/^([br])_([a-z0-9]{10,40})__([a-z]+)$/i);
  if (!m) return { target: null };
  const [, kind, id, target] = m;
  if (kind === "b") {
    const hit = await prisma.broadcastDelivery.updateMany({ where: { broadcastId: id, userId, openedAt: null }, data: { openedAt: new Date() } });
    if (hit.count) await prisma.broadcast.update({ where: { id }, data: { opened: { increment: 1 } } }).catch(() => undefined);
  } else {
    await prisma.autoSend.updateMany({ where: { id, userId, openedAt: null }, data: { openedAt: new Date() } });
  }
  return { target };
}

/* ------------------------------------------------------------------ broadcasts */

export interface BroadcastInput {
  text: string;
  buttonText?: string;
  buttonParam?: string;
  filter?: unknown;
  segmentName?: string;
  scheduledAt?: string | null;
}

function audienceFilter(raw: unknown): CrmFilter {
  const f = parseFilter(raw);
  return { ...f, verified: f.verified || "yes", reachable: "yes" };
}

export async function audienceCount(raw: unknown) {
  const f = audienceFilter(raw);
  const where = await fullWhere(f);
  const [count, optedOut, blocked] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.count({ where: await fullWhere({ ...f, reachable: undefined }) }).then(async (all) => all - (await prisma.user.count({ where }))),
    prisma.user.count({ where: { botBlockedAt: { not: null }, isDemo: false } }),
  ]);
  return { count, excluded: optedOut, blockedTotal: blocked };
}

function renderBroadcast(b: { id: string; text: string; buttonText: string | null; buttonParam: string | null }) {
  const markup = b.buttonText ? { inline_keyboard: [[{ text: b.buttonText.slice(0, 40), url: trackedLink("b", b.id, b.buttonParam || "home") }]] } : undefined;
  return { text: safeHtml(b.text), markup };
}

function validateInput(input: BroadcastInput) {
  const text = String(input.text || "").trim();
  if (text.length < 3) throw httpError(400, "TEXT_SHORT", "Write a message first.");
  if (text.length > 3500) throw httpError(400, "TEXT_LONG", "Keep it under 3,500 characters.");
  if (/\b(bet|betting|odds|wager|casino|deposit)\b/i.test(text)) {
    throw httpError(400, "NO_BETTING", "LiveLine is free-to-play: no betting, odds or deposit language.");
  }
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) throw httpError(400, "BAD_TIME");
  return { text, scheduledAt };
}

export async function createBroadcast(input: BroadcastInput, actor: string) {
  const { text, scheduledAt } = validateInput(input);
  const filter = audienceFilter(input.filter);
  const { count } = await audienceCount(filter);
  const b = await prisma.broadcast.create({
    data: {
      text,
      buttonText: input.buttonText?.trim() || null,
      buttonParam: input.buttonText ? (BUTTON_TARGETS as readonly string[]).includes(String(input.buttonParam)) ? String(input.buttonParam) : "home" : null,
      filter: JSON.stringify(filter),
      segmentName: input.segmentName?.slice(0, 60) || null,
      scheduledAt,
      createdBy: actor,
      total: count,
    },
  });
  return presentBroadcast(b);
}

export async function updateBroadcast(id: string, input: BroadcastInput) {
  const cur = await prisma.broadcast.findUnique({ where: { id } });
  if (!cur) throw httpError(404, "NOT_FOUND");
  if (cur.status !== "draft") throw httpError(409, "LOCKED", "Only drafts can be edited.");
  const { text, scheduledAt } = validateInput(input);
  const filter = audienceFilter(input.filter);
  const { count } = await audienceCount(filter);
  const b = await prisma.broadcast.update({
    where: { id },
    data: {
      text,
      buttonText: input.buttonText?.trim() || null,
      buttonParam: input.buttonText ? (BUTTON_TARGETS as readonly string[]).includes(String(input.buttonParam)) ? String(input.buttonParam) : "home" : null,
      filter: JSON.stringify(filter),
      segmentName: input.segmentName?.slice(0, 60) || null,
      scheduledAt,
      total: count,
    },
  });
  return presentBroadcast(b);
}

function presentBroadcast(b: Prisma.BroadcastGetPayload<object>) {
  let filter: CrmFilter = {};
  try { filter = JSON.parse(b.filter); } catch { /* empty */ }
  return {
    id: b.id,
    text: b.text,
    html: safeHtml(b.text),
    buttonText: b.buttonText,
    buttonParam: b.buttonParam,
    filter,
    segmentName: b.segmentName,
    status: b.status,
    scheduledAt: b.scheduledAt?.toISOString() || null,
    createdBy: b.createdBy,
    confirmedBy: b.confirmedBy,
    confirmedAt: b.confirmedAt?.toISOString() || null,
    startedAt: b.startedAt?.toISOString() || null,
    finishedAt: b.finishedAt?.toISOString() || null,
    total: b.total,
    sent: b.sent,
    failed: b.failed,
    blocked: b.blocked,
    opened: b.opened,
    openRate: b.sent ? Math.round((b.opened / b.sent) * 100) : 0,
    createdAt: b.createdAt.toISOString(),
  };
}

export async function listBroadcasts() {
  const rows = await prisma.broadcast.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map(presentBroadcast);
}

export async function getBroadcast(id: string) {
  const b = await prisma.broadcast.findUnique({ where: { id } });
  if (!b) throw httpError(404, "NOT_FOUND");
  const byStatus = await prisma.broadcastDelivery.groupBy({ by: ["status"], where: { broadcastId: id }, _count: { _all: true } });
  return { ...presentBroadcast(b), deliveries: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])) };
}

/** Test-send to the admin's own DM. Does not count, does not change status. */
export async function testBroadcast(id: string, adminTelegramId: string) {
  const b = await prisma.broadcast.findUnique({ where: { id } });
  if (!b) throw httpError(404, "NOT_FOUND");
  const { text, markup } = renderBroadcast(b);
  const res = await tgCall("sendMessage", { chat_id: adminTelegramId, text: `🧪 <b>Test (only you got this)</b>\n\n${text}`, parse_mode: "HTML", disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) });
  if (!res.ok) throw httpError(400, "TEST_FAILED", res.description || "Telegram rejected the test message. Start the bot first.");
  return { ok: true };
}

/** Explicit admin confirmation is the ONLY way a broadcast leaves draft. Nothing auto-sends. */
export async function confirmBroadcast(id: string, actor: string, expectTotal?: number) {
  const b = await prisma.broadcast.findUnique({ where: { id } });
  if (!b) throw httpError(404, "NOT_FOUND");
  if (b.status !== "draft") throw httpError(409, "NOT_DRAFT", "This broadcast was already confirmed.");
  const { count } = await audienceCount(JSON.parse(b.filter || "{}"));
  if (!count) throw httpError(400, "EMPTY_AUDIENCE", "No reachable users match this audience.");
  if (expectTotal !== undefined && Math.abs(expectTotal - count) > Math.max(5, count * 0.1)) {
    throw httpError(409, "AUDIENCE_CHANGED", `Audience is now ${count}. Review and confirm again.`);
  }
  const updated = await prisma.broadcast.update({
    where: { id },
    data: { status: "scheduled", confirmedBy: actor, confirmedAt: new Date(), total: count, scheduledAt: b.scheduledAt || new Date() },
  });
  return presentBroadcast(updated);
}

export async function cancelBroadcast(id: string) {
  const b = await prisma.broadcast.findUnique({ where: { id } });
  if (!b) throw httpError(404, "NOT_FOUND");
  if (b.status === "done") throw httpError(409, "DONE");
  const updated = await prisma.broadcast.update({ where: { id }, data: { status: b.status === "sending" ? "cancelled" : "cancelled", finishedAt: new Date() } });
  await prisma.broadcastDelivery.updateMany({ where: { broadcastId: id, status: "queued" }, data: { status: "cancelled" } });
  return presentBroadcast(updated);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RATE_PER_SEC = 20;

/** Worker loop: deliver due, confirmed broadcasts at ~20 msg/s, honouring 429 retry_after. */
export async function runBroadcasts(): Promise<void> {
  const lock = await redis.set("ll:bcast:lock", String(process.pid), "PX", 120_000, "NX");
  if (!lock) return;
  try {
    const due = await prisma.broadcast.findMany({
      where: { OR: [{ status: "scheduled", scheduledAt: { lte: new Date() } }, { status: "sending" }] },
      orderBy: { scheduledAt: "asc" },
      take: 3,
    });
    for (const b of due) {
      if (b.status === "scheduled") {
        const users = await prisma.user.findMany({ where: await fullWhere(audienceFilter(JSON.parse(b.filter || "{}"))), select: { id: true, telegramId: true }, take: 200_000 });
        await prisma.broadcastDelivery.createMany({ data: users.map((u) => ({ broadcastId: b.id, userId: u.id, telegramId: u.telegramId })), skipDuplicates: true });
        await prisma.broadcast.update({ where: { id: b.id }, data: { status: "sending", startedAt: new Date(), total: users.length } });
      }
      const { text, markup } = renderBroadcast(b);
      const started = Date.now();
      for (;;) {
        if (Date.now() - started > 100_000) { await redis.pexpire("ll:bcast:lock", 120_000); break; }
        const fresh = await prisma.broadcast.findUnique({ where: { id: b.id }, select: { status: true } });
        if (fresh?.status !== "sending") break;
        const batch = await prisma.broadcastDelivery.findMany({ where: { broadcastId: b.id, status: "queued" }, take: RATE_PER_SEC });
        if (!batch.length) {
          const counts = await prisma.broadcastDelivery.groupBy({ by: ["status"], where: { broadcastId: b.id }, _count: { _all: true } });
          const c = Object.fromEntries(counts.map((r) => [r.status, r._count._all]));
          await prisma.broadcast.update({ where: { id: b.id }, data: { status: "done", finishedAt: new Date(), sent: c.sent || 0, failed: c.failed || 0, blocked: c.blocked || 0 } });
          break;
        }
        const tick = Date.now();
        for (const d of batch) {
          const user = await prisma.user.findUnique({ where: { id: d.userId }, select: { optOut: true, botBlockedAt: true, blockedAt: true } });
          if (!user || user.optOut || user.botBlockedAt || user.blockedAt || d.telegramId.startsWith("web:")) {
            await prisma.broadcastDelivery.update({ where: { id: d.id }, data: { status: "skipped" } });
            continue;
          }
          let res = await tgCall("sendMessage", { chat_id: d.telegramId, text, parse_mode: "HTML", disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) });
          if (!res.ok && res.code === 429) {
            await sleep(((res.retryAfter || 3) + 1) * 1000);
            res = await tgCall("sendMessage", { chat_id: d.telegramId, text, parse_mode: "HTML", disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) });
          }
          if (res.ok) {
            await prisma.broadcastDelivery.update({ where: { id: d.id }, data: { status: "sent", messageId: res.messageId, sentAt: new Date() } });
            await prisma.broadcast.update({ where: { id: b.id }, data: { sent: { increment: 1 } } });
          } else if (isBlocked(res)) {
            await prisma.broadcastDelivery.update({ where: { id: d.id }, data: { status: "blocked", error: res.description, sentAt: new Date() } });
            await prisma.broadcast.update({ where: { id: b.id }, data: { blocked: { increment: 1 } } });
            await prisma.user.update({ where: { id: d.userId }, data: { botBlockedAt: new Date() } }).catch(() => undefined);
          } else {
            await prisma.broadcastDelivery.update({ where: { id: d.id }, data: { status: "failed", error: res.description, sentAt: new Date() } });
            await prisma.broadcast.update({ where: { id: b.id }, data: { failed: { increment: 1 } } });
          }
        }
        const spent = Date.now() - tick;
        if (spent < 1000) await sleep(1000 - spent);
      }
    }
  } finally {
    await redis.del("ll:bcast:lock").catch(() => undefined);
  }
}

/** Bot shortcut: /admin find @handle | id */
export async function findUserBrief(query: string) {
  const q = query.trim().replace(/^@/, "");
  if (!q) return null;
  const user = await prisma.user.findFirst({
    where: { OR: [{ telegramId: q }, { username: { equals: q, mode: "insensitive" } }] },
    include: { _count: { select: { predictions: true, spins: true } } },
  });
  if (!user) return null;
  const tags = await prisma.crmTag.findMany({ where: { userId: user.id } });
  return { user, tags: tags.map((t) => t.tag) };
}
