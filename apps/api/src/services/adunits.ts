import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@liveline/db";
import { z } from "zod";
import {
  AD_KINDS, AD_LIMITS, AD_PAGES, AD_PLACEMENTS, ADSTAT_KEY, ADUNITS_KEY, adStatField, istDay, pickAdUnit, positionOf,
  type AdImages, type PublicAdUnit,
} from "@liveline/shared";
import { env } from "../env";
import { httpError } from "../httpError";
import { redis } from "../redis";
import { frameCheck } from "./sponsors";

/* ------------------------------------------------------------------ input */

const opt = z.string().trim().max(500).default("");
const media = z.string().trim().max(300).regex(/^(\/ads-media\/[A-Za-z0-9._-]+)?$/, "Upload the file first").default("");
export const adUnitInput = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(AD_KINDS),
  title: z.string().trim().max(90).default(""),
  body: z.string().trim().max(240).default(""),
  cta: z.string().trim().max(30).default(""),
  images: z.object({ default: media, top: media, infeed: media, sticky: media, interstitial: media, top_wide: media, sticky_wide: media }).partial().default({}),
  videoUrl: media,
  posterUrl: media,
  html: z.string().max(AD_LIMITS.htmlChars).default(""),
  targetUrl: opt,
  openMode: z.enum(["inapp", "external"]).default("inapp"),
  placements: z.array(z.enum(AD_PLACEMENTS as unknown as [string, ...string[]])).min(1).max(AD_PLACEMENTS.length),
  pages: z.array(z.enum(AD_PAGES)).max(AD_PAGES.length).default([]),
  startsAt: z.string().datetime({ offset: true }).nullish(),
  endsAt: z.string().datetime({ offset: true }).nullish(),
  priority: z.number().int().min(0).max(100).default(0),
  weight: z.number().int().min(1).max(100).default(1),
  freqCap: z.number().int().min(0).max(50).default(1),
  enabled: z.boolean().default(false),
});
export type AdUnitInput = z.infer<typeof adUnitInput>;
type Row = Awaited<ReturnType<typeof prisma.adUnit.findMany>>[number];

function cleanUrl(raw: string): string {
  if (!raw) return "";
  let u: URL;
  try { u = new URL(raw); } catch { throw httpError(400, "BAD_URL", "Enter a full https:// link."); }
  if (u.protocol !== "https:") throw httpError(400, "BAD_URL", "The link must start with https://");
  return u.toString();
}

function toData(input: AdUnitInput) {
  if (input.startsAt && input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) throw httpError(400, "BAD_SCHEDULE", "The end time must be after the start time.");
  const images = Object.fromEntries(Object.entries(input.images).filter(([, v]) => v)) as AdImages;
  if ((input.kind === "banner") && !Object.keys(images).length) throw httpError(400, "NO_IMAGE", "Upload at least one banner image.");
  if (input.kind === "native" && (!input.title || !images.default)) throw httpError(400, "NATIVE", "Native ads need an image and a title.");
  if (input.kind === "video" && !input.videoUrl) throw httpError(400, "NO_VIDEO", "Upload an mp4 or webm video.");
  if (input.kind === "html" && !input.html.trim()) throw httpError(400, "NO_HTML", "Paste the ad network code.");
  if (input.kind === "html" && !input.placements.some((p) => p.startsWith("site_"))) throw httpError(400, "HTML_SITE", "HTML / script embeds run on the website only. Pick a website placement.");
  // Drafts (off) may wait for their link (bulk upload); an ad that is switched on needs one.
  if (input.kind !== "html" && !input.targetUrl && input.enabled) throw httpError(400, "NO_LINK", "Add the link the ad opens before switching it on.");
  return {
    name: input.name, kind: input.kind, title: input.title, body: input.body, cta: input.cta, images,
    videoUrl: input.kind === "video" ? input.videoUrl : "", posterUrl: input.posterUrl, html: input.kind === "html" ? input.html : "",
    targetUrl: cleanUrl(input.targetUrl), openMode: input.openMode,
    placements: [...new Set(input.placements)].join(","), pages: [...new Set(input.pages)].join(","),
    startsAt: input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt ? new Date(input.endsAt) : null,
    priority: input.priority, weight: input.weight, freqCap: input.freqCap, enabled: input.enabled,
  };
}

export function publicAd(r: Row): PublicAdUnit {
  return {
    id: r.id, kind: r.kind as PublicAdUnit["kind"], title: r.title, body: r.body, cta: r.cta, images: (r.images || {}) as AdImages,
    videoUrl: r.videoUrl, posterUrl: r.posterUrl, html: r.html, targetUrl: r.targetUrl, openMode: r.openMode === "external" ? "external" : "inapp",
    frameable: r.frameable, placements: r.placements ? r.placements.split(",") : [], pages: r.pages ? r.pages.split(",") : [],
    startsAt: r.startsAt?.getTime() ?? null, endsAt: r.endsAt?.getTime() ?? null, priority: r.priority, weight: r.weight, freqCap: r.freqCap,
  };
}

/* ------------------------------------------------------------------ CRUD */

export async function createAdUnit(input: AdUnitInput, actor: string) {
  const data = toData(input);
  const frame = data.targetUrl ? await frameCheck(data.targetUrl) : { frameable: false, note: "" };
  const row = await prisma.adUnit.create({ data: { ...data, frameable: frame.frameable, createdBy: actor } });
  await publishAdUnits();
  return row;
}

export async function updateAdUnit(id: string, input: AdUnitInput) {
  const before = await prisma.adUnit.findUnique({ where: { id } });
  if (!before) throw httpError(404, "NOT_FOUND", "Ad not found.");
  const data = toData(input);
  const frameable = data.targetUrl && data.targetUrl !== before.targetUrl ? (await frameCheck(data.targetUrl)).frameable : before.frameable;
  const row = await prisma.adUnit.update({ where: { id }, data: { ...data, frameable } });
  await publishAdUnits();
  return row;
}

export async function setAdUnitEnabled(id: string, enabled: boolean) {
  if (enabled) {
    const cur = await prisma.adUnit.findUnique({ where: { id }, select: { kind: true, targetUrl: true } });
    if (cur && cur.kind !== "html" && !cur.targetUrl) throw httpError(400, "NO_LINK", "Add the link the ad opens before switching it on.");
  }
  const row = await prisma.adUnit.update({ where: { id }, data: { enabled } }).catch(() => null);
  if (!row) throw httpError(404, "NOT_FOUND", "Ad not found.");
  await publishAdUnits();
  return row;
}

export async function deleteAdUnit(id: string) {
  await prisma.adUnit.delete({ where: { id } }).catch(() => undefined);
  await publishAdUnits();
  return { ok: true };
}

/** Active ads → Redis, read by the website and the Mini App serving path. */
export async function publishAdUnits() {
  const rows = await prisma.adUnit.findMany({ where: { enabled: true }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] });
  const ads = rows.map(publicAd).filter((a) => !a.endsAt || a.endsAt > Date.now());
  await redis.set(ADUNITS_KEY, JSON.stringify(ads));
  cache = { at: Date.now(), ads };
  return ads.length;
}

let cache: { at: number; ads: PublicAdUnit[] } = { at: 0, ads: [] };
async function liveAds(): Promise<PublicAdUnit[]> {
  if (Date.now() - cache.at < 10_000) return cache.ads;
  try {
    const raw = await redis.get(ADUNITS_KEY);
    cache = { at: Date.now(), ads: raw ? (JSON.parse(raw) as PublicAdUnit[]) : [] };
  } catch { /* keep old */ }
  return cache.ads;
}

/** Mini App: one pick per app position for a screen. */
export async function appAdsFor(page: string) {
  const ads = await liveAds();
  const out: Record<string, PublicAdUnit> = {};
  for (const pl of ["app_interstitial", "app_top", "app_infeed", "app_sticky"]) {
    const ad = pickAdUnit(ads, pl, page, Math.random(), Date.now());
    if (ad) out[positionOf(pl)] = { ...ad, html: "" };
  }
  return out;
}

/* ------------------------------------------------------------------ tracking */

export async function trackAdUnit(input: { id: string; type: "impression" | "click"; surface: "site" | "app"; placement: string; page: string; viewer: string }) {
  if (!AD_PLACEMENTS.includes(input.placement as never) || !(AD_PAGES as readonly string[]).includes(input.page)) return { recorded: false };
  if (!(await liveAds()).some((a) => a.id === input.id)) return { recorded: false };
  const dedupe = `ll:adseen:${input.type}:${input.viewer}:${input.id}:${input.placement}:${input.page}`;
  if (!(await redis.set(dedupe, "1", "EX", input.type === "impression" ? 20 : 3, "NX"))) return { recorded: false, deduped: true };
  await redis.hincrby(ADSTAT_KEY, adStatField(input.id, istDay(), input.surface, input.placement, input.page, input.type === "impression" ? "i" : "c"), 1);
  return { recorded: true };
}

/** Moves Redis counters (written by the api and the website) into AdUnitStat. Safe to run from several processes. */
export async function flushAdStats() {
  const tmp = `${ADSTAT_KEY}:flush:${process.pid}:${Date.now()}`;
  try { await redis.rename(ADSTAT_KEY, tmp); } catch { return 0; } // nothing to flush
  const all = await redis.hgetall(tmp);
  const agg = new Map<string, { adId: string; day: string; surface: string; placement: string; page: string; i: number; c: number }>();
  for (const [field, val] of Object.entries(all)) {
    const [adId, day, surface, placement, page, type] = field.split("|");
    const k = [adId, day, surface, placement, page].join("|");
    const r = agg.get(k) || { adId, day, surface, placement, page, i: 0, c: 0 };
    if (type === "i") r.i += Number(val) || 0; else r.c += Number(val) || 0;
    agg.set(k, r);
  }
  const ids = new Set((await prisma.adUnit.findMany({ where: { id: { in: [...new Set([...agg.values()].map((r) => r.adId))] } }, select: { id: true } })).map((r) => r.id));
  for (const r of agg.values()) {
    if (!ids.has(r.adId)) continue;
    await prisma.adUnitStat.upsert({
      where: { adId_day_surface_placement_page: { adId: r.adId, day: r.day, surface: r.surface, placement: r.placement, page: r.page } },
      update: { impressions: { increment: r.i }, clicks: { increment: r.c } },
      create: { adId: r.adId, day: r.day, surface: r.surface, placement: r.placement, page: r.page, impressions: r.i, clicks: r.c },
    });
  }
  await redis.del(tmp);
  return agg.size;
}

let flushTimer: NodeJS.Timeout | null = null;
export function startAdUnitJobs() {
  if (flushTimer) return;
  void publishAdUnits().catch(() => undefined);
  flushTimer = setInterval(() => {
    void flushAdStats().catch((err) => console.error(JSON.stringify({ level: "error", msg: "adstat-flush", err: String(err) })));
  }, 30_000);
  // Re-publish every 5 min so schedules (start/end) and a cold Redis recover by themselves.
  setInterval(() => void publishAdUnits().catch(() => undefined), 5 * 60_000);
}

/* ------------------------------------------------------------------ reports */

const DAY = 86_400_000;
function dayKey(offset: number) { return istDay(new Date(Date.now() - offset * DAY)); }

export async function listAdUnits() {
  await flushAdStats().catch(() => undefined);
  const rows = await prisma.adUnit.findMany({ orderBy: [{ enabled: "desc" }, { priority: "desc" }, { createdAt: "desc" }] });
  const since = dayKey(29);
  const stats = await prisma.adUnitStat.findMany({ where: { day: { gte: since } } });
  const today = dayKey(0), d7 = dayKey(6);
  const now = Date.now();
  return {
    note: "Use legal brands only.",
    storage: storageMode(),
    ads: rows.map((r) => {
      const mine = stats.filter((s) => s.adId === r.id);
      const sum = (f: (s: (typeof mine)[number]) => boolean) => mine.filter(f).reduce((a, s) => ({ i: a.i + s.impressions, c: a.c + s.clicks }), { i: 0, c: 0 });
      const p = publicAd(r);
      const live = r.enabled && (!r.startsAt || r.startsAt.getTime() <= now) && (!r.endsAt || r.endsAt.getTime() > now);
      return { ...p, name: r.name, enabled: r.enabled, live, createdAt: r.createdAt, stats: { today: sum((s) => s.day === today), d7: sum((s) => s.day >= d7), d30: sum(() => true) } };
    }),
  };
}

export async function adUnitReport(days = 30) {
  await flushAdStats().catch(() => undefined);
  const n = Math.max(1, Math.min(365, days));
  const since = dayKey(n - 1);
  const [rows, stats] = await Promise.all([prisma.adUnit.findMany({ orderBy: { createdAt: "desc" } }), prisma.adUnitStat.findMany({ where: { day: { gte: since } } })]);
  return {
    days: n,
    rows: rows.map((r) => {
      const mine = stats.filter((s) => s.adId === r.id);
      const imp = mine.reduce((a, s) => a + s.impressions, 0), clk = mine.reduce((a, s) => a + s.clicks, 0);
      const site = mine.filter((s) => s.surface === "site"), app = mine.filter((s) => s.surface === "app");
      return {
        id: r.id, name: r.name, kind: r.kind, enabled: r.enabled, impressions: imp, clicks: clk, ctr: imp ? Math.round((clk / imp) * 1000) / 10 : 0,
        site: { i: site.reduce((a, s) => a + s.impressions, 0), c: site.reduce((a, s) => a + s.clicks, 0) },
        app: { i: app.reduce((a, s) => a + s.impressions, 0), c: app.reduce((a, s) => a + s.clicks, 0) },
      };
    }).filter((r) => r.impressions > 0 || r.clicks > 0 || r.enabled),
    detail: stats,
  };
}

const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export async function adUnitCsv(days = 30) {
  const rep = await adUnitReport(days);
  const names = new Map(rep.rows.map((r) => [r.id, r]));
  const all = await prisma.adUnit.findMany({ select: { id: true, name: true, kind: true } });
  const nm = new Map(all.map((a) => [a.id, a]));
  const lines = ["day,ad_id,ad_name,kind,surface,placement,page,impressions,clicks,ctr_pct"];
  for (const s of rep.detail.sort((a, b) => a.day.localeCompare(b.day))) {
    const a = nm.get(s.adId) || names.get(s.adId);
    lines.push([s.day, s.adId, a?.name || "", a?.kind || "", s.surface, s.placement, s.page, s.impressions, s.clicks, s.impressions ? ((s.clicks / s.impressions) * 100).toFixed(1) : "0"].map(cell).join(","));
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ media storage */

const LOCAL = path.resolve(process.cwd(), "uploads", "ads");
const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".webm": "video/webm" };
let s3: S3Client | null = null;
function bucket(): S3Client | null {
  if (!env.adsS3Bucket || !env.adsS3Endpoint || !env.adsS3Access) return null;
  if (!s3) s3 = new S3Client({ region: env.adsS3Region, endpoint: env.adsS3Endpoint, forcePathStyle: env.adsS3PathStyle, credentials: { accessKeyId: env.adsS3Access, secretAccessKey: env.adsS3Secret } });
  return s3;
}
export function storageMode() { return bucket() ? "bucket" : "disk"; }
export async function storageHealthy(): Promise<boolean> {
  const c = bucket();
  if (!c) return true;
  try { await c.send(new HeadBucketCommand({ Bucket: env.adsS3Bucket })); return true; } catch { return false; }
}

export function mediaLimit(ext: string) {
  return ext === ".mp4" || ext === ".webm" ? AD_LIMITS.videoBytes : AD_LIMITS.imageBytes;
}

export async function saveAdMedia(filename: string, buf: Buffer) {
  const ext = path.extname(filename || "").toLowerCase();
  if (!TYPES[ext]) throw httpError(400, "TYPE", "Use png, jpg, webp, gif, mp4 or webm.");
  if (buf.length > mediaLimit(ext)) throw httpError(413, "TOO_BIG", ext === ".mp4" || ext === ".webm" ? "Videos can be up to 20 MB." : "Images can be up to 3 MB.");
  const name = `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}${ext}`;
  const c = bucket();
  if (c) await c.send(new PutObjectCommand({ Bucket: env.adsS3Bucket, Key: `ads/${name}`, Body: buf, ContentType: TYPES[ext], CacheControl: "public, max-age=31536000, immutable" }));
  else { fs.mkdirSync(LOCAL, { recursive: true }); fs.writeFileSync(path.join(LOCAL, name), buf); }
  return { url: `/ads-media/${name}`, bytes: buf.length, type: TYPES[ext] };
}

export async function readAdMedia(file: string): Promise<{ body: Buffer; type: string } | null> {
  const name = path.basename(file);
  const type = TYPES[path.extname(name).toLowerCase()];
  if (!type || !/^[A-Za-z0-9._-]+$/.test(name)) return null;
  const c = bucket();
  if (c) {
    try {
      const out = await c.send(new GetObjectCommand({ Bucket: env.adsS3Bucket, Key: `ads/${name}` }));
      return { body: Buffer.from(await out.Body!.transformToByteArray()), type };
    } catch { return null; }
  }
  const full = path.join(LOCAL, name);
  return fs.existsSync(full) ? { body: fs.readFileSync(full), type } : null;
}
