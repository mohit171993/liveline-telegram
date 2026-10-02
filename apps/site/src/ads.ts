import crypto from "crypto";
import { GetObjectCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { ADSTAT_KEY, ADUNITS_KEY, AD_PAGES, AD_PLACEMENTS, adImage, adStatField, pickAdUnit, positionOf, type AdPosition, type PublicAdUnit } from "@liveline/shared";
import { redis } from "./data";
import { esc } from "./html";

/** Ads manager on the website: reads the active list the api publishes to Redis, renders, tracks. */
let cache: { at: number; ads: PublicAdUnit[] } = { at: 0, ads: [] };
export async function siteAds(): Promise<PublicAdUnit[]> {
  if (Date.now() - cache.at < 5000) return cache.ads;
  try {
    if (redis.status === "wait") await redis.connect();
    const raw = await redis.get(ADUNITS_KEY);
    cache = { at: Date.now(), ads: raw ? (JSON.parse(raw) as PublicAdUnit[]) : [] };
  } catch { /* keep previous */ }
  return cache.ads;
}

const istDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function link(ad: PublicAdUnit, pl: string, page: string, inner: string, cls: string): string {
  const ext = ad.openMode === "external";
  return `<a class="${cls}" href="/ad/go/${encodeURIComponent(ad.id)}?pl=${pl}&pg=${page}" rel="sponsored noopener"${ext ? ` target="_blank"` : ""}>${inner}</a>`;
}

function creative(ad: PublicAdUnit, pos: AdPosition): string {
  if (ad.kind === "video") {
    return `<video class="ad-video" src="${esc(ad.videoUrl)}"${ad.posterUrl ? ` poster="${esc(ad.posterUrl)}"` : ""} autoplay muted loop playsinline preload="metadata"></video>${ad.title || ad.cta ? `<span class="ad-vcap">${ad.title ? `<b>${esc(ad.title)}</b>` : ""}${ad.cta ? `<i class="ad-cta">${esc(ad.cta)}</i>` : ""}</span>` : ""}`;
  }
  if (ad.kind === "native") {
    const img = adImage(ad, pos);
    return `<span class="ad-native">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ""}<span><b>${esc(ad.title)}</b>${ad.body ? `<span>${esc(ad.body)}</span>` : ""}${ad.cta ? `<i class="ad-cta">${esc(ad.cta)}</i>` : ""}</span></span>`;
  }
  return `<img class="ad-img" src="${esc(adImage(ad, pos))}" alt="${esc(ad.title || "Advertisement")}" loading="${pos === "top" ? "eager" : "lazy"}">`;
}

function render(ad: PublicAdUnit, placement: string, page: string): string {
  const pos = positionOf(placement);
  const data = `data-ad="${esc(ad.id)}" data-pl="${placement}" data-pg="${page}"`;
  const inner = ad.kind === "html" ? `<div class="ad-embed">${ad.html}</div>` : link(ad, placement, page, creative(ad, pos), "ad-link");
  if (pos === "sticky") return `<div class="ad ad-sticky ad-k-${ad.kind}" ${data}>${inner}<small class="ad-tag">Ad</small><button class="ad-x" type="button" aria-label="Close ad">✕</button></div>`;
  if (pos === "interstitial") {
    return `<div class="ad-inter" ${data} data-cap="${ad.freqCap}" hidden role="dialog" aria-label="Advertisement"><div class="ad-inter-card ad-k-${ad.kind}">${inner}</div><button class="ad-inter-x" type="button" disabled>Close in 3</button><small class="ad-tag">Ad</small></div>`;
  }
  return `<div class="ad ad-${pos} ad-k-${ad.kind}" ${data}>${inner}<small class="ad-tag">Ad</small></div>`;
}

/** Replaces <!--ad:POS--> markers in a rendered page with picked creatives. */
export async function injectAds(html: string): Promise<string> {
  const page = /<!--adpage:(\w+)-->/.exec(html)?.[1];
  if (!page) return html;
  html = html.replace(/<!--adpage:\w+-->/, "");
  const ads = await siteAds();
  const order = ["interstitial", "top", "sticky", "infeed"];
  const picks = new Map<string, string[]>();
  for (const pos of order) {
    const count = (html.match(new RegExp(`<!--ad:${pos}-->`, "g")) || []).length;
    const list: string[] = [];
    const used = new Set<string>(); // distinct creatives when a page has several slots of one kind
    for (let i = 0; i < count; i++) {
      const ad = ads.length ? pickAdUnit(ads, `site_${pos}`, page, Math.random(), Date.now(), used) : null;
      if (ad) { used.add(ad.id); list.push(render(ad, `site_${pos}`, page)); } else list.push("");
    }
    picks.set(pos, list);
  }
  return html.replace(/<!--ad:(top|infeed|sticky|interstitial)-->/g, (_m, pos: string) => picks.get(pos)?.shift() || "");
}

/* ---------- tracking (Redis counters; the api flushes them into Reports) ---------- */

export function viewerId(ip: string, ua: string): string {
  return crypto.createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 16);
}

export async function trackSiteAd(input: { id: string; type: "impression" | "click"; placement: string; page: string; viewer: string }): Promise<PublicAdUnit | null> {
  if (!(AD_PLACEMENTS as readonly string[]).includes(input.placement) || !input.placement.startsWith("site_") || !(AD_PAGES as readonly string[]).includes(input.page)) return null;
  const ad = (await siteAds()).find((a) => a.id === input.id) || null;
  if (!ad) return null;
  try {
    const ok = await redis.set(`ll:adseen:site:${input.type}:${input.viewer}:${ad.id}:${input.placement}:${input.page}`, "1", "EX", input.type === "impression" ? 20 : 3, "NX");
    if (ok) await redis.hincrby(ADSTAT_KEY, adStatField(ad.id, istDay(), "site", input.placement, input.page, input.type === "impression" ? "i" : "c"), 1);
  } catch { /* never block the redirect */ }
  return ad;
}

/* ---------- media: private Railway bucket, served from our own /ads-media path ---------- */

const S3 = {
  endpoint: process.env.ADS_S3_ENDPOINT || "", bucket: process.env.ADS_S3_BUCKET || "", key: process.env.ADS_S3_ACCESS_KEY_ID || "",
  secret: process.env.ADS_S3_SECRET_ACCESS_KEY || "", region: process.env.ADS_S3_REGION || "auto", pathStyle: process.env.ADS_S3_PATH_STYLE === "true",
};
const API_INTERNAL = (process.env.API_INTERNAL_URL || "").replace(/\/$/, "");
let client: S3Client | null = null;
function s3(): S3Client | null {
  if (!S3.endpoint || !S3.bucket || !S3.key) return null;
  if (!client) client = new S3Client({ region: S3.region, endpoint: S3.endpoint, forcePathStyle: S3.pathStyle, credentials: { accessKeyId: S3.key, secretAccessKey: S3.secret } });
  return client;
}
export const MEDIA_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", webm: "video/webm" };
const memo = new Map<string, { at: number; body: Buffer; type: string }>();

export async function adMedia(file: string): Promise<{ body: Buffer; type: string } | null> {
  if (!/^[A-Za-z0-9._-]+$/.test(file)) return null;
  const type = MEDIA_TYPES[file.split(".").pop()!.toLowerCase()];
  if (!type) return null;
  const hit = memo.get(file);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit;
  let body: Buffer | null = null;
  const c = s3();
  if (c) {
    try { const out = await c.send(new GetObjectCommand({ Bucket: S3.bucket, Key: `ads/${file}` })); body = Buffer.from(await out.Body!.transformToByteArray()); } catch { body = null; }
  } else if (API_INTERNAL) {
    try { const r = await fetch(`${API_INTERNAL}/ads-media/${file}`); if (r.ok) body = Buffer.from(await r.arrayBuffer()); } catch { body = null; }
  }
  if (!body) return null;
  if (memo.size > 40) memo.clear();
  const row = { at: Date.now(), body, type };
  memo.set(file, row);
  return row;
}

export async function adStorageOk(): Promise<string> {
  const c = s3();
  if (!c) return API_INTERNAL ? "api-proxy" : "none";
  try { await c.send(new HeadBucketCommand({ Bucket: S3.bucket })); return "ok"; } catch { return "error"; }
}
