import {
  advanceMatch,
  buildDemoUniverse,
  celebrations,
  projectMatch,
  type AdvanceResult,
  type CricketMatchState,
  type MatchView,
} from "@liveline/shared";
import { env } from "./env";
import { redis } from "./redis";
import { mapPoints, mapRoanuzMatch, RoanuzClient } from "./roanuz";

const UNIVERSE = "ll:universe";
let memory: CricketMatchState[] | null = null;
let memoryAt = 0;
let ticking = false;
let featuredUntil = 0;
let featuredCache: any[] = [];
const pointsCache = new Map<string, { at: number; rows: CricketMatchState["points"] }>();
let lockToken: string | null = null;
let timer: NodeJS.Timeout | null = null;
const roanuz = new RoanuzClient();
const nextFetch = new Map<string, number>();
let socketKeys = "";

type FeedHook = (events: AdvanceResult[]) => Promise<void>;
let hook: FeedHook = async () => {};

export function onFeedEvents(fn: FeedHook) {
  hook = fn;
}

export async function readUniverse(): Promise<CricketMatchState[]> {
  // The poller-lock holder owns the in-memory copy. Every other process (api, bot)
  // re-reads Redis at most once a second so it never serves a stale universe.
  if (memory && (lockToken || Date.now() - memoryAt < 1000)) return memory;
  const cached = await redis.get(UNIVERSE);
  if (cached) {
    memory = JSON.parse(cached) as CricketMatchState[];
    memoryAt = Date.now();
    return memory;
  }
  if (memory) return memory;
  memory = env.useMockProvider ? buildDemoUniverse(Date.now()) : [];
  await persist(memory);
  return memory;
}

async function persist(matches: CricketMatchState[]) {
  memory = matches;
  memoryAt = Date.now();
  await redis.set(UNIVERSE, JSON.stringify(matches));
}

export async function listSummaries(now = Date.now()): Promise<MatchView[]> {
  const matches = await readUniverse();
  return matches.map((match) => projectMatch(match, false, now, env.lockMs));
}

export async function getMatch(key: string, now = Date.now()): Promise<{ state: CricketMatchState; view: MatchView } | null> {
  const matches = await readUniverse();
  const state = matches.find((match) => match.key === key);
  if (!state) return null;
  return { state, view: projectMatch(state, true, now, env.lockMs) };
}

export function startPoller() {
  if (timer) return;
  timer = setInterval(() => {
    void tick().catch((err) => console.error(JSON.stringify({ level: "error", msg: "poller", err: String(err) })));
  }, 1000);
}

async function holdLock(): Promise<boolean> {
  if (!lockToken) {
    lockToken = `p_${process.pid}_${Date.now()}`;
    const ok = await redis.set("ll:poller", lockToken, "PX", 12_000, "NX");
    if (!ok) {
      lockToken = null;
      return false;
    }
    return true;
  }
  const current = await redis.get("ll:poller");
  if (current !== lockToken) {
    lockToken = null;
    return false;
  }
  await redis.pexpire("ll:poller", 12_000);
  return true;
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    if (!(await holdLock())) return;
    const now = Date.now();
    if (env.useMockProvider || !roanuz.configured()) {
      await tickMock(now);
      return;
    }
    await tickRoanuz(now);
  } finally {
    ticking = false;
  }
}

async function tickMock(now: number) {
  let matches = await readUniverse();
  if (!matches.length) matches = buildDemoUniverse(now);
  const events: AdvanceResult[] = [];
  matches = matches.map((match) => {
    if (match.status === "upcoming" && match.startAt <= now) {
      match = { ...match, status: "live", nextBallAt: now + env.simTickMs };
      events.push({ match, events: [`start:${match.key}`] });
    }
    if (match.breakUntil && now < match.breakUntil) return match;
    if (match.breakUntil && now >= match.breakUntil) {
      match = { ...match, breakUntil: undefined, breakKind: undefined };
    }
    if (match.status === "live" && now >= match.nextBallAt) {
      const stepped = advanceMatch(match, Math.random, now);
      stepped.match.nextBallAt = now + env.simTickMs;
      events.push(stepped);
      return stepped.match;
    }
    return match;
  });
  if (!matches.some((match) => match.status === "live")) {
    const fresh = buildDemoUniverse(now)[0];
    const idx = matches.findIndex((match) => match.key === fresh.key);
    if (idx >= 0) matches[idx] = fresh;
    else matches.unshift(fresh);
    events.push({ match: fresh, events: [`start:${fresh.key}`] });
  }
  await persist(matches);
  if (events.length) {
    await publish(events);
    await hook(events).catch((err) => console.error(JSON.stringify({ level: "error", msg: "feed-hook", err: String(err) })));
  }
}

async function tickRoanuz(now: number) {
  if (now >= featuredUntil) {
    const featured = await roanuz.get("/featured-matches-2/");
    featuredCache = extractMatches(featured.body);
    featuredUntil = now + Math.max(15_000, featured.cache.maxAgeMs);
    console.log(JSON.stringify({
      level: "info",
      msg: "roanuz-featured",
      count: featuredCache.length,
      matches: featuredCache.map((m: any) => `${m?.name} [${m?.status}]`),
    }));
  }
  const list = featuredCache;
  let matches = await readUniverse();
  const byKey = new Map(matches.map((match) => [match.key, match]));
  for (const raw of list) {
    const mapped = mapRoanuzMatch(raw);
    if (!mapped) continue;
    const prev = byKey.get(mapped.key);
    if (prev && (nextFetch.get(mapped.key) || 0) > now) {
      continue;
    }
    let next = prev && mapped.status !== "live" ? { ...prev, status: mapped.status } : mapped;
    try {
      const detail = await roanuz.get(`/match/${mapped.key}/`);
      next = mapRoanuzMatch(detail.body) || next;
      // Upcoming/completed matches change slowly; do not spend the request budget on them.
      const floor = next.status === "live" ? 3_000 : 120_000;
      nextFetch.set(mapped.key, now + Math.max(floor, detail.cache.maxAgeMs));
      if (next.seriesKey && next.seriesKey !== "series") {
        const hit = pointsCache.get(next.seriesKey);
        if (hit && now - hit.at < 10 * 60_000) {
          next.points = hit.rows;
        } else {
          try {
            const table = await roanuz.get(`/tournament/${next.seriesKey}/points/`);
            next.points = mapPoints(table.body);
          } catch {
            next.points = [];
          }
          pointsCache.set(next.seriesKey, { at: now, rows: next.points });
        }
      }
    } catch (err) {
      nextFetch.set(mapped.key, now + 30_000);
      console.error(JSON.stringify({ level: "warn", msg: "roanuz-match", key: mapped.key, err: String(err) }));
    }
    const events: string[] = [];
    if (prev?.status !== "live" && next.status === "live") events.push(`start:${next.key}`);
    if (prev?.status !== "completed" && next.status === "completed") events.push(`result:${next.key}:${next.winner || "tie"}`);
    byKey.set(next.key, next);
    if (events.length) {
      void hook([{ match: next, events }]).catch(() => undefined);
    }
  }
  matches = [...byKey.values()];
  await persist(matches);
  const liveKeys = matches.filter((match) => match.status === "live").map((match) => match.key);
  const signature = liveKeys.join(",");
  if (signature && signature !== socketKeys) {
    socketKeys = signature;
    for (const key of liveKeys) {
      void roanuz.subscribeSocket(key).catch((err) => {
        console.error(JSON.stringify({ level: "warn", msg: "roanuz-subscribe", key, err: String(err) }));
      });
    }
    roanuz.connectSocket(liveKeys, (key, payload) => {
      const mapped = mapRoanuzMatch(payload);
      if (!mapped) return;
      void readUniverse().then(async (current) => {
        const replaced = current.map((match) => (match.key === key ? { ...mapped, points: match.points, h2h: match.h2h } : match));
        await persist(replaced);
        await redis.publish("ll:live", JSON.stringify({ key, moment: null }));
      });
    });
  }
  await redis.publish("ll:live", JSON.stringify({ key: "*", moment: null }));
}

function extractMatches(body: any): any[] {
  const data = body?.data?.matches || body?.data || [];
  if (Array.isArray(data)) return data;
  return Object.values(data);
}

async function publish(events: AdvanceResult[]) {
  for (const event of events) {
    const moments = celebrations(event.moment, event.events);
    await redis.publish(
      "ll:live",
      JSON.stringify({
        key: event.match.key,
        moment: moments[0] || null,
        moments,
        ball: event.ball ? { runs: event.ball.batRuns, wicket: event.ball.wicket, text: event.ball.text } : null,
      }),
    );
  }
}

export async function forceBreak(matchKey: string, ms = 90_000) {
  const matches = await readUniverse();
  const until = Date.now() + ms;
  const next = matches.map((match) => match.key === matchKey ? { ...match, breakUntil: until, breakKind: "timeout" as const } : match);
  await persist(next);
  await redis.publish("ll:live", JSON.stringify({ key: matchKey, moment: null, moments: [] }));
  return until;
}

export async function publishMoment(matchKey: string, moment: string) {
  await redis.publish("ll:live", JSON.stringify({ key: matchKey, moment, moments: [moment] }));
}

export async function forceTick(): Promise<MatchView[]> {
  await tickMock(Date.now() + env.simTickMs);
  return listSummaries();
}
