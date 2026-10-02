import { abs, appLink, channelLink, env } from "./env";
import { matchPath, type SiteMatch } from "./data";

export const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));

const IST = "Asia/Kolkata";
export function istTime(ms: number): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true }).format(ms).replace(/\s?(am|pm)/i, (s) => s.toUpperCase());
}
export function istDate(ms: number): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short" }).format(ms);
}
export function istDayKey(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}
export function when(ms: number): string {
  const today = istDayKey(Date.now()), d = istDayKey(ms), tmr = istDayKey(Date.now() + 86_400_000);
  const day = d === today ? "Today" : d === tmr ? "Tomorrow" : istDate(ms);
  return `${day} · ${istTime(ms)} IST`;
}

export interface PageMeta {
  title: string; description: string; path: string; ogImage?: string; jsonLd?: unknown[]; noindex?: boolean; refresh?: string;
  active?: "home" | "live" | "schedule" | "lino" | "alerts"; tgParam?: string;
}

const NAV: [PageMeta["active"], string, string, string][] = [
  ["home", "/", "Home", "M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"],
  ["live", "/live", "Live", "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm-7.07-2.93l1.41 1.41A8 8 0 0 0 4 12a8 8 0 0 0 2.34 5.66l-1.41 1.41A10 10 0 0 1 2 12a10 10 0 0 1 2.93-6.93zm14.14 0A10 10 0 0 1 22 12a10 10 0 0 1-2.93 6.93l-1.41-1.41A8 8 0 0 0 20 12a8 8 0 0 0-2.34-5.66z"],
  ["schedule", "/schedule", "Schedule", "M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zm-2 8h14v10H5z"],
  ["lino", "/lino", "Lino AI", "M12 2a2 2 0 0 1 1 3.73V7h4a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3h4V5.73A2 2 0 0 1 12 2zM9 11.5A1.5 1.5 0 1 0 9 14.5 1.5 1.5 0 0 0 9 11.5zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"],
  ["alerts", "/alerts", "Alerts", "M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11a6 6 0 0 0-5-5.92V4a1 1 0 0 0-2 0v1.08A6 6 0 0 0 6 11v5l-2 2v1h16v-1z"],
];

export function layout(meta: PageMeta, body: string): string {
  const url = abs(meta.path);
  const og = abs(meta.ogImage || "/og/default.png");
  const noindex = meta.noindex || !env.allowIndexing;
  const title = meta.title.includes("LiveLinePro") ? meta.title : `${meta.title} | LiveLinePro`;
  const ld = [
    { "@context": "https://schema.org", "@type": "WebSite", name: "LiveLinePro", url: abs("/"), inLanguage: "en-IN" },
    ...(meta.jsonLd || []),
  ];
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(meta.description)}">
${noindex ? `<meta name="robots" content="noindex, nofollow">` : `<meta name="robots" content="index, follow, max-image-preview:large">`}
${env.siteUrl ? `<link rel="canonical" href="${esc(url)}">` : ""}
<meta name="theme-color" content="#070b14">
<meta property="og:type" content="website">
<meta property="og:site_name" content="LiveLinePro">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(meta.description)}">
${env.siteUrl ? `<meta property="og:url" content="${esc(url)}">` : ""}
<meta property="og:image" content="${esc(og)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(meta.description)}">
<meta name="twitter:image" content="${esc(og)}">
<link rel="icon" href="/brand/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/icon-512.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="preload" href="/fonts/BarlowCondensed-ExtraBold.ttf" as="font" type="font/ttf" crossorigin>
<link rel="stylesheet" href="/site.css?v=${ASSET_V}">
<script type="application/ld+json">${JSON.stringify(ld.length === 1 ? ld[0] : ld).replace(/</g, "\\u003c")}</script>
</head>
<body>
<header class="top">
  <a class="brand" href="/" aria-label="LiveLinePro home"><img src="/brand/icon.svg" width="32" height="32" alt=""><span><b>LIVELINE</b><i>Pro</i></span></a>
  <a class="tg-btn sm" href="${esc(appLink(meta.tgParam || meta.active || "home"))}" rel="noopener">${tgIcon()}Open app</a>
</header>
<main class="wrap"${meta.refresh ? ` data-refresh="${esc(meta.refresh)}"` : ""}>
${body}
</main>
${footer()}
<nav class="tabs" aria-label="Main">
${NAV.map(([k, href, label, d]) => `<a href="${href}"${meta.active === k ? ` aria-current="page"` : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg><span>${label}</span></a>`).join("")}
</nav>
<script src="/site.js?v=${ASSET_V}" defer></script>
</body>
</html>`;
}

export const ASSET_V = String(Math.floor(Date.now() / 1000));

export function tgIcon(): string {
  return `<svg class="tg" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.9 4.3l-3.2 15.1c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.2 13 1.4 11.5c-1-.3-1-1 .2-1.5l18.9-7.3c.9-.3 1.6.2 1.4 1.6z"/></svg>`;
}

function footer(): string {
  return `<footer class="foot">
  <div class="foot-brand"><img src="/brand/mascot.svg" width="44" height="44" alt=""><p><b>LiveLinePro</b> — free ball-by-ball cricket live line, scorecards, alerts and Lino AI on Telegram.</p></div>
  <div class="foot-links">
    <a href="/schedule">Schedule</a><a href="/live">Live scores</a><a href="/lino">Lino AI</a><a href="/alerts">Match alerts</a><a href="/about">About</a>
    <a href="${esc(appLink("footer"))}" rel="noopener">@${esc(env.botUsername)}</a><a href="${esc(channelLink())}" rel="noopener">@${esc(env.channelUsername)}</a>
  </div>
  <p class="legal"><span class="pill18">18+</span> For fans aged 18 and over. <b>No betting, no real money.</b> LiveLinePro has no odds, wagering or cash games — fan points have no money value and cannot be exchanged for cash.</p>
  <p class="legal muted">Scores via a licensed cricket data feed and may be delayed. Not affiliated with the ICC, BCCI or any team. Times shown in IST.</p>
  <p class="legal muted">© ${new Date().getFullYear()} LiveLinePro</p>
</footer>`;
}

/* ---------- components ---------- */

export function flag(team: { code: string; color?: string; color2?: string; flag?: string }, size = 34): string {
  const c1 = team.color || "#1d2a48", c2 = team.color2 || "#0d1424";
  return `<span class="flag" style="--c1:${esc(c1)};--c2:${esc(c2)};--s:${size}px" aria-hidden="true">${esc(team.code.slice(0, 3))}</span>`;
}

export function statusPill(m: SiteMatch): string {
  if (m.status === "live") return m.break ? `<span class="pill live">● ${m.break.kind === "innings" ? "Innings break" : "Timeout"}</span>` : `<span class="pill live">● LIVE</span>`;
  if (m.status === "upcoming") return `<span class="pill soon">${esc(when(m.startAt))}</span>`;
  return `<span class="pill done">Result</span>`;
}

export function matchCard(m: SiteMatch): string {
  const live = m.live;
  const line = (side: "a" | "b") => {
    const t = m.teams[side];
    const batting = live && live.batting === side;
    return `<div class="row${batting ? " bat" : ""}">${flag(t)}<span class="tn">${esc(t.name)}</span><span class="sc">${esc(m.scoreline[side] && m.scoreline[side] !== "—" ? m.scoreline[side] : m.status === "upcoming" ? "" : "Yet to bat")}</span></div>`;
  };
  const foot = m.status === "live" && live
    ? `<div class="mc-foot"><span>CRR ${live.crr.toFixed(2)}${live.rrr != null ? ` · RRR ${live.rrr.toFixed(2)}` : ""}</span><span class="balls">${live.thisOver.slice(-6).map(ball).join("")}</span></div>${live.need ? `<p class="need">${esc(live.need)}</p>` : ""}`
    : m.status === "completed" ? `<p class="need done">${esc(m.result || "Match complete")}</p>`
    : `<p class="need soon">${esc(m.venue)}${m.city ? `, ${esc(m.city)}` : ""}</p>`;
  return `<a class="card mc ${m.status}" href="${matchPath(m)}">
  <div class="mc-head"><span class="series">${esc(m.seriesName)} · ${esc(m.format)}</span>${statusPill(m)}</div>
  ${line("a")}${line("b")}
  ${foot}
</a>`;
}

export function ball(b: string): string {
  const cls = /W/.test(b) ? "w" : b === "6" ? "six" : b === "4" ? "four" : /wd|nb/.test(b) ? "x" : b === "·" || b === "0" ? "dot" : "r";
  return `<i class="b ${cls}">${esc(b === "·" ? "•" : b)}</i>`;
}

export function tgCta(title: string, sub: string, param: string, opts: { channel?: boolean; lino?: boolean } = {}): string {
  return `<section class="cta card">
  <img src="/brand/mascot.svg" width="64" height="64" alt="" class="cta-lino${opts.lino ? " bob" : ""}">
  <div><h3>${esc(title)}</h3><p>${esc(sub)}</p></div>
  <div class="cta-btns">
    <a class="tg-btn" href="${esc(appLink(param))}" rel="noopener">${tgIcon()}Open in Telegram</a>
    ${opts.channel === false ? "" : `<a class="ghost-btn" href="${esc(channelLink())}" rel="noopener">Join @${esc(env.channelUsername)}</a>`}
  </div>
</section>`;
}

export function sectionHead(title: string, href?: string, more = "See all"): string {
  return `<div class="sh"><h2>${esc(title)}</h2>${href ? `<a href="${href}">${esc(more)} →</a>` : ""}</div>`;
}

export function empty(text: string): string {
  return `<div class="card empty"><img src="/brand/mascot.svg" width="56" height="56" alt=""><p>${esc(text)}</p></div>`;
}
