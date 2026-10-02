import { prisma } from "@liveline/db";
import nodeCrypto from "node:crypto";
import { z } from "zod";
import { env } from "../env";
import { httpError } from "../httpError";

/** Sponsor buttons: admin-managed, first full-width button in the verified /start grid + Home banner. */
export const MAX_ACTIVE_SPONSORS = 3;
export const SPONSOR_STYLES = ["success", "primary", "danger", "default"] as const;
export type SponsorStyle = (typeof SPONSOR_STYLES)[number];

export const sponsorInput = z.object({
  text: z.string().trim().min(2).max(40),
  emoji: z.string().trim().max(8).default(""),
  style: z.enum(SPONSOR_STYLES).default("success"),
  url: z.string().trim().url().max(500),
  enabled: z.boolean().default(false),
  target: z.enum(["verified", "all"]).default("verified"),
  startsAt: z.string().datetime({ offset: true }).nullish(),
  endsAt: z.string().datetime({ offset: true }).nullish(),
  sort: z.number().int().min(0).max(99).default(0),
});
export type SponsorInput = z.infer<typeof sponsorInput>;

type Sponsor = Awaited<ReturnType<typeof prisma.sponsorButton.findMany>>[number];

function isPrivateHost(host: string) {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".railway.internal")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return h.includes(":") || h.startsWith("[");
}

function checkUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { throw httpError(400, "BAD_URL", "Enter a full https:// link."); }
  if (u.protocol !== "https:") throw httpError(400, "BAD_URL", "The link must start with https://");
  if (isPrivateHost(u.hostname)) throw httpError(400, "BAD_URL", "That link points to a private address.");
  return u.toString();
}

function hostMatches(source: string, origin: URL) {
  const s = source.replace(/\/$/, "").toLowerCase();
  if (s === "*" || s === "https:") return true;
  const m = s.match(/^(https?:\/\/)?(\*\.)?([^/:]+)(:\d+)?$/);
  if (!m) return false;
  const host = origin.hostname.toLowerCase();
  return m[2] ? host.endsWith(`.${m[3]}`) : host === m[3];
}

/** Can our Mini App iframe this page? Checks X-Frame-Options and CSP frame-ancestors. */
export async function frameCheck(url: string): Promise<{ frameable: boolean; note: string }> {
  const origin = new URL(env.webappUrl);
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(7000), headers: { "user-agent": "Mozilla/5.0 (LiveLinePro sponsor check)" } });
    res.body?.cancel().catch(() => undefined);
    const xfo = (res.headers.get("x-frame-options") || "").trim().toUpperCase();
    const csp = res.headers.get("content-security-policy") || "";
    const fa = csp.split(";").map((d) => d.trim()).find((d) => d.toLowerCase().startsWith("frame-ancestors"));
    if (fa) {
      const sources = fa.split(/\s+/).slice(1);
      const ok = sources.some((s) => hostMatches(s, origin));
      return ok ? { frameable: true, note: "" } : { frameable: false, note: `Site blocks embedding (CSP ${fa.slice(0, 80)}). It will open in Telegram's in-app browser instead.` };
    }
    if (xfo === "DENY" || xfo === "SAMEORIGIN" || xfo.startsWith("ALLOW-FROM")) {
      return { frameable: false, note: `Site blocks embedding (X-Frame-Options: ${xfo}). It will open in Telegram's in-app browser instead.` };
    }
    if (res.status >= 400) return { frameable: false, note: `Site answered HTTP ${res.status}. It will open in Telegram's in-app browser instead.` };
    return { frameable: true, note: "" };
  } catch {
    return { frameable: false, note: "Could not reach the site to check embedding. It will open in Telegram's in-app browser instead." };
  }
}

const isLive = (s: Sponsor, now = new Date()) => s.enabled && (!s.startsAt || s.startsAt <= now) && (!s.endsAt || s.endsAt > now);

async function assertActiveLimit(excludeId?: string) {
  const live = await prisma.sponsorButton.count({ where: { enabled: true, ...(excludeId ? { id: { not: excludeId } } : {}) } });
  if (live >= MAX_ACTIVE_SPONSORS) throw httpError(400, "TOO_MANY", `Only ${MAX_ACTIVE_SPONSORS} sponsor buttons can be on at once. Turn one off first.`);
}

function toData(input: SponsorInput) {
  if (input.startsAt && input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) throw httpError(400, "BAD_SCHEDULE", "The end time must be after the start time.");
  return {
    text: input.text, emoji: input.emoji, style: input.style, url: checkUrl(input.url), enabled: input.enabled, target: input.target,
    startsAt: input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt ? new Date(input.endsAt) : null, sort: input.sort,
  };
}

export async function createSponsor(input: SponsorInput, actor: string) {
  const data = toData(input);
  if (data.enabled) await assertActiveLimit();
  const frame = await frameCheck(data.url);
  const row = await prisma.sponsorButton.create({ data: { ...data, frameable: frame.frameable, frameNote: frame.note, createdBy: actor } });
  bust();
  return row;
}

export async function updateSponsor(id: string, input: SponsorInput) {
  const before = await prisma.sponsorButton.findUnique({ where: { id } });
  if (!before) throw httpError(404, "NOT_FOUND", "Sponsor not found.");
  const data = toData(input);
  if (data.enabled && !before.enabled) await assertActiveLimit(id);
  const frame = data.url !== before.url || !before.frameable ? await frameCheck(data.url) : { frameable: before.frameable, note: before.frameNote };
  const row = await prisma.sponsorButton.update({ where: { id }, data: { ...data, frameable: frame.frameable, frameNote: frame.note } });
  bust();
  return row;
}

export async function deleteSponsor(id: string) {
  await prisma.sponsorButton.delete({ where: { id } }).catch(() => undefined);
  bust();
  return { ok: true };
}

const DAY = 86400000;
async function tapStats(ids: string[]) {
  if (!ids.length) return new Map<string, { total: number; d1: number; d7: number; uniq: number; bot: number; home: number }>();
  const now = Date.now();
  const taps = await prisma.sponsorTap.findMany({ where: { sponsorId: { in: ids }, createdAt: { gte: new Date(now - 90 * DAY) } }, select: { sponsorId: true, userId: true, surface: true, createdAt: true } });
  const map = new Map<string, { total: number; d1: number; d7: number; uniq: number; bot: number; home: number; users: Set<string> }>();
  for (const id of ids) map.set(id, { total: 0, d1: 0, d7: 0, uniq: 0, bot: 0, home: 0, users: new Set() });
  for (const t of taps) {
    const r = map.get(t.sponsorId)!;
    r.total += 1;
    const age = now - t.createdAt.getTime();
    if (age < DAY) r.d1 += 1;
    if (age < 7 * DAY) r.d7 += 1;
    if (t.surface === "bot") r.bot += 1; else r.home += 1;
    if (t.userId) r.users.add(t.userId);
  }
  return new Map([...map].map(([k, v]) => [k, { total: v.total, d1: v.d1, d7: v.d7, uniq: v.users.size, bot: v.bot, home: v.home }]));
}

export async function listSponsors() {
  const rows = await prisma.sponsorButton.findMany({ orderBy: [{ enabled: "desc" }, { sort: "asc" }, { createdAt: "desc" }] });
  const stats = await tapStats(rows.map((r) => r.id));
  const now = new Date();
  return {
    max: MAX_ACTIVE_SPONSORS,
    note: "Use legal brands only. No betting or real-money gaming.",
    sponsors: rows.map((r) => ({ ...r, live: isLive(r, now), stats: stats.get(r.id) })),
  };
}

/** Reports / CRM attribution: taps per sponsor over N days, with how many tappers are verified. */
export async function sponsorReport(days = 30) {
  const since = new Date(Date.now() - Math.max(1, Math.min(365, days)) * DAY);
  const rows = await prisma.sponsorButton.findMany({ orderBy: { createdAt: "desc" } });
  const taps = await prisma.sponsorTap.findMany({ where: { createdAt: { gte: since } }, select: { sponsorId: true, userId: true, surface: true } });
  const userIds = [...new Set(taps.map((t) => t.userId).filter(Boolean) as string[])];
  const verified = new Set((await prisma.user.findMany({ where: { id: { in: userIds }, phoneVerifiedAt: { not: null } }, select: { id: true } })).map((u) => u.id));
  return {
    days,
    rows: rows.map((r) => {
      const mine = taps.filter((t) => t.sponsorId === r.id);
      const users = new Set(mine.map((t) => t.userId).filter(Boolean) as string[]);
      return {
        id: r.id, label: `${r.emoji ? `${r.emoji} ` : ""}${r.text}`, url: r.url, live: isLive(r), taps: mine.length, users: users.size,
        verifiedUsers: [...users].filter((u) => verified.has(u)).length,
        bot: mine.filter((t) => t.surface === "bot").length, home: mine.filter((t) => t.surface !== "bot").length,
      };
    }).filter((r) => r.taps > 0 || r.live),
  };
}

/* ---------- public side ---------- */

let cache: { at: number; rows: Sponsor[] } = { at: 0, rows: [] };
function bust() { cache = { at: 0, rows: [] }; }

export async function liveSponsors(verified: boolean): Promise<Sponsor[]> {
  if (Date.now() - cache.at > 30_000) {
    const rows = await prisma.sponsorButton.findMany({ where: { enabled: true }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }).catch(() => cache.rows);
    cache = { at: Date.now(), rows };
  }
  const now = new Date();
  return cache.rows.filter((s) => isLive(s, now) && (verified || s.target === "all")).slice(0, MAX_ACTIVE_SPONSORS);
}

export function publicSponsor(s: Sponsor) {
  return { id: s.id, text: s.text, emoji: s.emoji, style: s.style, url: s.url, frameable: s.frameable, imageUrl: s.imageUrl };
}

export function sponsorLabel(s: { emoji: string; text: string }) {
  return `${s.emoji ? `${s.emoji} ` : ""}${s.text}`.slice(0, 64);
}

export async function getSponsorForUser(id: string, verified: boolean) {
  const s = await prisma.sponsorButton.findUnique({ where: { id } });
  if (!s || !isLive(s) || (!verified && s.target !== "all")) throw httpError(404, "NOT_FOUND", "This sponsor offer has ended.");
  return publicSponsor(s);
}

export async function recordTap(sponsorId: string, userId: string | null, surface: string) {
  const exists = await prisma.sponsorButton.findUnique({ where: { id: sponsorId }, select: { id: true } });
  if (!exists) return { ok: false };
  await prisma.sponsorTap.create({ data: { sponsorId, userId, surface: surface === "bot" ? "bot" : "home" } });
  return { ok: true };
}

/* ---------------- one-tap sponsor links (bot web_app button → api 302 → sponsor URL) ---------------- */

const goSig = (id: string, t: string, src: string) =>
  nodeCrypto.createHmac("sha256", process.env.WEB_AUTH_SECRET || process.env.TELEGRAM_BOT_TOKEN || "ll").update(`sp:${id}:${t}:${src}`).digest("base64url").slice(0, 16);

/** Tracking link that records the tap and redirects straight to the sponsor (no intermediate page). */
export function sponsorGoUrl(id: string, telegramId: string | number, src: "bot" | "home" = "bot"): string {
  const t = String(telegramId);
  return `${env.apiOrigin || env.publicApiUrl}/go/sp/${encodeURIComponent(id)}?t=${encodeURIComponent(t)}&s=${src}&g=${goSig(id, t, src)}`;
}

/** Resolve a /go/sp link: record the tap (user only if the signature checks out) and return the target. */
export async function sponsorGo(id: string, q: { t?: string; s?: string; g?: string }): Promise<string | null> {
  const s = await prisma.sponsorButton.findUnique({ where: { id } }).catch(() => null);
  if (!s || !isLive(s)) return null;
  const src = q.s === "home" ? "home" : "bot";
  let userId: string | null = null;
  if (q.t && q.g && q.g === goSig(id, q.t, src)) {
    userId = (await prisma.user.findUnique({ where: { telegramId: q.t }, select: { id: true } }).catch(() => null))?.id || null;
  }
  void prisma.sponsorTap.create({ data: { sponsorId: id, userId, surface: src } }).catch(() => undefined);
  return s.url;
}

/** Set / clear the sponsor's Home-tile image (must be an uploaded /ads-media/ file). */
export async function setSponsorImage(id: string, imageUrl: string) {
  if (imageUrl && !/^\/ads-media\/[A-Za-z0-9._-]+$/.test(imageUrl)) throw httpError(400, "BAD_IMAGE", "Upload the image in Ads first.");
  const row = await prisma.sponsorButton.update({ where: { id }, data: { imageUrl } }).catch(() => null);
  if (!row) throw httpError(404, "NOT_FOUND", "Sponsor not found.");
  bust();
  return row;
}
