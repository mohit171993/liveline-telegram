/**
 * One-off channel launch posts for @LiveLine_Pro (prize-free wording, points-only product).
 * Usage: tsx scripts/channelLaunchPosts.ts [outDir] [--send <chatId>]
 * Renders five branded 1280x720 cards; with --send posts them via the bot's sendPhotoCard path.
 */
import fs from "fs";
import path from "path";
import type { Team } from "@liveline/shared";
import { C, badge, esc, frame, renderCard } from "../src/channelCards";
import { sendPhotoCard } from "../src/telegram";

const W = 1280;
const APP = "https://t.me/LiveLineProBot?startapp=live_channel";
const markup = { inline_keyboard: [[{ text: "🏏 Open LiveLine Pro — free live score", url: APP }]] };
const T = (code: string, name: string, color: string): Team => ({ code, name, color } as Team);
const IND = T("IND", "India", "#1f6feb"), WI = T("WI", "West Indies", "#7a1f3d"), BAN = T("BAN", "Bangladesh", "#0a8f4a");
const SL = T("SL", "Sri Lanka", "#1d3a8a"), PAK = T("PAK", "Pakistan", "#0b6b33");

const txt = (x: number, y: number, s: string, size: number, fill: string, o: { w?: number; f?: string; a?: string; i?: boolean } = {}) =>
  `<text x="${x}" y="${y}" ${o.a ? `text-anchor="${o.a}"` : ""} font-family="${o.f || "Barlow"}" ${o.i ? `font-style="italic"` : ""} font-weight="${o.w || 700}" font-size="${size}" fill="${fill}">${esc(s)}</text>`;
const pill = (x: number, y: number, w: number, h: number, col: string, op = 0.1) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${col}" fill-opacity="${op}" stroke="${col}" stroke-opacity="0.45" stroke-width="2"/>`;

function welcome(): string {
  const b: string[] = [];
  b.push(txt(56, 200, "WELCOME TO", 64, C.ink, { f: "Barlow Condensed", w: 900, i: true }));
  b.push(`<text x="56" y="290" font-family="Barlow Condensed" font-style="italic" font-weight="900" font-size="104" fill="${C.ink}">LIVELINE <tspan fill="${C.lime}">PRO</tspan></text>`);
  b.push(txt(58, 336, "The free cricket companion — fast scores, zero noise.", 28, C.muted, { w: 600 }));
  const tiles: [string, string, string][] = [
    ["⚡", "Ball-by-ball live line", C.lime], ["🔔", "Match alerts: toss, wickets, results", C.cyan],
    ["🤖", "Lino AI — ask anything", C.orange], ["🏆", "Points leaderboard & badges", C.pink],
  ];
  tiles.forEach(([, label, col], i) => {
    const x = 56 + (i % 2) * 588, y = 380 + Math.floor(i / 2) * 104;
    b.push(pill(x, y, 572, 88, col));
    b.push(`<circle cx="${x + 44}" cy="${y + 44}" r="14" fill="${col}"/>`);
    b.push(txt(x + 76, y + 55, label, 32, C.ink, { f: "Barlow Condensed", w: 800 }));
  });
  return frame(b.join("\n"), { tag: "WELCOME", tagColor: C.lime, sub: "Official channel · @LiveLine_Pro" });
}

function lino(): string {
  const b: string[] = [];
  b.push(`<text x="56" y="210" font-family="Barlow Condensed" font-style="italic" font-weight="900" font-size="110" fill="${C.ink}">MEET <tspan fill="${C.orange}">LINO</tspan></text>`);
  b.push(txt(60, 262, "Your AI cricket buddy inside LiveLine Pro", 34, C.cyan, { w: 700 }));
  const qs = ["“What does India need off the last 5 overs?”", "“Who has the best economy in this match?”", "“Explain the Super Over rule in 2 lines.”", "“Kal ka match kitne baje hai?”"];
  qs.forEach((q, i) => {
    const y = 300 + i * 70;
    b.push(`<rect x="56" y="${y}" width="${740}" height="56" rx="28" fill="#ffffff" fill-opacity="0.06" stroke="${C.orange}" stroke-opacity="0.35" stroke-width="2"/>`);
    b.push(txt(84, y + 37, q, 26, C.ink, { w: 600 }));
  });
  // robot head
  const cx = 1010, cy = 400;
  b.push(`<circle cx="${cx}" cy="${cy}" r="170" fill="${C.orange}" fill-opacity="0.10"/>`);
  b.push(`<rect x="${cx - 115}" y="${cy - 95}" width="230" height="190" rx="56" fill="#141c33" stroke="${C.orange}" stroke-width="5"/>`);
  b.push(`<line x1="${cx}" y1="${cy - 95}" x2="${cx}" y2="${cy - 140}" stroke="${C.orange}" stroke-width="6"/><circle cx="${cx}" cy="${cy - 148}" r="13" fill="${C.lime}"/>`);
  b.push(`<circle cx="${cx - 48}" cy="${cy - 10}" r="24" fill="${C.cyan}"/><circle cx="${cx + 48}" cy="${cy - 10}" r="24" fill="${C.cyan}"/>`);
  b.push(`<path d="M${cx - 50} ${cy + 45} Q${cx} ${cy + 80} ${cx + 50} ${cy + 45}" fill="none" stroke="${C.lime}" stroke-width="8" stroke-linecap="round"/>`);
  b.push(txt(cx, cy + 150, "English · Hindi · Hinglish", 26, C.muted, { a: "middle", w: 600 }));
  return frame(b.join("\n"), { tag: "AI BUDDY", tagColor: C.orange, accent: C.orange, sub: "Free · inside the app" });
}

function indWi(): string {
  const b: string[] = [];
  b.push(badge(IND, 56, 130, 96));
  b.push(badge(WI, 172, 130, 96));
  b.push(`<text x="296" y="190" font-family="Barlow Condensed" font-style="italic" font-weight="900" font-size="66" fill="${C.ink}">INDIA vs WEST INDIES <tspan fill="${C.lime}">T20Is</tspan></text>`);
  const rows: [string, string, string][] = [
    ["1st T20I", "Tue 6 Oct", "Ekana Stadium, Lucknow"], ["2nd T20I", "Fri 9 Oct", "JSCA Stadium, Ranchi"],
    ["3rd T20I", "Sun 11 Oct", "Holkar Stadium, Indore"], ["4th T20I", "Wed 14 Oct", "Rajiv Gandhi Stadium, Hyderabad"],
    ["5th T20I", "Sat 17 Oct", "M. Chinnaswamy, Bengaluru"],
  ];
  rows.forEach(([m, d, v], i) => {
    const y = 236 + i * 72;
    b.push(`<rect x="56" y="${y}" width="${W - 112}" height="60" rx="16" fill="#ffffff" fill-opacity="0.045" stroke="#ffffff" stroke-opacity="0.08"/>`);
    b.push(txt(84, y + 40, m, 30, C.lime, { f: "Barlow Condensed", w: 800 }));
    b.push(txt(240, y + 40, d, 30, C.ink, { f: "Barlow Condensed", w: 800 }));
    b.push(txt(420, y + 39, v, 26, C.muted, { w: 600 }));
    b.push(txt(W - 84, y + 40, "7:00 PM IST", 30, C.cyan, { f: "Barlow Condensed", w: 800, a: "end" }));
  });
  return frame(b.join("\n"), { tag: "SERIES SCHEDULE", tagColor: C.cyan, accent: C.cyan, sub: "West Indies tour of India 2026" });
}

function preview(a: Team, bt: Team, tag: string, title: string, when: string, venue: string, notes: string[], col: string): string {
  const b: string[] = [];
  b.push(badge(a, 96, 140, 150));
  b.push(badge(bt, W - 246, 140, 150));
  b.push(txt(171, 300, a.name.toUpperCase(), 38, C.ink, { a: "middle", f: "Barlow Condensed", w: 800 }));
  b.push(txt(W - 171, 300, bt.name.toUpperCase(), 38, C.ink, { a: "middle", f: "Barlow Condensed", w: 800 }));
  b.push(txt(W / 2, 205, "VS", 92, col, { a: "middle", f: "Barlow Condensed", w: 900, i: true }));
  b.push(txt(W / 2, 256, title, 34, C.ink, { a: "middle", f: "Barlow Condensed", w: 800 }));
  b.push(txt(W / 2, 296, when, 30, C.cyan, { a: "middle", f: "Barlow Condensed", w: 800 }));
  b.push(txt(W / 2, 332, venue, 22, C.muted, { a: "middle", w: 600 }));
  notes.forEach((n, i) => {
    const y = 372 + i * 66;
    b.push(`<rect x="96" y="${y}" width="${W - 192}" height="54" rx="16" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.08"/>`);
    b.push(`<circle cx="124" cy="${y + 27}" r="7" fill="${col}"/>`);
    b.push(txt(146, y + 36, n, 25, C.ink, { w: 600 }));
  });
  return frame(b.join("\n"), { tag, tagColor: col, accent: col, sub: "Asian Games 2026 · Men's T20 cricket" });
}

const posts = [
  { key: "01-welcome", svg: welcome(), caption:
`<b>👋 Welcome to LiveLine Pro</b>

The free cricket companion for fans who want it fast:
<blockquote>⚡ Ball-by-ball live line &amp; scorecards
🔔 Match alerts — toss, wickets, fifties, results
🤖 Lino AI — ask anything about the match
🏆 Prediction points, badges &amp; a fan leaderboard</blockquote>
Free to use · Points only · No betting.
👇 Open the app and follow today's matches live.` },
  { key: "02-meet-lino", svg: lino(), caption:
`<b>🤖 Meet Lino — your AI cricket buddy</b>

Lino lives inside LiveLine Pro and answers in English, हिंदी or Hinglish:
<blockquote>• Live situation: required rate, partnerships, what's needed
• Player &amp; match stats in plain words
• Rules explained simply (Super Over, DLS, powerplay)</blockquote>
Just open the app and tap <b>Ask Lino</b>. Free.` },
  { key: "03-ind-vs-wi-t20i-schedule", svg: indWi(), caption:
`<b>🗓 India vs West Indies — T20I series schedule</b>

<blockquote>1st T20I · Tue 6 Oct · Lucknow (Ekana)
2nd T20I · Fri 9 Oct · Ranchi (JSCA)
3rd T20I · Sun 11 Oct · Indore (Holkar)
4th T20I · Wed 14 Oct · Hyderabad (Rajiv Gandhi Intl.)
5th T20I · Sat 17 Oct · Bengaluru (M. Chinnaswamy)</blockquote>
⏰ All matches 7:00 PM IST (toss 6:30 PM). Shreyas Iyer leads India's T20I side.
Source: BCCI home-season fixtures. Follow every ball live in the app 👇` },
  { key: "04-ban-vs-sl-preview", svg: preview(BAN, SL, "MATCH PREVIEW", "Bronze-medal match", "SAT 3 OCT · 5:30 AM IST (9:00 AM local)", "Korogi Sports Park, Nisshin, Japan",
      ["Bangladesh field most of their first-choice XI", "Sri Lanka bring a younger, second-string squad", "Cracked, spin-friendly pitch · sunny forecast"], C.lime), caption:
`<b>🥉 Bangladesh vs Sri Lanka — Asian Games bronze-medal match</b>

📅 Sat 3 Oct · ⏰ 5:30 AM IST (9:00 AM local)
📍 Korogi Sports Park, Nisshin, Japan
<blockquote>Both sides lost their semi-finals and now play for a podium finish. Bangladesh call on most of their first-choice players; Sri Lanka field a younger squad. The Nisshin surface has helped spinners all week, and the forecast is sunny.</blockquote>
Live line, scorecard and Lino's take — free in the app 👇` },
  { key: "05-ind-vs-pak-final-preview", svg: preview(IND, PAK, "FINAL PREVIEW", "Gold-medal match · Final", "SAT 3 OCT · 10:00 AM IST (1:30 PM local)", "Korogi Sports Park, Nisshin, Japan",
      ["India: defending Asian Games champions (Hangzhou 2023)", "India beat Sri Lanka by 124 runs in the semi-final", "Pakistan beat Bangladesh by 6 wickets in their semi"], C.pink), caption:
`<b>🏏 India vs Pakistan — Asian Games 2026 final</b>

📅 Sat 3 Oct · ⏰ 10:00 AM IST (1:30 PM local)
📍 Korogi Sports Park, Nisshin, Japan
<blockquote>India (capt. Shreyas Iyer) are the defending champions after Hangzhou 2023 and reached the final with a 124-run win over Sri Lanka. Pakistan (capt. Sahibzada Farhan) beat Bangladesh by six wickets. If the final is washed out, a Super Over decides it.</blockquote>
Get toss, wicket and result alerts + ball-by-ball live line in the app 👇` },
];

async function main() {
  const out = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "/tmp/launch-posts";
  const si = process.argv.indexOf("--send");
  const target = si > 0 ? process.argv[si + 1] : "";
  fs.mkdirSync(out, { recursive: true });
  for (const p of posts) {
    const png = await renderCard(p.svg);
    fs.writeFileSync(path.join(out, `${p.key}.png`), png);
    fs.writeFileSync(path.join(out, `${p.key}.caption.html`), p.caption);
    if (target) {
      const r = await sendPhotoCard(target, png, p.caption, markup);
      console.log(p.key, r.ok ? `ok message_id=${r.messageId}` : `FAILED ${r.code} ${r.description}`);
      await new Promise((res) => setTimeout(res, 1500));
    } else console.log("rendered", p.key, png.length);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
