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

/** Optional wide (desktop) variants: shown instead of the mobile image on screens ≥ AD_WIDE_MIN_PX. */
export const AD_WIDE_SLOTS = ["top_wide", "sticky_wide"] as const;
export type AdWideSlot = (typeof AD_WIDE_SLOTS)[number];
export type AdImageSlot = "default" | AdPosition | AdWideSlot;
export type AdImages = Partial<Record<AdImageSlot, string>>;
/** Viewport width from which the wide creative (728×90 etc.) replaces the mobile one (320×100 / 320×50). */
export const AD_WIDE_MIN_PX = 600;

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

/** Mobile / default image for a position (falls back to the wide variant, then the generic image). */
export function adImage(ad: Pick<PublicAdUnit, "images">, position: AdPosition): string {
  const wide = position === "top" || position === "sticky" ? ad.images[`${position}_wide`] : undefined;
  return ad.images[position] || wide || ad.images.default || "";
}

/** Wide-screen image for a position ("" when there is no separate wide creative). */
export function adImageWide(ad: Pick<PublicAdUnit, "images">, position: AdPosition): string {
  if (position !== "top" && position !== "sticky") return "";
  const wide = ad.images[`${position}_wide`] || "";
  return wide && wide !== adImage(ad, position) ? wide : "";
}

/** Bulk upload: which image slot a creative of w×h fills (wide leaderboards / sticky strips get their desktop slot). */
export function detectAdSlot(w: number, h: number): AdPosition | AdWideSlot {
  const pos = detectAdPosition(w, h);
  if ((pos === "top" || pos === "sticky") && w >= 700 && w / h >= 5) return `${pos}_wide`;
  return pos;
}

/** Redis keys shared by api + site. */
export const ADUNITS_KEY = "ll:adunits";
export const ADSTAT_KEY = "ll:adstat";
export function adStatField(id: string, day: string, surface: string, placement: string, page: string, type: "i" | "c"): string {
  return [id, day, surface, placement, page, type].map((p) => String(p).replace(/\|/g, "")).join("|");
}

/* ---------------- bulk upload: size → position detection ---------------- */

/** Known IAB / LiveLine creative sizes → position (checked first, ±2 px). 728×90 is ambiguous: top. */
const KNOWN_SIZES: [number, number, AdPosition][] = [
  [728, 90, "top"], [320, 100, "top"], [970, 250, "top"], [970, 90, "top"], [468, 60, "top"], [640, 200, "top"],
  [300, 250, "infeed"], [336, 280, "infeed"], [1200, 628, "infeed"], [1200, 627, "infeed"], [1080, 1080, "infeed"], [600, 600, "infeed"], [1200, 1200, "infeed"],
  [320, 50, "sticky"], [300, 50, "sticky"], [640, 100, "sticky"], [970, 66, "sticky"],
  [320, 480, "interstitial"], [1080, 1920, "interstitial"], [720, 1280, "interstitial"], [480, 320, "infeed"], [300, 600, "interstitial"],
];

/** Detect where a creative of w×h pixels fits best (exact known size first, then aspect ratio). */
export function detectAdPosition(w: number, h: number): AdPosition {
  if (!(w > 0 && h > 0)) return "infeed";
  for (const [kw, kh, pos] of KNOWN_SIZES) if (Math.abs(w - kw) <= 2 && Math.abs(h - kh) <= 2) return pos;
  const r = w / h;
  if (r < 0.8) return "interstitial"; // 9:16, 2:3, tall
  if (r < 2.4) return "infeed"; // square … 1.91:1
  if (r >= 10 || (r >= 5 && h <= 60)) return "sticky"; // very wide / thin strips
  return "top"; // 32:10 … 8:1 leaderboards
}

/** Campaign key from a filename: drops extension, size tokens and position/device words. */
export function creativeStem(fileName: string): string {
  const s = fileName.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[_.]+/g, " ")
    .replace(/\d{2,4}\s*[x×]\s*\d{2,4}/g, " ")
    .replace(/\b(top|leaderboard|infeed|in-feed|feed|sticky|footer|interstitial|fullscreen|full|mobile|mob|desktop|desk|banner|square|story|portrait|landscape|v\d+|final|copy|\d+)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
  return s || "creative";
}
