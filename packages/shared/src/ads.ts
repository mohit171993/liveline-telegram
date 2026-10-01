export interface AdCandidate {
  id: string;
  slot: string;
  weight: number;
  active: boolean;
  campaignStatus: string;
  startAt: number | null;
  endAt: number | null;
  matchKeys: string[];
  seriesKeys: string[];
  teamKeys: string[];
  languages: string[];
  frequencyCap: number;
  seen: number;
  headline: string;
  body: string;
}

export interface AdContext {
  now: number;
  slot: string;
  matchKey?: string;
  seriesKey?: string;
  teamKeys?: string[];
  language?: string;
}

export function adEligible(ad: AdCandidate, ctx: AdContext): boolean {
  if (!ad.active || ad.campaignStatus !== "active") return false;
  if (ad.slot !== ctx.slot) return false;
  if (ad.startAt && ctx.now < ad.startAt) return false;
  if (ad.endAt && ctx.now > ad.endAt) return false;
  if (ad.seen >= ad.frequencyCap) return false;
  if (ad.matchKeys.length && (!ctx.matchKey || !ad.matchKeys.includes(ctx.matchKey))) return false;
  if (ad.seriesKeys.length && (!ctx.seriesKey || !ad.seriesKeys.includes(ctx.seriesKey))) return false;
  if (ad.teamKeys.length) {
    const teams = ctx.teamKeys || [];
    if (!ad.teamKeys.some((key) => teams.includes(key))) return false;
  }
  if (ad.languages.length && ctx.language && !ad.languages.includes(ctx.language)) return false;
  return true;
}

export function selectAd<T extends AdCandidate>(ads: T[], ctx: AdContext, rnd: number): T | null {
  const pool = ads.filter((ad) => adEligible(ad, ctx));
  if (!pool.length) return null;
  const total = pool.reduce((sum, ad) => sum + Math.max(1, ad.weight), 0);
  let cursor = rnd * total;
  for (const ad of pool) {
    cursor -= Math.max(1, ad.weight);
    if (cursor < 0) return ad;
  }
  return pool[pool.length - 1];
}

export function impressionDedupeKey(userId: string, creativeId: string, nowMs: number): string {
  const hour = Math.floor(nowMs / 3_600_000);
  return `imp:${userId}:${creativeId}:${hour}`;
}

export function clickDedupeKey(userId: string, creativeId: string, nowMs: number): string {
  const day = Math.floor(nowMs / 86_400_000);
  return `clk:${userId}:${creativeId}:${day}`;
}

/** Seed, E2E, and example.com campaigns are not real sponsors. */
export function isPlaceholderSponsor(input: {
  campaignName?: string | null;
  advertiserId?: string | null;
  contact?: string | null;
  clickUrl?: string | null;
}): boolean {
  const name = (input.campaignName || "").trim();
  if (/^harbour night line$/i.test(name) || /^e2e\b/i.test(name)) return true;
  const advertiser = (input.advertiserId || "").trim().toLowerCase();
  if (advertiser === "seed_harbour" || advertiser.startsWith("seed_")) return true;
  const contact = (input.contact || "").trim().toLowerCase();
  if (contact.endsWith(".example")) return true;
  const raw = (input.clickUrl || "").trim();
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    if (host === "example.com" || host.endsWith(".example.com") || host.endsWith(".example")) return true;
  } catch {
    if (/example\.com/i.test(raw)) return true;
  }
  return false;
}
