import fs from "fs";
import path from "path";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { abs, env } from "./env";
import { getMatch, listMatches, matchPath, redis } from "./data";
import { PREVIEWS } from "./content";
import { linoTake } from "./lino";
import { defaultOgSvg, matchOgSvg, previewOgSvg, renderPng } from "./og";
import { adMedia, adStorageOk, injectAds, trackSiteAd, viewerId } from "./ads";
import { gate, gateMiddleware, gateReady, registerGateRoutes, smsEnabled } from "./gate";
import { aboutPage, alertsPage, allSeries, homeLive, homePage, linoBlocks, linoPage, liveList, livePage, matchLive, matchPage, notFoundPage, previewPage, schedulePage, seriesPage } from "./pages";

const PUBLIC = path.resolve(__dirname, "../public");
const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".ttf": "font/ttf", ".woff2": "font/woff2", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".txt": "text/plain",
};

const app = new Hono();

app.use("*", async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "strict-origin-when-cross-origin");
  c.header("x-frame-options", "SAMEORIGIN");
  c.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
  if (!env.allowIndexing) c.header("x-robots-tag", "noindex, nofollow");
});

/* Mandatory phone verification (SITE_GATE_ENABLED, default on). Must run before every page route. */
app.use("*", gateMiddleware);
registerGateRoutes(app);

const html = async (page: string | Promise<string>, maxAge = 10) => new Response(await injectAds(await page), {
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=30` },
});
const frag = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

app.get("/healthz", async (c) => {
  let r = "down";
  try { if (redis.status === "wait") await redis.connect(); r = (await redis.ping()) === "PONG" ? "ok" : "down"; } catch { /* */ }
  return c.json({ ok: true, redis: r, adsStorage: await adStorageOk() });
});

app.get("/", async () => html(homePage()));
app.get("/live", async () => html(livePage(), 5));
app.get("/schedule", async () => html(schedulePage(), 30));
app.get("/lino", async () => html(linoPage(), 15));
app.get("/alerts", () => html(alertsPage(), 300));
app.get("/about", () => html(aboutPage(), 300));

app.get("/match/:key/:slug?", async (c) => {
  const m = await getMatch(decodeURIComponent(c.req.param("key")));
  if (!m) return new Response(notFoundPage(), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  const want = matchPath(m);
  if (decodeURIComponent(c.req.path) !== decodeURIComponent(want)) return c.redirect(want, 301);
  return html(matchPage(m), m.status === "live" ? 3 : 30);
});

app.get("/series/:slug", async (c) => {
  const s = (await allSeries()).find((x) => x.slug === c.req.param("slug"));
  if (!s) return new Response(notFoundPage(), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  return html(seriesPage(s), 30);
});

app.get("/preview/:slug", async (c) => {
  const p = PREVIEWS.find((x) => x.slug === c.req.param("slug"));
  if (!p) return new Response(notFoundPage(), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  return html(previewPage(p), 120);
});

/* Auto-refresh fragments (same markup the page renders server-side). */
app.get("/fragment/home-live", async () => frag(homeLive((await listMatches()).filter((m) => m.status === "live"))));
app.get("/fragment/live-list", async () => frag(liveList((await listMatches()).filter((m) => m.status === "live"))));
app.get("/fragment/lino", async () => frag(await linoBlocks()));
app.get("/fragment/match/:key", async (c) => {
  const m = await getMatch(decodeURIComponent(c.req.param("key")));
  if (!m) return c.text("", 404);
  return frag(matchLive(m, await linoTake(m)));
});

/* Ads manager: impression beacons, tracked click-through, media from the private bucket. */
const clientIp = (c: { req: { header: (k: string) => string | undefined } }) => (c.req.header("x-forwarded-for") || "").split(",")[0].trim() || c.req.header("x-real-ip") || "0";
app.post("/ad/ev", async (c) => {
  let b: { id?: unknown; pl?: unknown; pg?: unknown } = {};
  try { b = JSON.parse(await c.req.text()); } catch { /* */ }
  if (typeof b.id === "string" && typeof b.pl === "string" && typeof b.pg === "string") {
    await trackSiteAd({ id: b.id.slice(0, 40), type: "impression", placement: b.pl, page: b.pg, viewer: viewerId(clientIp(c), c.req.header("user-agent") || "") });
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
});
app.get("/ad/go/:id", async (c) => {
  const ad = await trackSiteAd({ id: c.req.param("id").slice(0, 40), type: "click", placement: c.req.query("pl") || "", page: c.req.query("pg") || "", viewer: viewerId(clientIp(c), c.req.header("user-agent") || "") });
  const to = ad?.targetUrl && /^https?:\/\//i.test(ad.targetUrl) ? ad.targetUrl : "/";
  return new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
});
app.get("/ads-media/:file", async (c) => {
  const m = await adMedia(c.req.param("file"));
  if (!m) return c.text("not found", 404);
  const size = m.body.length;
  const base = { "content-type": m.type, "cache-control": "public, max-age=86400, immutable", "accept-ranges": "bytes" };
  const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header("range") || "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(new Uint8Array(m.body.subarray(start, end + 1)), { status: 206, headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(new Uint8Array(m.body), { headers: { ...base, "content-length": String(size) } });
});

/* SEO */
app.get("/robots.txt", () => new Response(
  env.allowIndexing ? `User-agent: *\nAllow: /\nDisallow: /fragment/\n\nSitemap: ${abs("/sitemap.xml")}\n` : "User-agent: *\nDisallow: /\n",
  { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } },
));

app.get("/sitemap.xml", async () => {
  const now = new Date().toISOString();
  const urls: [string, string, string][] = [["/", "always", "1.0"], ["/live", "always", "0.9"], ["/schedule", "hourly", "0.9"], ["/lino", "hourly", "0.7"], ["/alerts", "weekly", "0.6"], ["/about", "monthly", "0.3"]];
  for (const s of await allSeries()) urls.push([`/series/${s.slug}`, "daily", "0.8"]);
  for (const p of PREVIEWS) urls.push([`/preview/${p.slug}`, "daily", "0.7"]);
  for (const m of await listMatches()) urls.push([matchPath(m), m.status === "live" ? "always" : "hourly", m.status === "live" ? "0.9" : "0.6"]);
  const base = env.siteUrl || "";
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, f, p]) => `  <url><loc>${base}${u.replace(/&/g, "&amp;")}</loc><lastmod>${now}</lastmod><changefreq>${f}</changefreq><priority>${p}</priority></url>`).join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } });
});

app.get("/manifest.webmanifest", () => new Response(JSON.stringify({
  name: "LiveLinePro", short_name: "LiveLinePro", start_url: "/", display: "standalone", background_color: "#070b14", theme_color: "#070b14",
  icons: [{ src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" }, { src: "/brand/icon.svg", sizes: "any", type: "image/svg+xml" }],
}), { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=86400" } }));

/* OG images */
const png = (buf: Buffer, maxAge: number) => new Response(new Uint8Array(buf), { headers: { "content-type": "image/png", "cache-control": `public, max-age=${maxAge}` } });
app.get("/og/default.png", async () => png(await renderPng("default", defaultOgSvg, 24 * 3600_000), 86400));
app.get("/og/match/:file", async (c) => {
  const key = decodeURIComponent(c.req.param("file").replace(/\.png$/, ""));
  const m = await getMatch(key);
  if (!m) return png(await renderPng("default", defaultOgSvg, 24 * 3600_000), 3600);
  return png(await renderPng(`m:${key}`, () => matchOgSvg(m), m.status === "live" ? 60_000 : 3600_000), m.status === "live" ? 60 : 3600);
});
app.get("/og/preview/:file", async (c) => {
  const p = PREVIEWS.find((x) => x.slug === c.req.param("file").replace(/\.png$/, ""));
  return png(p ? await renderPng(`p:${p.slug}`, () => previewOgSvg(p), 24 * 3600_000) : await renderPng("default", defaultOgSvg, 24 * 3600_000), 86400);
});

/* static assets */
app.get("*", async (c) => {
  const rel = decodeURIComponent(c.req.path).replace(/^\/+/, "");
  const file = path.resolve(PUBLIC, rel);
  const ext = path.extname(file);
  if (rel && file.startsWith(PUBLIC + path.sep) && TYPES[ext] && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const immutable = /\/(fonts|brand)\//.test(file) || c.req.query("v");
    return new Response(fs.readFileSync(file), { headers: { "content-type": TYPES[ext], "cache-control": immutable ? "public, max-age=604800" : "public, max-age=300" } });
  }
  return new Response(notFoundPage(), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
});

app.onError((err, c) => {
  console.error(JSON.stringify({ level: "error", msg: "request", path: c.req.path, err: String(err) }));
  return new Response(notFoundPage().replace("That page is out", "Rain delay — something went wrong"), { status: 500, headers: { "content-type": "text/html; charset=utf-8" } });
});

serve({ fetch: app.fetch, port: env.port, hostname: "::" }, (info) => {
  console.log(JSON.stringify({ level: "info", msg: "site up", port: info.port, siteUrl: env.siteUrl || "(unset)", indexing: env.allowIndexing, gate: gate.enabled, gateReady: gateReady(), sms: smsEnabled() }));
});
