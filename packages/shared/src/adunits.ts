/**
 * Ads manager (admin "🖼 Ads"): one ad = one creative shown in one or more placements.
 * Placement = `<surface>_<position>`; pages narrow it to screens (empty = every screen).
 * Shared by the api (Mini App serving), apps/site (website serving) and the admin UI.
 */
export const AD_KINDS = ["banner", "native", "video", "html"] as const;
export type AdKind = (typeof AD_KINDS)[number];
export const AD_SURFACES = ["site", "app"] as const;
export type AdSurface = (typeof AD_SURFACES)[number];
export const AD_POSITIONS = ["top", "infeed", "sticky", "interstitial"] as const;
export type AdPosition = (typeof AD_POSITIONS)[number];
export const AD_PAGES = ["home", "match", "schedule", "lino"] as const;
export type AdPage = (typeof AD_PAGES)[number];
export const AD_PLACEMENTS = AD_SURFACES.flatMap((s) => AD_POSITIONS.map((p) => `${s}_${p}` as const));
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

/** Recommended creative sizes per position (shown in the admin form). */
export const AD_SIZES: Record<AdPosition, { label: string; size: string; ratio: string }> = {
  top: { label: "Top leaderboard", size: "728×90 (desktop) · 320×100 (mobile)", ratio: "32 / 10" },
  infeed: { label: "In-feed", size: "1200×628 or 300×250", ratio: "1.91 / 1" },
  sticky: { label: "Sticky bottom", size: "320×50 · 728×90", ratio: "6.4 / 1" },
  interstitial: { label: "Interstitial / fullscreen", size: "1080×1920 · 320×480", ratio: "9 / 16" },
};

export const AD_LIMITS = { imageBytes: 3 * 1024 * 1024, videoBytes: 20 * 1024 * 1024, htmlChars: 20_000 };

export type AdImages = Partial<Record<"default" | AdPosition, string>>;

export interface PublicAdUnit {
  id: string;
  kind: AdKind;
  title: string;
  body: string;
  cta: string;
  images: AdImages;
  videoUrl: string;
  posterUrl: string;
  html: string;
  targetUrl: string;
  openMode: "inapp" | "external";
  frameable: boolean;
  placements: string[];
  pages: string[];
  startsAt: number | null;
  endsAt: number | null;
  priority: number;
  weight: number;
  freqCap: number;
}

export function positionOf(placement: string): AdPosition {
  return (placement.split("_")[1] || "infeed") as AdPosition;
}

export function adIsLive(ad: Pick<PublicAdUnit, "startsAt" | "endsAt">, now = Date.now()): boolean {
  return (!ad.startsAt || ad.startsAt <= now) && (!ad.endsAt || ad.endsAt > now);
}

export function adUnitEligible(ad: PublicAdUnit, placement: string, page: string, now = Date.now()): boolean {
  if (!ad.placements.includes(placement) || !adIsLive(ad, now)) return false;
  if (ad.pages.length && !ad.pages.includes(page)) return false;
  // HTML / script embeds (AdSense etc.) only run on the website.
  if (ad.kind === "html" && !placement.startsWith("site_")) return false;
  if (ad.kind === "video" && !ad.videoUrl) return false;
  if ((ad.kind === "banner" || ad.kind === "native") && !adImage(ad, positionOf(placement))) return ad.kind === "native" && Boolean(ad.title);
  return true;
}

/** Highest priority wins; ads with the same priority rotate by weight. */
export function pickAdUnit(ads: PublicAdUnit[], placement: string, page: string, rnd = Math.random(), now = Date.now(), exclude: Set<string> = new Set()): PublicAdUnit | null {
  const pool = ads.filter((ad) => !exclude.has(ad.id) && adUnitEligible(ad, placement, page, now));
  if (!pool.length) return null;
  const top = Math.max(...pool.map((a) => a.priority));
  const tier = pool.filter((a) => a.priority === top);
  const total = tier.reduce((s, a) => s + Math.max(1, a.weight), 0);
  let roll = rnd * total;
  for (const ad of tier) {
    roll -= Math.max(1, ad.weight);
    if (roll < 0) return ad;
  }
  return tier[tier.length - 1];
}

export function adImage(ad: Pick<PublicAdUnit, "images">, position: AdPosition): string {
  return ad.images[position] || ad.images.default || "";
}

/** Redis keys shared by api + site. */
export const ADUNITS_KEY = "ll:adunits";
export const ADSTAT_KEY = "ll:adstat";
export function adStatField(id: string, day: string, surface: string, placement: string, page: string, type: "i" | "c"): string {
  return [id, day, surface, placement, page, type].map((p) => String(p).replace(/\|/g, "")).join("|");
}
