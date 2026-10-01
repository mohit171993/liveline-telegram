import { prisma } from "@liveline/db";
import { istDay, projectMatch, type CricketMatchState } from "@liveline/shared";
import { readUniverse } from "../feed";
import { redis } from "../redis";
import { isBlocked, tgCall, type TgResult } from "../telegram";
import { httpError } from "../httpError";
import { FLAG_ART } from "../flagArt";
import { getRule, setRule } from "./automation";
import { BUTTON_TARGETS, safeHtml, trackedLink } from "./crm";

/**
 * Automated reminder sequences (bot DMs), all admin-configurable.
 *
 * Better than the Fantzo/Dura loop (single global toggle, fixed copy, 22-08 quiet hours,
 * 20 sends per run, no per-user cap, no open tracking):
 *  - per-rule on/off, timing and copy, live preview and test-send to self
 *  - per-user cap across ALL rules (default 2/day IST) + quiet hours 23:00-08:00 IST
 *  - respects /stop (User.optOut), skips banned users, auto-marks bot-blocked users on 403
 *    and clears it when they talk to the bot again
 *  - every inline button is a tracked deep link (startapp=r_<sendId>__<screen>) so stats show opens
 *  - verify nudges report conversion (verified after a nudge)
 *  - real matches only (never demo), dedupe keys in the DB (unique), single-flight Redis lock
 */

export type RuleKey = "verify_nudge" | "match_start" | "daily_predict" | "daily_spin" | "winback";

export interface GlobalConfig { maxPerDay: number; quietStart: number; quietEnd: number; maxPerRun: number }
export interface VerifyConfig { delaysH: number[]; texts: string[] }
export interface MatchStartConfig { leadMin: number; bigMatches: boolean; text: string; button: string }
export interface DailyConfig { hourIst: number; text: string; button: string }
export interface WinbackConfig { days: number[]; texts: string[]; button: string }

export const GLOBAL_DEFAULTS: GlobalConfig = { maxPerDay: 2, quietStart: 23, quietEnd: 8, maxPerRun: 300 };

export const RULE_DEFAULTS: Record<RuleKey, { enabled: boolean; config: object; title: string; about: string }> = {
  verify_nudge: {
    enabled: true,
    title: "Verify nudges (unverified)",
    about: "Up to 3 nudges after /start (default +1h, +24h, +3d) with the green Share phone button. Stops as soon as they verify.",
    config: {
      delaysH: [1, 24, 72],
      texts: [
        "👋 Hi {name}! You're one tap away from the live line.\n\nTap <b>✅ Share phone to verify</b> below to unlock ball-by-ball scores, free predictions and your free daily spin.",
        "🏏 {matches}\n\nVerify in one tap to follow it live, predict for free and climb the leaderboard. 18+ · No betting.",
        "🎡 Your free daily spin is waiting, {name}.\n\nLast reminder: tap <b>✅ Share phone to verify</b> and you're in.",
      ],
    } satisfies VerifyConfig,
  },
  match_start: {
    enabled: true,
    title: "Match starting (followed or big matches)",
    about: "Before a real match starts: users who follow either team, plus all recently active users for big matches (internationals, finals, IPL, World Cups).",
    config: { leadMin: 30, bigMatches: true, text: "⏰ <b>{match}</b> starts at {time} IST.\n\nLock your free predictions before the first ball 🎯", button: "predict" } satisfies MatchStartConfig,
  },
  daily_predict: {
    enabled: true,
    title: "Daily predict reminder",
    about: "Once a day on match days, to verified users who haven't predicted today.",
    config: { hourIst: 18, text: "🎯 {matches} today. Your free picks are open, {name}. Every correct call climbs the leaderboard 🏆", button: "predict" } satisfies DailyConfig,
  },
  daily_spin: {
    enabled: true,
    title: "Daily free spin reminder",
    about: "Once a day to verified users who haven't used today's free spin.",
    config: { hourIst: 12, text: "🎡 Your free spin for today is ready, {name}. Points and perks, no cost.", button: "spin" } satisfies DailyConfig,
  },
  winback: {
    enabled: true,
    title: "Win-back (inactive 3 / 7 days)",
    about: "One message per inactivity spell at 3 days and 7 days without opening the app.",
    config: {
      days: [3, 7],
      texts: [
        "🏏 We miss you, {name}! {matches} Your streak and free spin are waiting.",
        "👀 It's been a week, {name}. You have <b>{points} pts</b> on the board. Come back for today's live line and a free spin.",
      ],
      button: "live",
    } satisfies WinbackConfig,
  },
};

export const RULE_KEYS = Object.keys(RULE_DEFAULTS) as RuleKey[];

export async function globalConfig(): Promise<GlobalConfig> {
  return (await getRule("auto_global", { enabled: true, config: GLOBAL_DEFAULTS })).config;
}

async function rule<T extends object>(key: RuleKey) {
  return getRule<T>(`auto_${key}`, RULE_DEFAULTS[key] as unknown as { enabled: boolean; config: T });
}

function istHour(ms = Date.now()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(ms)) % 24;
}

export function inQuietHours(g: GlobalConfig, ms = Date.now()): boolean {
  const h = istHour(ms);
  return g.quietStart > g.quietEnd ? h >= g.quietStart || h < g.quietEnd : h >= g.quietStart && h < g.quietEnd;
}

function istDayStart(ms = Date.now()): Date {
  return new Date(`${istDay(new Date(ms))}T00:00:00+05:30`);
}

const IST_TIME = (ms: number) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(ms);

function realMatches(all: CricketMatchState[]) {
  return all.filter((m) => !m.demo && !m.key.startsWith("demo_"));
}

function bigMatch(m: CricketMatchState): boolean {
  const national = Boolean(FLAG_ART[String(m.teams.a.code).toUpperCase()] && FLAG_ART[String(m.teams.b.code).toUpperCase()]);
  return national || /world cup|asia cup|champions trophy|final|ipl|premier league/i.test(`${m.seriesName} ${m.name}`);
}

interface Vars { name?: string; match?: string; time?: string; matches?: string; points?: number }

export function fill(template: string, v: Vars): string {
  const html = safeHtml(template);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return html
    .replace(/\{name\}/g, esc(v.name || "there"))
    .replace(/\{match\}/g, esc(v.match || "Today's match"))
    .replace(/\{time\}/g, esc(v.time || ""))
    .replace(/\{matches\}/g, esc(v.matches || "Live cricket is on today."))
    .replace(/\{points\}/g, String(v.points ?? 0));
}

const BUTTON_LABEL: Record<string, string> = {
  predict: "🎯 Predict free", spin: "🎡 Spin free", live: "🏏 Open live line", board: "🏆 Leaderboard", home: "🏏 Open LiveLine",
  alerts: "🔔 Reminders", lino: "🤖 Ask Lino", play: "🎮 Play", pass: "🎟 Season pass",
};

async function todaysMatchesLine(now = Date.now()): Promise<{ line: string; any: boolean; first?: CricketMatchState }> {
  const today = istDay(new Date(now));
  const ms = realMatches(await readUniverse())
    .filter((m) => m.status === "live" || (m.status === "upcoming" && istDay(new Date(m.startAt)) === today))
    .sort((a, b) => a.startAt - b.startAt);
  if (!ms.length) return { line: "", any: false };
  const m = ms[0];
  const line = m.status === "live" ? `${m.teams.a.name} vs ${m.teams.b.name} is LIVE now.` : `${m.teams.a.name} vs ${m.teams.b.name} at ${IST_TIME(m.startAt)} IST.`;
  return { line: ms.length > 1 ? `${line} +${ms.length - 1} more` : line, any: true, first: m };
}

type Recipient = { id: string; telegramId: string; firstName: string | null; points: number };

interface Ctx { g: GlobalConfig; sentToday: Map<string, number>; budget: number; dry: boolean; log: { rule: string; sent: number; skipped: number; failed: number }[] }

async function capCounts(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await prisma.autoSend.groupBy({ by: ["userId"], where: { userId: { in: ids }, status: "sent", sentAt: { gte: istDayStart() } }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.userId, r._count._all]));
}

/** Claim (dedupe), send, record. Returns false when skipped by cap/dupe/budget. */
async function deliver(ctx: Ctx, ruleKey: RuleKey, step: number, dedupeKey: string, u: Recipient, text: string, opts: { button?: string; verifyKeyboard?: boolean }) {
  if (ctx.budget <= 0) return "budget";
  const used = ctx.sentToday.get(u.id) || 0;
  if (used >= ctx.g.maxPerDay) return "cap";
  if (await prisma.autoSend.findUnique({ where: { dedupeKey }, select: { id: true } })) return "dupe";
  let row;
  try {
    row = await prisma.autoSend.create({ data: { userId: u.id, ruleKey, step, dedupeKey, status: "sending" } });
  } catch {
    return "dupe";
  }
  ctx.budget -= 1;
  const reply_markup = opts.verifyKeyboard
    ? { keyboard: [[{ text: "✅ Share phone to verify", request_contact: true, style: "success" }]], resize_keyboard: true, is_persistent: true }
    : opts.button ? { inline_keyboard: [[{ text: BUTTON_LABEL[opts.button] || "🏏 Open LiveLine", url: trackedLink("r", row.id, opts.button) }]] } : undefined;
  let res: TgResult = await tgCall("sendMessage", { chat_id: u.telegramId, text, parse_mode: "HTML", disable_web_page_preview: true, ...(reply_markup ? { reply_markup } : {}) });
  if (!res.ok && res.code === 429) {
    await new Promise((r) => setTimeout(r, ((res.retryAfter || 2) + 1) * 1000));
    res = await tgCall("sendMessage", { chat_id: u.telegramId, text, parse_mode: "HTML", disable_web_page_preview: true, ...(reply_markup ? { reply_markup } : {}) });
  }
  if (res.ok) {
    await prisma.autoSend.update({ where: { id: row.id }, data: { status: "sent", sentAt: new Date() } });
    ctx.sentToday.set(u.id, used + 1);
    return "sent";
  }
  const blocked = isBlocked(res);
  await prisma.autoSend.update({ where: { id: row.id }, data: { status: blocked ? "blocked" : "failed", error: res.description?.slice(0, 300) } });
  if (blocked) await prisma.user.update({ where: { id: u.id }, data: { botBlockedAt: new Date() } }).catch(() => undefined);
  return blocked ? "blocked" : "failed";
}

const reachable = { optOut: false, botBlockedAt: null, blockedAt: null, isDemo: false, status: { not: "BLOCKED" } } as const;
const pick = { id: true, telegramId: true, firstName: true, points: true } as const;

async function runVerify(ctx: Ctx, now: number) {
  const r = await rule<VerifyConfig>("verify_nudge");
  if (!r.enabled) return;
  const delays = r.config.delaysH.slice(0, 3).map((h) => Math.max(0.25, Number(h) || 1));
  const users = await prisma.user.findMany({
    where: { ...reachable, phoneVerifiedAt: null, createdAt: { gte: new Date(now - 30 * 86400_000), lte: new Date(now - delays[0] * 3600_000) } },
    select: { ...pick, createdAt: true },
    take: 2000,
  });
  const sends = await prisma.autoSend.findMany({ where: { ruleKey: "verify_nudge", userId: { in: users.map((u) => u.id) }, status: { in: ["sent", "sending"] } }, select: { userId: true, sentAt: true } });
  const by = new Map<string, Date[]>();
  for (const s of sends) by.set(s.userId, [...(by.get(s.userId) || []), s.sentAt]);
  const { line } = await todaysMatchesLine(now);
  const caps = await capCounts(users.map((u) => u.id));
  for (const [k, v] of caps) ctx.sentToday.set(k, Math.max(ctx.sentToday.get(k) || 0, v));
  for (const u of users) {
    const done = by.get(u.id) || [];
    const step = done.length;
    if (step >= delays.length) continue;
    if (now - u.createdAt.getTime() < delays[step] * 3600_000) continue;
    const last = done.length ? Math.max(...done.map((d) => d.getTime())) : 0;
    if (last && now - last < (delays[step] - delays[step - 1]) * 0.5 * 3600_000) continue;
    const text = fill(r.config.texts[step] || r.config.texts[0], { name: u.firstName || undefined, matches: line || "Live cricket every day." });
    const res = await deliver(ctx, "verify_nudge", step, `verify:${u.id}:${step}`, u, text, { verifyKeyboard: true });
    track(ctx, "verify_nudge", res);
  }
}

async function runMatchStart(ctx: Ctx, now: number) {
  const r = await rule<MatchStartConfig>("match_start");
  if (!r.enabled) return;
  const lead = Math.max(10, Math.min(180, r.config.leadMin)) * 60_000;
  const soon = realMatches(await readUniverse()).filter((m) => m.status === "upcoming" && m.startAt > now && m.startAt - now <= lead);
  for (const m of soon) {
    const fans = await prisma.favorite.findMany({ where: { kind: "team", refKey: { in: [m.teams.a.key, m.teams.b.key] } }, select: { userId: true } });
    const or: object[] = [{ id: { in: fans.map((f) => f.userId) } }];
    if (r.config.bigMatches && bigMatch(m)) or.push({ lastSeenAt: { gte: new Date(now - 14 * 86400_000) } });
    const users = await prisma.user.findMany({ where: { ...reachable, phoneVerifiedAt: { not: null }, OR: or }, select: pick, take: 20_000 });
    const caps = await capCounts(users.map((u) => u.id));
    for (const [k, v] of caps) ctx.sentToday.set(k, Math.max(ctx.sentToday.get(k) || 0, v));
    const view = projectMatch(m, false, now);
    for (const u of users) {
      const text = fill(r.config.text, { name: u.firstName || undefined, match: `${view.teams.a.name} vs ${view.teams.b.name}`, time: IST_TIME(m.startAt) });
      const res = await deliver(ctx, "match_start", 0, `match:${u.id}:${m.key}`, u, text, { button: r.config.button || "predict" });
      track(ctx, "match_start", res);
    }
  }
}

async function runDaily(ctx: Ctx, now: number, key: "daily_predict" | "daily_spin") {
  const r = await rule<DailyConfig>(key);
  if (!r.enabled) return;
  const h = istHour(now);
  if (h < r.config.hourIst || h > r.config.hourIst + 3) return;
  const day = istDay(new Date(now));
  const today = await todaysMatchesLine(now);
  if (key === "daily_predict" && !today.any) return;
  const since = istDayStart(now);
  const where = key === "daily_predict"
    ? { ...reachable, phoneVerifiedAt: { not: null }, lastSeenAt: { gte: new Date(now - 30 * 86400_000) }, predictions: { none: { lockedAt: { gte: since } } } }
    : { ...reachable, phoneVerifiedAt: { not: null }, lastSeenAt: { gte: new Date(now - 30 * 86400_000) }, spins: { none: { dayKey: day, source: "daily" } } };
  const users = await prisma.user.findMany({ where, select: pick, take: 20_000 });
  const caps = await capCounts(users.map((u) => u.id));
  for (const [k, v] of caps) ctx.sentToday.set(k, Math.max(ctx.sentToday.get(k) || 0, v));
  for (const u of users) {
    const text = fill(r.config.text, { name: u.firstName || undefined, matches: today.line || "Cricket", points: u.points });
    const res = await deliver(ctx, key, 0, `${key}:${u.id}:${day}`, u, text, { button: r.config.button });
    track(ctx, key, res);
  }
}

async function runWinback(ctx: Ctx, now: number) {
  const r = await rule<WinbackConfig>("winback");
  if (!r.enabled) return;
  const h = istHour(now);
  if (h < 10 || h > 20) return;
  const days = r.config.days.slice(0, 3);
  const { line } = await todaysMatchesLine(now);
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    const upper = new Date(now - d * 86400_000);
    const lower = new Date(now - (days[i + 1] || d + 7) * 86400_000);
    const users = await prisma.user.findMany({ where: { ...reachable, phoneVerifiedAt: { not: null }, lastSeenAt: { lte: upper, gt: lower } }, select: { ...pick, lastSeenAt: true }, take: 20_000 });
    const caps = await capCounts(users.map((u) => u.id));
    for (const [k, v] of caps) ctx.sentToday.set(k, Math.max(ctx.sentToday.get(k) || 0, v));
    for (const u of users) {
      const spell = u.lastSeenAt ? istDay(u.lastSeenAt) : "never";
      const text = fill(r.config.texts[i] || r.config.texts[0], { name: u.firstName || undefined, matches: line, points: u.points });
      const res = await deliver(ctx, "winback", i, `winback:${u.id}:${d}:${spell}`, u, text, { button: r.config.button });
      track(ctx, "winback", res);
    }
  }
}

function track(ctx: Ctx, ruleKey: string, res: string) {
  let row = ctx.log.find((l) => l.rule === ruleKey);
  if (!row) { row = { rule: ruleKey, sent: 0, skipped: 0, failed: 0 }; ctx.log.push(row); }
  if (res === "sent") row.sent += 1;
  else if (res === "failed" || res === "blocked") row.failed += 1;
  else row.skipped += 1;
}

/** Worker entry: one pass over every enabled rule. Single-flight across processes. */
export async function runReminders(now = Date.now()) {
  const g = await globalConfig();
  const master = await getRule("auto_global", { enabled: true, config: GLOBAL_DEFAULTS });
  if (!master.enabled) return { skipped: "off" };
  if (inQuietHours(g, now)) return { skipped: "quiet" };
  const lock = await redis.set("ll:auto:lock", String(process.pid), "PX", 240_000, "NX");
  if (!lock) return { skipped: "locked" };
  const ctx: Ctx = { g, sentToday: new Map(), budget: g.maxPerRun, dry: false, log: [] };
  try {
    // Priority order: time-critical first, so the daily cap is spent on what matters most.
    await runMatchStart(ctx, now).catch((e) => console.error(JSON.stringify({ level: "warn", msg: "auto-match", err: String(e) })));
    // Verify nudges: seed caps for unverified users lazily (they rarely get anything else).
    await runVerify(ctx, now).catch((e) => console.error(JSON.stringify({ level: "warn", msg: "auto-verify", err: String(e) })));
    await runDaily(ctx, now, "daily_predict").catch((e) => console.error(JSON.stringify({ level: "warn", msg: "auto-predict", err: String(e) })));
    await runDaily(ctx, now, "daily_spin").catch((e) => console.error(JSON.stringify({ level: "warn", msg: "auto-spin", err: String(e) })));
    await runWinback(ctx, now).catch((e) => console.error(JSON.stringify({ level: "warn", msg: "auto-winback", err: String(e) })));
    if (ctx.log.some((l) => l.sent || l.failed)) console.log(JSON.stringify({ level: "info", msg: "auto-run", log: ctx.log }));
    return { log: ctx.log };
  } finally {
    await redis.del("ll:auto:lock").catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ admin API */

export async function automationState() {
  const master = await getRule("auto_global", { enabled: true, config: GLOBAL_DEFAULTS });
  const since7 = new Date(Date.now() - 7 * 86400_000);
  const since1 = istDayStart();
  const [week, today, opens] = await Promise.all([
    prisma.autoSend.groupBy({ by: ["ruleKey", "status"], where: { sentAt: { gte: since7 } }, _count: { _all: true } }),
    prisma.autoSend.groupBy({ by: ["ruleKey"], where: { sentAt: { gte: since1 }, status: "sent" }, _count: { _all: true } }),
    prisma.autoSend.groupBy({ by: ["ruleKey"], where: { sentAt: { gte: since7 }, openedAt: { not: null } }, _count: { _all: true } }),
  ]);
  const nudged = await prisma.autoSend.findMany({ where: { ruleKey: "verify_nudge", status: "sent", sentAt: { gte: since7 } }, select: { userId: true }, distinct: ["userId"] });
  const converted = nudged.length ? await prisma.user.count({ where: { id: { in: nudged.map((n) => n.userId) }, phoneVerifiedAt: { not: null } } }) : 0;
  const rules = [];
  for (const key of RULE_KEYS) {
    const r = await rule<object>(key);
    const st = (s: string) => week.find((w) => w.ruleKey === key && w.status === s)?._count._all || 0;
    const sent = st("sent");
    const opened = opens.find((o) => o.ruleKey === key)?._count._all || 0;
    rules.push({
      key,
      title: RULE_DEFAULTS[key].title,
      about: RULE_DEFAULTS[key].about,
      enabled: r.enabled,
      config: r.config,
      stats: {
        today: today.find((t) => t.ruleKey === key)?._count._all || 0,
        sent7d: sent,
        failed7d: st("failed"),
        blocked7d: st("blocked"),
        opened7d: opened,
        openRate: sent ? Math.round((opened / sent) * 100) : 0,
        ...(key === "verify_nudge" ? { nudged7d: nudged.length, converted7d: converted, conversion: nudged.length ? Math.round((converted / nudged.length) * 100) : 0 } : {}),
      },
    });
  }
  const [optedOut, blocked] = await Promise.all([
    prisma.user.count({ where: { optOut: true, isDemo: false } }),
    prisma.user.count({ where: { botBlockedAt: { not: null }, isDemo: false } }),
  ]);
  return { enabled: master.enabled, global: master.config, quietNow: inQuietHours(master.config), optedOut, blocked, rules, buttons: BUTTON_TARGETS };
}

function cleanConfig(key: RuleKey, input: Record<string, unknown>, cur: Record<string, unknown>): object {
  const text = (v: unknown, fallback: string) => {
    const s = typeof v === "string" ? v.trim().slice(0, 1500) : fallback;
    if (/\b(bet|betting|odds|wager|casino|deposit)\b/i.test(s)) throw httpError(400, "NO_BETTING", "Free-to-play only: no betting, odds or deposit language.");
    return s || fallback;
  };
  const num = (v: unknown, lo: number, hi: number, fallback: number) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : fallback);
  const btn = (v: unknown, fallback: string) => ((BUTTON_TARGETS as readonly string[]).includes(String(v)) ? String(v) : fallback);
  const merged = { ...cur, ...input };
  if (key === "verify_nudge") {
    const delays = (Array.isArray(merged.delaysH) ? merged.delaysH : [1, 24, 72]).slice(0, 3).map((d, i) => num(d, 0.25, 24 * 14, [1, 24, 72][i]));
    delays.sort((a, b) => a - b);
    const texts = (Array.isArray(merged.texts) ? merged.texts : []).slice(0, 3).map((t, i) => text(t, (RULE_DEFAULTS.verify_nudge.config as VerifyConfig).texts[i]));
    return { delaysH: delays, texts };
  }
  if (key === "match_start") return { leadMin: num(merged.leadMin, 10, 180, 30), bigMatches: Boolean(merged.bigMatches), text: text(merged.text, ""), button: btn(merged.button, "predict") };
  if (key === "daily_predict" || key === "daily_spin") return { hourIst: Math.round(num(merged.hourIst, 8, 21, 12)), text: text(merged.text, ""), button: btn(merged.button, key === "daily_spin" ? "spin" : "predict") };
  const days = (Array.isArray(merged.days) ? merged.days : [3, 7]).slice(0, 3).map((d) => Math.round(num(d, 1, 60, 3))).sort((a, b) => a - b);
  const texts = (Array.isArray(merged.texts) ? merged.texts : []).slice(0, 3).map((t, i) => text(t, (RULE_DEFAULTS.winback.config as WinbackConfig).texts[i] || ""));
  return { days, texts, button: btn(merged.button, "live") };
}

export async function updateAutomation(input: { key?: string; enabled?: boolean; config?: Record<string, unknown>; global?: Partial<GlobalConfig>; masterEnabled?: boolean }, actor?: string) {
  if (input.global || input.masterEnabled !== undefined) {
    const cur = await getRule("auto_global", { enabled: true, config: GLOBAL_DEFAULTS });
    const g = { ...cur.config, ...(input.global || {}) };
    const next: GlobalConfig = {
      maxPerDay: Math.max(1, Math.min(5, Math.round(Number(g.maxPerDay) || 2))),
      quietStart: Math.max(0, Math.min(23, Math.round(Number(g.quietStart)))),
      quietEnd: Math.max(0, Math.min(23, Math.round(Number(g.quietEnd)))),
      maxPerRun: Math.max(10, Math.min(2000, Math.round(Number(g.maxPerRun) || 300))),
    };
    await setRule("auto_global", { enabled: input.masterEnabled ?? cur.enabled, config: next }, actor);
  }
  if (input.key) {
    if (!(RULE_KEYS as string[]).includes(input.key)) throw httpError(400, "BAD_RULE");
    const key = input.key as RuleKey;
    const cur = await rule<Record<string, unknown>>(key);
    const config = input.config ? cleanConfig(key, input.config, cur.config) : cur.config;
    await setRule(`auto_${key}`, { enabled: input.enabled ?? cur.enabled, config }, actor);
  }
  return automationState();
}

/** Preview the exact message a rule would send (step for sequences), with sample or real values. */
export async function previewRule(key: string, step = 0, who?: { firstName?: string | null; points?: number }) {
  if (!(RULE_KEYS as string[]).includes(key)) throw httpError(400, "BAD_RULE");
  const k = key as RuleKey;
  const r = await rule<Record<string, unknown>>(k);
  const today = await todaysMatchesLine();
  const m = today.first;
  const vars: Vars = {
    name: who?.firstName || "Rahul",
    points: who?.points ?? 1240,
    matches: today.line || "India vs Australia at 7:30 pm IST.",
    match: m ? `${m.teams.a.name} vs ${m.teams.b.name}` : "India vs Australia",
    time: m ? IST_TIME(m.startAt) : "7:30 pm",
  };
  const cfg = r.config as Record<string, unknown>;
  const texts = Array.isArray(cfg.texts) ? (cfg.texts as string[]) : [String(cfg.text || "")];
  const html = fill(texts[Math.min(step, texts.length - 1)] || "", vars);
  const button = k === "verify_nudge" ? "✅ Share phone to verify" : BUTTON_LABEL[String(cfg.button || "home")] || "🏏 Open LiveLine";
  return { key, step, html, button, buttonKind: k === "verify_nudge" ? "reply_keyboard" : "inline_url" };
}

export async function testRule(key: string, step: number, admin: { telegramId: string; firstName?: string | null; points?: number }) {
  const p = await previewRule(key, step, admin);
  const reply_markup = p.buttonKind === "reply_keyboard"
    ? { keyboard: [[{ text: "✅ Share phone to verify", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
    : { inline_keyboard: [[{ text: p.button, url: trackedLink("r", "test0000000000", String(((await rule<Record<string, unknown>>(key as RuleKey)).config as Record<string, unknown>).button || "home")) }]] };
  const res = await tgCall("sendMessage", { chat_id: admin.telegramId, text: `🧪 <b>Test · ${RULE_DEFAULTS[key as RuleKey].title}</b>\n\n${p.html}`, parse_mode: "HTML", disable_web_page_preview: true, reply_markup });
  if (!res.ok) throw httpError(400, "TEST_FAILED", res.description || "Telegram rejected the test. Open the bot and press Start first.");
  return { ok: true };
}
