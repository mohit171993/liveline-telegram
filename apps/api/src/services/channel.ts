import { prisma } from "@liveline/db";
import { projectMatch, type CricketMatchState, type MatchView } from "@liveline/shared";
import { env, matchLink, miniAppLink } from "../env";
import { redis } from "../redis";
import { readUniverse } from "../feed";
import { sendPhotoCard, type TgResult } from "../telegram";
import { inningsBreakSvg, istDate, istTime, momentSvg, renderCard, resultSvg, startingSoonSvg, todaySvg, esc, type MomentKind } from "../channelCards";
import { rememberChannelPost } from "./reports";
import { getRule, setRule } from "./automation";

/**
 * Channel auto-post for @LiveLine_Pro. Real (non-demo) live/upcoming matches only.
 * Every post is a branded image card + one deep-link button into the Mini App.
 * Dedupe lives in Redis (survives restarts, shared across processes); key moments are
 * rate-limited per match. A first sighting of a live match only snapshots state, so a
 * cold start or redeploy never floods the channel with stale moments.
 */

export interface ChannelConfig {
  startingSoon: boolean;
  startLeadMin: number;
  moments: boolean;
  momentGapMin: number;
  innings: boolean;
  result: boolean;
  daily: boolean;
  dailyHourIst: number;
}

export const CHANNEL_DEFAULTS: ChannelConfig = {
  startingSoon: true,
  startLeadMin: 30,
  moments: true,
  momentGapMin: 10,
  innings: true,
  result: true,
  daily: true,
  dailyHourIst: 9,
};

interface Snap {
  status: string;
  inn: number;
  wk: number[];
  fifties: string[];
  hundreds: string[];
  at: number;
}

const DAY = 24 * 3600;

export async function channelSettings() {
  const rule = await getRule("channel_autopost", { enabled: true, config: CHANNEL_DEFAULTS });
  return {
    envOn: env.channelAutopost,
    channelId: env.channelId ? String(env.channelId) : "",
    enabled: rule.enabled,
    live: Boolean(env.channelAutopost && env.channelId && rule.enabled),
    config: { ...CHANNEL_DEFAULTS, ...(rule.config as Partial<ChannelConfig>) },
  };
}

export async function updateChannelSettings(patch: { enabled?: boolean; config?: Partial<ChannelConfig> }, actor?: string) {
  const cur = await channelSettings();
  const config = { ...cur.config, ...(patch.config || {}) };
  config.momentGapMin = Math.max(5, Math.min(120, Number(config.momentGapMin) || 10));
  config.startLeadMin = Math.max(10, Math.min(120, Number(config.startLeadMin) || 30));
  config.dailyHourIst = Math.max(6, Math.min(20, Math.round(Number(config.dailyHourIst) || 9)));
  await setRule("channel_autopost", { enabled: patch.enabled ?? cur.enabled, config }, actor);
  return channelSettings();
}

function realMatches(all: CricketMatchState[]): CricketMatchState[] {
  return all.filter((m) => !m.demo && !m.key.startsWith("demo_"));
}

function snapOf(m: CricketMatchState): Snap {
  const fifties: string[] = [];
  const hundreds: string[] = [];
  m.innings.forEach((inn, i) => {
    for (const b of inn.batters || []) {
      if (b.runs >= 50) fifties.push(`${i}:${b.id}`);
      if (b.runs >= 100) hundreds.push(`${i}:${b.id}`);
    }
  });
  return { status: m.status, inn: m.current, wk: m.innings.map((inn) => inn.wickets), fifties, hundreds, at: Date.now() };
}

function istDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(ms);
}
function istHour(ms: number): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(ms)) % 24;
}

function button(text: string, url: string) {
  return { inline_keyboard: [[{ text, url }]] };
}

function title(v: MatchView) {
  return `${v.teams.a.name} vs ${v.teams.b.name}`;
}

export interface CardPost { kind: string; png: Buffer; caption: string; markup: unknown; matchKey?: string }

export async function buildStartCard(v: MatchView, now = Date.now()): Promise<CardPost> {
  const lines = [`🏏 <b>${esc(title(v))}</b>`, `${esc(v.seriesName)} · ${esc(v.format)}`];
  lines.push(v.status === "live" ? "🔴 Live now" : `⏰ Starts ${istTime(v.startAt)} IST`);
  if (v.toss) lines.push(`🪙 ${esc(v.toss)}`);
  lines.push("", "🎯 Free predictions are open · points only");
  return { kind: "start", png: await renderCard(startingSoonSvg(v, now)), caption: lines.join("\n"), markup: button("🏏 Open live line", matchLink(v.key)), matchKey: v.key };
}

export async function buildMomentCard(v: MatchView, kind: MomentKind, headline: string, detail: string): Promise<CardPost> {
  const live = v.live;
  const icon = kind === "wicket" ? "☝️ <b>WICKET!</b>" : kind === "hundred" ? "💯 <b>HUNDRED!</b>" : "🔥 <b>FIFTY!</b>";
  const score = live ? `${v.teams[live.batting].code} ${live.runs}/${live.wickets} (${live.overs})` : "";
  const caption = [`${icon} ${esc(headline)}`, esc(detail), score ? `📊 ${esc(score)}` : "", `${esc(v.teams.a.code)} vs ${esc(v.teams.b.code)} · ${esc(v.seriesName)}`].filter(Boolean).join("\n");
  return { kind, png: await renderCard(momentSvg(v, kind, headline, detail)), caption, markup: button("🔴 Follow ball by ball", matchLink(v.key)), matchKey: v.key };
}

export async function buildInningsCard(v: MatchView): Promise<CardPost> {
  const caption = [`☕ <b>Innings break</b> · ${esc(title(v))}`, `${esc(v.teams.a.code)} ${esc(v.scoreline.a || "-")} · ${esc(v.teams.b.code)} ${esc(v.scoreline.b || "-")}`, "", "🎯 Lock your free picks for the chase"].join("\n");
  return { kind: "innings", png: await renderCard(inningsBreakSvg(v)), caption, markup: button("🎯 Predict the chase", matchLink(v.key)), matchKey: v.key };
}

export async function buildResultCard(v: MatchView, winner?: "a" | "b" | null): Promise<CardPost> {
  const caption = [`🏆 <b>${esc(v.result || "Match complete")}</b>`, `${esc(v.teams.a.code)} ${esc(v.scoreline.a || "-")} · ${esc(v.teams.b.code)} ${esc(v.scoreline.b || "-")}`, `${esc(v.seriesName)}`, "", "📈 See your points & leaderboard rank"].join("\n");
  return { kind: "result", png: await renderCard(resultSvg(v, winner)), caption, markup: button("🏆 Scorecard & leaderboard", matchLink(v.key)), matchKey: v.key };
}

export async function buildTodayCard(views: MatchView[], now = Date.now()): Promise<CardPost> {
  const lines = [`📅 <b>Today's matches · ${esc(istDate(now))}</b>`, ""];
  for (const v of views.slice(0, 8)) {
    lines.push(`${v.status === "live" ? "🔴" : "🏏"} ${esc(title(v))} · ${v.status === "live" ? "LIVE" : `${istTime(v.startAt)} IST`}`);
  }
  lines.push("", "🎯 Free predictions · 🎡 daily free spin · no betting");
  return { kind: "today", png: await renderCard(todaySvg(views, now)), caption: lines.join("\n"), markup: button("📅 Open today's matches", miniAppLink("live")) };
}

async function post(card: CardPost, target: string | number = env.channelId): Promise<TgResult> {
  const res = await sendPhotoCard(target, card.png, card.caption, card.markup);
  if (res.ok && res.messageId && String(target) === String(env.channelId)) {
    await rememberChannelPost({ chatId: String(target), messageId: res.messageId, matchKey: card.matchKey || "", kind: card.kind, text: card.caption }).catch(() => undefined);
  }
  await redis.lpush("ll:chan:log", JSON.stringify({ at: Date.now(), kind: card.kind, matchKey: card.matchKey || null, ok: res.ok, err: res.ok ? undefined : res.description, target: String(target) === String(env.channelId) ? "channel" : "dm" })).catch(() => undefined);
  await redis.ltrim("ll:chan:log", 0, 199).catch(() => undefined);
  return res;
}

async function once(key: string, ttl = 7 * DAY): Promise<boolean> {
  return (await redis.set(`ll:chan2:${key}`, "1", "EX", ttl, "NX")) === "OK";
}

function winnerSide(m: CricketMatchState): "a" | "b" | null {
  const w = String(m.winner || "");
  if (w === "a" || w === m.teams.a.key) return "a";
  if (w === "b" || w === m.teams.b.key) return "b";
  return null;
}

/** One pass of the auto-poster. Safe to call often; a Redis lock keeps it single-flight across replicas. */
export async function channelTick(now = Date.now()): Promise<void> {
  const settings = await channelSettings();
  if (!settings.live) return;
  const lock = await redis.set("ll:chan2:lock", String(process.pid), "PX", 25_000, "NX");
  if (!lock) return;
  try {
    const cfg = settings.config;
    const matches = realMatches(await readUniverse());
    for (const m of matches) {
      await tickMatch(m, cfg, now).catch((err) => console.error(JSON.stringify({ level: "warn", msg: "channel-match", key: m.key, err: String(err) })));
    }
    if (cfg.daily && istHour(now) >= cfg.dailyHourIst && istHour(now) < 22) {
      const today = istDay(now);
      const todays = matches
        .filter((m) => m.status === "live" || (m.status === "upcoming" && istDay(m.startAt) === today))
        .sort((a, b) => a.startAt - b.startAt)
        .map((m) => projectMatch(m, false, now));
      if (todays.length && (await once(`today:${today}`, 2 * DAY))) {
        await post(await buildTodayCard(todays, now));
      }
    }
  } finally {
    await redis.del("ll:chan2:lock").catch(() => undefined);
  }
}

async function tickMatch(m: CricketMatchState, cfg: ChannelConfig, now: number) {
  const snapKey = `ll:chan2:snap:${m.key}`;
  const prevRaw = await redis.get(snapKey);
  const prev = prevRaw ? (JSON.parse(prevRaw) as Snap) : null;
  const cur = snapOf(m);
  await redis.set(snapKey, JSON.stringify(cur), "EX", 3 * DAY);

  // Starting soon (with toss + XI when known), or a late "live now" card if we missed the window.
  if (cfg.startingSoon) {
    const lead = m.startAt - now;
    const soon = m.status === "upcoming" && lead > 0 && (lead <= cfg.startLeadMin * 60_000 || (Boolean(m.toss) && lead <= 90 * 60_000));
    const justLive = m.status === "live" && now - m.startAt < 30 * 60_000 && prev?.status !== "live";
    if ((soon || justLive) && (await once(`start:${m.key}`))) {
      await post(await buildStartCard(projectMatch(m, true, now), now));
      return;
    }
  }
  if (!prev) return; // first sighting: snapshot only
  const view = projectMatch(m, true, now);

  if (cfg.result && m.status === "completed" && prev.status === "live") {
    if (await once(`result:${m.key}`)) await post(await buildResultCard(view, winnerSide(m)));
    return;
  }
  if (m.status !== "live") return;

  if (cfg.innings && cur.inn > prev.inn && (await once(`innings:${m.key}:${cur.inn}`))) {
    await post(await buildInningsCard(view));
    return;
  }

  if (!cfg.moments) return;
  const inn = m.innings[m.current];
  const names = new Map<string, string>();
  for (const p of [...(m.squads?.a || []), ...(m.squads?.b || [])]) names.set(p.id, p.name);
  const nameOf = (id: string) => names.get(id) || id.replace(/^[a-z]+_/, "").replace(/_/g, " ");
  const newHundred = cur.hundreds.find((x) => !prev.hundreds.includes(x));
  const newFifty = cur.fifties.find((x) => !prev.fifties.includes(x) && !cur.hundreds.includes(x));
  const newWicket = cur.inn === prev.inn && (cur.wk[cur.inn] || 0) > (prev.wk[cur.inn] || 0);
  let moment: { kind: MomentKind; headline: string; detail: string; id: string } | null = null;
  if (newHundred) {
    const b = inn?.batters.find((x) => `${m.current}:${x.id}` === newHundred);
    if (b) moment = { kind: "hundred", headline: `${nameOf(b.id)} ${b.runs}*`, detail: `${b.runs} off ${b.balls} balls · ${b.fours} fours · ${b.sixes} sixes`, id: newHundred };
  } else if (newWicket && inn) {
    const out = [...inn.batters].reverse().find((x) => x.out);
    const wk = cur.wk[cur.inn];
    moment = {
      kind: "wicket",
      headline: out ? `${nameOf(out.id)} ${out.runs} (${out.balls})` : `Wicket no. ${wk}`,
      detail: out?.dismissal ? out.dismissal : `${m.teams[inn.team]?.code || ""} lose wicket ${wk}`.trim(),
      id: `w${cur.inn}:${wk}`,
    };
  } else if (newFifty) {
    const b = inn?.batters.find((x) => `${m.current}:${x.id}` === newFifty);
    if (b) moment = { kind: "fifty", headline: `${nameOf(b.id)} ${b.runs}*`, detail: `${b.runs} off ${b.balls} balls · ${b.fours} fours · ${b.sixes} sixes`, id: newFifty };
  }
  if (!moment) return;
  if (!(await once(`moment:${m.key}:${moment.id}`))) return;
  // Max one key-moment card per match per gap window (default 10 min). Milestones beat wickets only by order above.
  const gate = await redis.set(`ll:chan2:gap:${m.key}`, "1", "EX", cfg.momentGapMin * 60, "NX");
  if (!gate) return;
  await post(await buildMomentCard(view, moment.kind, moment.headline, moment.detail));
}

/** Owner test: render a card for a real match (or the best available) and DM it. Never touches the channel. */
export async function sendTestCard(chatId: string | number, kind: "start" | "moment" | "innings" | "result" | "today" = "start") {
  const all = await readUniverse();
  const pool = realMatches(all).length ? realMatches(all) : all;
  const pick = pool.find((m) => m.status === "live") || pool.find((m) => m.status === "upcoming") || pool[0];
  if (!pick) throw new Error("NO_MATCHES");
  const now = Date.now();
  const v = projectMatch(pick, true, now);
  let card: CardPost;
  if (kind === "today") card = await buildTodayCard(pool.filter((m) => m.status !== "completed").map((m) => projectMatch(m, false, now)).slice(0, 6), now);
  else if (kind === "result") card = await buildResultCard(v, winnerSide(pick));
  else if (kind === "innings") card = await buildInningsCard(v);
  else if (kind === "moment") card = await buildMomentCard(v, "wicket", v.live?.striker?.name ? `${v.live.striker.name} out` : "Big wicket", v.live?.bowler?.name ? `b ${v.live.bowler.name}` : "Key breakthrough");
  else card = await buildStartCard(v, now);
  card.caption = `🧪 <b>Test card (DM only)</b>\n\n${card.caption}`;
  return post(card, chatId);
}

export async function channelLog(limit = 50) {
  const rows = await redis.lrange("ll:chan:log", 0, limit - 1).catch(() => [] as string[]);
  return rows.map((r) => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
}

export async function channelStats() {
  const since = new Date(Date.now() - 7 * DAY * 1000);
  const posts = await prisma.channelPost.groupBy({ by: ["kind"], where: { postedAt: { gte: since } }, _count: { _all: true } }).catch(() => [] as { kind: string; _count: { _all: number } }[]);
  return posts.map((p) => ({ kind: p.kind, count: p._count._all }));
}
