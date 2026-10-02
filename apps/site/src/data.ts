import Redis from "ioredis";
import { buildMatchPreview, projectMatch, type CricketMatchState, type MatchPreview, type MatchView } from "@liveline/shared";
import { env } from "./env";

/**
 * Read-only view of the live universe the api/worker poller keeps in Redis (`ll:universe`,
 * fed by Roanuz). The site never writes to it and never calls Roanuz itself.
 */
export const redis = new Redis(env.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: true });
redis.on("error", (err) => console.error(JSON.stringify({ level: "error", msg: "redis", err: String(err) })));

let cache: CricketMatchState[] = [];
let cacheAt = 0;

async function universe(): Promise<CricketMatchState[]> {
  if (Date.now() - cacheAt < 1500) return cache;
  try {
    if (redis.status === "wait") await redis.connect();
    const raw = await redis.get("ll:universe");
    const all = raw ? (JSON.parse(raw) as CricketMatchState[]) : [];
    cache = env.useMock ? all : all.filter((m) => !m.demo && !m.key.startsWith("demo_"));
    cacheAt = Date.now();
  } catch (err) {
    console.error(JSON.stringify({ level: "error", msg: "universe-read", err: String(err) }));
  }
  return cache;
}

/** Public, money-free projection: strip win probability, "luck" meter, wicket-chance forecast and game hooks. */
export type SiteMatch = Omit<MatchView, "live"> & { live: null | Omit<NonNullable<MatchView["live"]>, "win" | "luck" | "forecast"> };

function sanitize(view: MatchView): SiteMatch {
  const out: any = { ...view };
  if (out.live) {
    const { win: _w, luck: _l, forecast: _f, ...rest } = out.live;
    out.live = rest;
  }
  delete out.predictionOpen;
  delete out.voteOpen;
  delete out.overs10;
  delete out.nextBallIndex;
  return out as SiteMatch;
}

export async function listMatches(): Promise<SiteMatch[]> {
  const now = Date.now();
  const rows = (await universe()).map((m) => sanitize(projectMatch(m, false, now, 800)));
  const rank = { live: 0, upcoming: 1, completed: 2 } as Record<string, number>;
  return rows.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || (a.status === "completed" ? b.startAt - a.startAt : a.startAt - b.startAt));
}

export async function getMatch(key: string): Promise<SiteMatch | null> {
  const state = (await universe()).find((m) => m.key === key);
  return state ? sanitize(projectMatch(state, true, Date.now(), 800)) : null;
}

/** Real pre-match context (form, H2H, venue, standings) from completed matches in the universe. */
export async function getPreview(key: string): Promise<MatchPreview | null> {
  const all = await universe();
  const state = all.find((m) => m.key === key);
  return state ? buildMatchPreview(state, all) : null;
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "match";
}

export function matchPath(m: Pick<MatchView, "key" | "name">): string {
  return `/match/${encodeURIComponent(m.key)}/${slugify(m.name)}`;
}
