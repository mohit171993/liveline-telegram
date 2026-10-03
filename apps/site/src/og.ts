import fs from "fs";
import path from "path";
import type { SiteMatch } from "./data";
import type { Preview } from "./content";

const FONTS = path.resolve(__dirname, "../assets/fonts");
const W = 1200, H = 630;
const C = { navy: "#070b14", lime: "#e7ff4d", cyan: "#3dffe8", orange: "#ff7a18", ink: "#f4f7fb", muted: "#8e99b0" };
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c] || c));

let mascot = "";
function mascotUri(): string {
  if (!mascot) {
    try { mascot = `data:image/svg+xml;base64,${fs.readFileSync(path.resolve(__dirname, "../public/brand/mascot.svg")).toString("base64")}`; } catch { mascot = ""; }
  }
  return mascot;
}

function frame(body: string, tag: string, accent = C.lime): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0c1430"/><stop offset="0.55" stop-color="${C.navy}"/><stop offset="1" stop-color="#05070d"/></linearGradient>
<radialGradient id="g1" cx="0.1" cy="0.1" r="0.6"><stop offset="0" stop-color="${accent}" stop-opacity="0.25"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
<radialGradient id="g2" cx="0.95" cy="0.95" r="0.55"><stop offset="0" stop-color="${C.cyan}" stop-opacity="0.18"/><stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#g1)"/><rect width="${W}" height="${H}" fill="url(#g2)"/>
<text x="56" y="84" font-family="Barlow Condensed" font-style="italic" font-weight="900" font-size="44" fill="${C.ink}">LIVELINE <tspan fill="${C.lime}">PRO</tspan></text>
<rect x="${W - 56 - (34 + tag.length * 16)}" y="46" width="${34 + tag.length * 16}" height="50" rx="25" fill="${accent}" fill-opacity="0.14" stroke="${accent}" stroke-width="2"/>
<text x="${W - 56 - (34 + tag.length * 16) / 2}" y="80" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="28" fill="${accent}">${esc(tag)}</text>
${body}
<image x="${W - 190}" y="${H - 200}" width="150" height="150" href="${mascotUri()}"/>
<text x="56" y="${H - 44}" font-family="Barlow" font-weight="600" font-size="24" fill="${C.muted}">Free on Telegram · 18+ · No betting</text>
</svg>`;
}

function chip(code: string, color: string, x: number, y: number): string {
  return `<rect x="${x}" y="${y}" width="150" height="104" rx="22" fill="${esc(color)}" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
<text x="${x + 75}" y="${y + 70}" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="52" fill="#ffffff">${esc(code)}</text>`;
}

export function defaultOgSvg(): string {
  return frame(`<text x="56" y="250" font-family="Barlow Condensed" font-style="italic" font-weight="900" font-size="96" fill="${C.ink}">CRICKET <tspan fill="${C.lime}">LIVE LINE</tspan></text>
<text x="56" y="330" font-family="Barlow Condensed" font-weight="800" font-size="54" fill="${C.cyan}">Ball-by-ball · Scorecards · Wicket alerts · Lino AI</text>
<text x="56" y="400" font-family="Barlow" font-weight="600" font-size="30" fill="${C.muted}">Fast, free and fan-first.</text>`, "FREE");
}

export function matchOgSvg(m: SiteMatch): string {
  const tag = m.status === "live" ? "LIVE" : m.status === "upcoming" ? "PREVIEW" : "RESULT";
  const acc = m.status === "live" ? "#ff5d7a" : m.status === "upcoming" ? C.cyan : C.lime;
  const sl = (s: "a" | "b") => (m.scoreline[s] && m.scoreline[s] !== "—" ? m.scoreline[s] : "");
  return frame(`${chip(m.teams.a.code, m.teams.a.color, 56, 150)}${chip(m.teams.b.code, m.teams.b.color, 56, 290)}
<text x="236" y="222" font-family="Barlow Condensed" font-weight="800" font-size="58" fill="${C.ink}">${esc(m.teams.a.name)}</text>
<text x="236" y="362" font-family="Barlow Condensed" font-weight="800" font-size="58" fill="${C.ink}">${esc(m.teams.b.name)}</text>
<text x="${W - 56}" y="222" text-anchor="end" font-family="Barlow Condensed" font-weight="800" font-size="58" fill="${C.lime}">${esc(sl("a"))}</text>
<text x="${W - 56}" y="362" text-anchor="end" font-family="Barlow Condensed" font-weight="800" font-size="58" fill="${C.lime}">${esc(sl("b"))}</text>
<text x="56" y="470" font-family="Barlow" font-weight="700" font-size="32" fill="${C.cyan}">${esc((m.result || m.live?.need || `${m.seriesName} · ${m.format}`).slice(0, 64))}</text>`, tag, acc);
}

export function previewOgSvg(p: Preview): string {
  return frame(`${chip(p.a.code, p.a.color, 56, 150)}<text x="236" y="225" font-family="Barlow Condensed" font-style="italic" font-weight="900" font-size="72" fill="${C.orange}">VS</text>${chip(p.b.code, p.b.color, 336, 150)}
<text x="56" y="350" font-family="Barlow Condensed" font-weight="800" font-size="60" fill="${C.ink}">${esc(`${p.a.name} vs ${p.b.name}`)}</text>
<text x="56" y="410" font-family="Barlow Condensed" font-weight="800" font-size="40" fill="${C.cyan}">${esc(p.stage)} · ${esc(p.when.split(" (")[0])}</text>
<text x="56" y="460" font-family="Barlow" font-weight="600" font-size="28" fill="${C.muted}">${esc(p.venue)}</text>`, "PREVIEW", C.orange);
}

type ResvgCtor = new (svg: string, opts: Record<string, unknown>) => { render: () => { asPng: () => Uint8Array } };
let Resvg: ResvgCtor | null = null;
const pngCache = new Map<string, { at: number; png: Buffer }>();

export async function renderPng(cacheKey: string, svg: () => string, ttlMs: number): Promise<Buffer> {
  const hit = pngCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ttlMs) return hit.png;
  if (!Resvg) Resvg = ((await import("@resvg/resvg-js")) as unknown as { Resvg: ResvgCtor }).Resvg;
  const fontFiles = fs.existsSync(FONTS) ? fs.readdirSync(FONTS).filter((f) => f.endsWith(".ttf")).map((f) => path.join(FONTS, f)) : [];
  const png = Buffer.from(new Resvg(svg(), { fitTo: { mode: "width", value: W }, font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Barlow" } }).render().asPng());
  if (pngCache.size > 300) pngCache.clear();
  pngCache.set(cacheKey, { at: Date.now(), png });
  return png;
}
