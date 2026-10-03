import fs from "fs";
import path from "path";
import type { MatchView, Team } from "@liveline/shared";
import { FLAG_ART } from "./flagArt";

/**
 * Premium branded channel cards (1280x720, neon on dark), rendered server-side
 * with resvg and bundled Barlow fonts so production output is identical to local.
 * Points-only product: cards never show odds, stakes or betting language.
 */

const W = 1280;
const H = 720;
const ASSETS = path.resolve(__dirname, "../assets");
const FONTS = path.join(ASSETS, "fonts");
export const C = { navy: "#070b14", lime: "#e7ff4d", cyan: "#3dffe8", orange: "#ff7a18", pink: "#ff5d7a", ink: "#f4f7fb", muted: "#8e99b0" };

let markUri = "";
function mark(): string {
  if (!markUri) {
    try { markUri = `data:image/png;base64,${fs.readFileSync(path.join(ASSETS, "mark-160.png")).toString("base64")}`; } catch { markUri = ""; }
  }
  return markUri;
}

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch] || ch));
}

function cut(value: string | undefined | null, max: number): string {
  const s = String(value || "").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

const FLAG_ALIAS: Record<string, string> = {
  rsa: "SA", southafrica: "SA", newzealand: "NZ", srilanka: "SL", westindies: "WI", india: "IND", australia: "AUS",
  england: "ENG", pakistan: "PAK", bangladesh: "BAN", afghanistan: "AFG", ireland: "IRE", zimbabwe: "ZIM",
  netherlands: "NED", scotland: "SCO", nepal: "NEP", oman: "OMA", unitedstates: "USA", usa: "USA", uae: "UAE",
};

function flagId(team: Team): string | null {
  const code = String(team.code || "").toUpperCase();
  if (FLAG_ART[code]) return code;
  const raw = `${team.name || ""}`.toLowerCase().replace(/[^a-z]/g, "");
  const alias = FLAG_ALIAS[raw] || FLAG_ALIAS[String(team.code || "").toLowerCase()];
  return alias && FLAG_ART[alias] ? alias : null;
}

let clipSeq = 0;
/** Team badge: real flag art for national sides, a colour crest with the team code otherwise. */
export function badge(team: Team, x: number, y: number, w: number): string {
  const h = Math.round(w * 0.7);
  const id = flagId(team);
  const clip = `c${++clipSeq}`;
  const glow = `<rect x="${x - 6}" y="${y - 6}" width="${w + 12}" height="${h + 12}" rx="${w * 0.16}" fill="${team.color || C.cyan}" opacity="0.18"/>`;
  if (id) {
    const s = w / 60;
    return `${glow}<g transform="translate(${x} ${y}) scale(${s})"><defs><clipPath id="${clip}"><rect width="60" height="42" rx="7"/></clipPath></defs>`
      + `<g clip-path="url(#${clip})">${FLAG_ART[id]}</g><rect width="60" height="42" rx="7" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.2"/></g>`;
  }
  const c1 = team.color || "#1d2a48";
  const c2 = team.color2 || "#0d1424";
  return `${glow}<defs><linearGradient id="${clip}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${esc(c1)}"/><stop offset="1" stop-color="${esc(c2)}"/></linearGradient></defs>`
    + `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * 0.12}" fill="url(#${clip})" stroke="rgba(255,255,255,0.35)" stroke-width="2"/>`
    + `<text x="${x + w / 2}" y="${y + h / 2 + w * 0.11}" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="${Math.round(w * 0.32)}" fill="#ffffff">${esc(cut(team.code, 4))}</text>`;
}

export function frame(body: string, opts: { accent?: string; tag: string; tagColor?: string; sub?: string }): string {
  const accent = opts.accent || C.lime;
  const tagColor = opts.tagColor || accent;
  const tagW = 34 + opts.tag.length * 17;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0c1430"/><stop offset="0.55" stop-color="${C.navy}"/><stop offset="1" stop-color="#05070d"/></linearGradient>
  <radialGradient id="glowA" cx="0.12" cy="0.1" r="0.6"><stop offset="0" stop-color="${accent}" stop-opacity="0.22"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
  <radialGradient id="glowB" cx="0.95" cy="0.95" r="0.55"><stop offset="0" stop-color="${C.cyan}" stop-opacity="0.16"/><stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/></radialGradient>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.035" stroke-width="1"/></pattern>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#grid)"/>
<rect width="${W}" height="${H}" fill="url(#glowA)"/>
<rect width="${W}" height="${H}" fill="url(#glowB)"/>
<rect x="0" y="0" width="${W}" height="6" fill="${accent}"/>
<rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="28" fill="none" stroke="${accent}" stroke-opacity="0.28" stroke-width="2"/>
<rect x="56" y="54" width="${tagW}" height="44" rx="22" fill="${tagColor}" fill-opacity="0.14" stroke="${tagColor}" stroke-width="2"/>
<circle cx="78" cy="76" r="7" fill="${tagColor}"/>
<text x="94" y="86" font-family="Barlow Condensed" font-weight="800" font-size="28" letter-spacing="2" fill="${tagColor}">${esc(opts.tag)}</text>
${opts.sub ? `<text x="${56 + tagW + 20}" y="86" font-family="Barlow" font-weight="600" font-size="24" fill="${C.muted}">${esc(cut(opts.sub, 64))}</text>` : ""}
${mark() ? `<image x="${W - 128}" y="44" width="72" height="72" href="${mark()}" xlink:href="${mark()}"/>` : ""}
${body}
<rect x="18" y="${H - 86}" width="${W - 36}" height="1" fill="#ffffff" fill-opacity="0.08"/>
<text x="56" y="${H - 44}" font-family="Barlow Condensed" font-style="italic" font-weight="900" font-size="34" letter-spacing="1" fill="${C.ink}">LIVELINE <tspan fill="${C.lime}">PRO</tspan></text>
<text x="262" y="${H - 46}" font-family="Barlow" font-weight="600" font-size="20" fill="${C.muted}">Free to play · Points only · No betting · 18+</text>
<text x="${W - 56}" y="${H - 46}" text-anchor="end" font-family="Barlow" font-weight="700" font-size="22" fill="${C.cyan}">t.me/LiveLineProBot</text>
</svg>`;
}

const IST = "Asia/Kolkata";
export function istTime(ms: number): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true }).format(ms).toUpperCase();
}
export function istDate(ms: number): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short" }).format(ms);
}

function teamsRow(view: MatchView, y: number, opts: { scores?: boolean; highlight?: "a" | "b" | null } = {}): string {
  const a = view.teams.a;
  const b = view.teams.b;
  const bw = 150;
  const parts: string[] = [];
  parts.push(badge(a, 96, y, bw));
  parts.push(badge(b, W - 96 - bw, y, bw));
  const nameY = y + bw * 0.7 + 52;
  parts.push(`<text x="${96 + bw / 2}" y="${nameY}" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="40" fill="${opts.highlight === "a" ? C.lime : C.ink}">${esc(cut(a.name, 18).toUpperCase())}</text>`);
  parts.push(`<text x="${W - 96 - bw / 2}" y="${nameY}" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="40" fill="${opts.highlight === "b" ? C.lime : C.ink}">${esc(cut(b.name, 18).toUpperCase())}</text>`);
  if (opts.scores) {
    parts.push(`<text x="${96 + bw / 2}" y="${nameY + 44}" text-anchor="middle" font-family="Barlow" font-weight="700" font-size="30" fill="${C.muted}">${esc(cut(view.scoreline.a || "Yet to bat", 22))}</text>`);
    parts.push(`<text x="${W - 96 - bw / 2}" y="${nameY + 44}" text-anchor="middle" font-family="Barlow" font-weight="700" font-size="30" fill="${C.muted}">${esc(cut(view.scoreline.b || "Yet to bat", 22))}</text>`);
  }
  return parts.join("\n");
}

function subline(view: MatchView): string {
  return [view.seriesName, view.format].filter(Boolean).join(" · ");
}

export function startingSoonSvg(view: MatchView, now = Date.now()): string {
  const mins = Math.max(0, Math.round((view.startAt - now) / 60_000));
  const when = view.status === "live" ? "LIVE NOW" : mins <= 1 ? "STARTING NOW" : mins < 120 ? `STARTS IN ${mins} MIN` : `${istTime(view.startAt)} IST`;
  const body: string[] = [teamsRow(view, 150)];
  body.push(`<text x="${W / 2}" y="230" text-anchor="middle" font-family="Barlow Condensed" font-style="italic" font-weight="900" font-size="92" fill="${C.lime}">VS</text>`);
  body.push(`<text x="${W / 2}" y="290" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="34" letter-spacing="2" fill="${C.cyan}">${esc(when)}</text>`);
  body.push(`<text x="${W / 2}" y="328" text-anchor="middle" font-family="Barlow" font-weight="600" font-size="22" fill="${C.muted}">${esc(cut([view.venue, view.city].filter(Boolean).join(", "), 48))}</text>`);
  const toss = cut(view.toss && !/^toss/i.test(view.toss) ? `Toss: ${view.toss}` : view.toss || "Toss & Playing XIs coming up", 90);
  body.push(`<rect x="96" y="420" width="${W - 192}" height="54" rx="16" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.08"/>`);
  body.push(`<text x="${W / 2}" y="456" text-anchor="middle" font-family="Barlow" font-weight="700" font-size="26" fill="${C.ink}">${esc(toss)}</text>`);
  const xa = (view.xi?.a || []).slice(0, 11).map((p) => p.name);
  const xb = (view.xi?.b || []).slice(0, 11).map((p) => p.name);
  if (xa.length && xb.length) {
    const lineA = cut(xa.map(short).join(", "), 98);
    const lineB = cut(xb.map(short).join(", "), 98);
    body.push(`<text x="96" y="520" font-family="Barlow Condensed" font-weight="800" font-size="24" fill="${C.lime}">${esc(view.teams.a.code)} XI</text><text x="170" y="520" font-family="Barlow" font-weight="600" font-size="21" fill="${C.ink}">${esc(lineA)}</text>`);
    body.push(`<text x="96" y="562" font-family="Barlow Condensed" font-weight="800" font-size="24" fill="${C.lime}">${esc(view.teams.b.code)} XI</text><text x="170" y="562" font-family="Barlow" font-weight="600" font-size="21" fill="${C.ink}">${esc(lineB)}</text>`);
  } else {
    body.push(`<text x="${W / 2}" y="540" text-anchor="middle" font-family="Barlow" font-weight="600" font-size="26" fill="${C.muted}">Free predictions open in the app · Ball-by-ball live line</text>`);
  }
  return frame(body.join("\n"), { tag: "MATCH DAY", tagColor: C.cyan, accent: C.cyan, sub: subline(view) });
}

function short(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]} ${parts.slice(1).join(" ")}`;
}

export type MomentKind = "wicket" | "fifty" | "hundred";

export function momentSvg(view: MatchView, kind: MomentKind, headline: string, detail: string): string {
  const live = view.live;
  const color = kind === "wicket" ? C.pink : kind === "hundred" ? C.orange : C.lime;
  const big = kind === "wicket" ? "WICKET!" : kind === "hundred" ? "HUNDRED!" : "FIFTY!";
  const bat = live ? view.teams[live.batting] : view.teams.a;
  const score = live ? `${live.runs}/${live.wickets}` : "";
  const body: string[] = [];
  body.push(`<text x="96" y="250" font-family="Barlow Condensed" font-style="italic" font-weight="900" font-size="150" fill="${color}">${big}</text>`);
  body.push(`<text x="100" y="320" font-family="Barlow Condensed" font-weight="800" font-size="52" fill="${C.ink}">${esc(cut(headline, 34))}</text>`);
  body.push(`<text x="100" y="368" font-family="Barlow" font-weight="600" font-size="28" fill="${C.muted}">${esc(cut(detail, 64))}</text>`);
  body.push(badge(bat, 100, 420, 120));
  body.push(`<text x="250" y="482" font-family="Barlow Condensed" font-weight="900" font-size="88" fill="${C.ink}">${esc(bat.code)} ${esc(score)}</text>`);
  if (live) body.push(`<text x="252" y="526" font-family="Barlow" font-weight="700" font-size="28" fill="${C.cyan}">${esc(live.overs)} ov · ${esc(cut(live.need || `CRR ${live.crr}`, 46))}</text>`);
  const other = live ? view.teams[live.batting === "a" ? "b" : "a"] : view.teams.b;
  body.push(`<g opacity="0.9">${badge(other, W - 96 - 110, 420, 110)}</g>`);
  body.push(`<text x="${W - 96 - 55}" y="${420 + 77 + 40}" text-anchor="middle" font-family="Barlow" font-weight="600" font-size="22" fill="${C.muted}">vs ${esc(other.code)}</text>`);
  return frame(body.join("\n"), { tag: "LIVE", tagColor: C.pink, accent: color, sub: `${view.teams.a.code} vs ${view.teams.b.code} · ${subline(view)}` });
}

export function inningsBreakSvg(view: MatchView): string {
  const body: string[] = [teamsRow(view, 140, { scores: true })];
  body.push(`<text x="${W / 2}" y="220" text-anchor="middle" font-family="Barlow Condensed" font-style="italic" font-weight="900" font-size="84" fill="${C.lime}">INNINGS</text>`);
  body.push(`<text x="${W / 2}" y="290" text-anchor="middle" font-family="Barlow Condensed" font-style="italic" font-weight="900" font-size="84" fill="${C.ink}">BREAK</text>`);
  const first = view.innings?.[0];
  const target = first ? first.runs + 1 : null;
  const chaser = first ? view.teams[first.team === "a" ? "b" : "a"] : null;
  const line = view.live?.need || (target && chaser ? `${chaser.name} need ${target} to win` : "Second innings coming up");
  body.push(`<rect x="200" y="470" width="${W - 400}" height="70" rx="20" fill="${C.lime}" fill-opacity="0.12" stroke="${C.lime}" stroke-opacity="0.6" stroke-width="2"/>`);
  body.push(`<text x="${W / 2}" y="516" text-anchor="middle" font-family="Barlow" font-weight="700" font-size="32" fill="${C.lime}">${esc(cut(line, 52))}</text>`);
  body.push(`<text x="${W / 2}" y="580" text-anchor="middle" font-family="Barlow" font-weight="600" font-size="24" fill="${C.muted}">Lock your free predictions for the chase in the app</text>`);
  return frame(body.join("\n"), { tag: "INNINGS BREAK", tagColor: C.lime, sub: subline(view) });
}

export function resultSvg(view: MatchView, winner?: "a" | "b" | null): string {
  const body: string[] = [teamsRow(view, 140, { scores: true, highlight: winner || null })];
  body.push(`<text x="${W / 2}" y="250" text-anchor="middle" font-family="Barlow Condensed" font-style="italic" font-weight="900" font-size="110" fill="${C.lime}">RESULT</text>`);
  if (winner) body.push(`<text x="${W / 2}" y="300" text-anchor="middle" font-size="40" font-family="Barlow Condensed" font-weight="800" fill="${C.cyan}">${esc(view.teams[winner].name.toUpperCase())} WIN</text>`);
  body.push(`<rect x="160" y="470" width="${W - 320}" height="76" rx="22" fill="${C.lime}" fill-opacity="0.14" stroke="${C.lime}" stroke-opacity="0.7" stroke-width="2"/>`);
  body.push(`<text x="${W / 2}" y="520" text-anchor="middle" font-family="Barlow" font-weight="800" font-size="34" fill="${C.lime}">${esc(cut(view.result || "Match complete", 56))}</text>`);
  body.push(`<text x="${W / 2}" y="590" text-anchor="middle" font-family="Barlow" font-weight="600" font-size="24" fill="${C.muted}">Check your prediction points &amp; leaderboard rank in the app</text>`);
  return frame(body.join("\n"), { tag: "FULL TIME", tagColor: C.lime, sub: subline(view) });
}

export function todaySvg(views: MatchView[], now = Date.now()): string {
  const rows = views.slice(0, 5);
  const body: string[] = [];
  body.push(`<text x="56" y="180" font-family="Barlow Condensed" font-style="italic" font-weight="900" font-size="76" fill="${C.ink}">TODAY'S <tspan fill="${C.lime}">MATCHES</tspan></text>`);
  rows.forEach((v, i) => {
    const y = 214 + i * 78;
    body.push(`<rect x="56" y="${y}" width="${W - 112}" height="66" rx="18" fill="#ffffff" fill-opacity="0.045" stroke="#ffffff" stroke-opacity="0.08"/>`);
    body.push(badge(v.teams.a, 76, y + 13, 56));
    body.push(badge(v.teams.b, 146, y + 13, 56));
    body.push(`<text x="226" y="${y + 33}" font-family="Barlow Condensed" font-weight="800" font-size="30" fill="${C.ink}">${esc(cut(`${v.teams.a.name} vs ${v.teams.b.name}`, 40))}</text>`);
    body.push(`<text x="226" y="${y + 57}" font-family="Barlow" font-weight="600" font-size="19" fill="${C.muted}">${esc(cut(subline(v), 70))}</text>`);
    const live = v.status === "live";
    const label = live ? "LIVE" : v.status === "completed" ? "DONE" : `${istTime(v.startAt)} IST`;
    const col = live ? C.pink : v.status === "completed" ? C.muted : C.cyan;
    if (live) body.push(`<circle cx="${W - 158}" cy="${y + 33}" r="8" fill="${C.pink}"/>`);
    body.push(`<text x="${W - 80}" y="${y + 43}" text-anchor="end" font-family="Barlow Condensed" font-weight="800" font-size="30" fill="${col}">${esc(label)}</text>`);
  });
  if (views.length > rows.length) {
    body.push(`<text x="${W / 2}" y="${214 + rows.length * 78 + 24}" text-anchor="middle" font-family="Barlow" font-weight="600" font-size="20" fill="${C.muted}">+${views.length - rows.length} more in the app</text>`);
  }
  return frame(body.join("\n"), { tag: istDate(now).toUpperCase(), tagColor: C.lime, sub: "Free predictions · Live line ball by ball" });
}

type ResvgCtor = new (svg: string, opts: Record<string, unknown>) => { render: () => { asPng: () => Uint8Array } };
let resvg: ResvgCtor | null = null;
let fontFiles: string[] | null = null;

export async function renderCard(svg: string): Promise<Buffer> {
  if (!resvg) {
    const specifier = "@resvg/resvg-js";
    resvg = ((await import(specifier)) as { Resvg: ResvgCtor }).Resvg;
  }
  if (!fontFiles) {
    fontFiles = fs.existsSync(FONTS) ? fs.readdirSync(FONTS).filter((f) => f.endsWith(".ttf")).map((f) => path.join(FONTS, f)) : [];
  }
  const out = new resvg(svg, {
    fitTo: { mode: "width", value: W },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Barlow" },
  });
  return Buffer.from(out.render().asPng());
}
