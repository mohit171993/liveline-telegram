import fs from "fs";
import path from "path";
import { redis } from "./redis";
import { renderCard } from "./channelCards";
import { tgCall, type TgResult } from "./telegram";

/**
 * "VERIFY YOUR PHONE" card: Telegram has no font sizes, so the verify prompt is a
 * striking 1280x640 neon-on-dark image. Rendered once per process (resvg + bundled
 * Barlow), uploaded once, then re-sent by Telegram file_id.
 */

const W = 1280;
const H = 640;
const FILE_KEY = "ll:verifycard:file:v2";
const C = { navy: "#070b14", lime: "#e7ff4d", cyan: "#3dffe8", green: "#22e07a", ink: "#f4f7fb", muted: "#8e99b0" };

function markUri(): string {
  try {
    return `data:image/png;base64,${fs.readFileSync(path.resolve(__dirname, "../assets/mark-160.png")).toString("base64")}`;
  } catch {
    return "";
  }
}

export function verifyCardSvg(): string {
  const mark = markUri();
  const perks = [
    ["⚡", "Live line", "ball by ball"],
    ["🎯", "Free predictions", "&amp; leaderboard"],
    ["🔔", "Match alerts", "&amp; Lino AI buddy"],
  ];
  const chip = (x: number, label: string, sub: string, color: string) => `
    <rect x="${x}" y="398" width="232" height="86" rx="20" fill="#ffffff" fill-opacity="0.05" stroke="${color}" stroke-opacity="0.55" stroke-width="2"/>
    <circle cx="${x + 30}" cy="441" r="9" fill="${color}"/>
    <text x="${x + 50}" y="434" font-family="Barlow Condensed" font-weight="800" font-size="27" fill="${C.ink}">${label}</text>
    <text x="${x + 50}" y="464" font-family="Barlow" font-weight="600" font-size="19" fill="${C.muted}">${sub}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1a24"/><stop offset="0.55" stop-color="${C.navy}"/><stop offset="1" stop-color="#04060b"/></linearGradient>
  <radialGradient id="gG" cx="0.82" cy="0.45" r="0.5"><stop offset="0" stop-color="${C.green}" stop-opacity="0.42"/><stop offset="1" stop-color="${C.green}" stop-opacity="0"/></radialGradient>
  <radialGradient id="gL" cx="0.08" cy="0.0" r="0.55"><stop offset="0" stop-color="${C.lime}" stop-opacity="0.2"/><stop offset="1" stop-color="${C.lime}" stop-opacity="0"/></radialGradient>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.035"/></pattern>
  <linearGradient id="phone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2a3f"/><stop offset="1" stop-color="#0d1524"/></linearGradient>
  <linearGradient id="shield" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5dffa6"/><stop offset="1" stop-color="#12b85c"/></linearGradient>
  <linearGradient id="btn" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2fe889"/><stop offset="1" stop-color="#17c56a"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#grid)"/>
<rect width="${W}" height="${H}" fill="url(#gL)"/>
<rect width="${W}" height="${H}" fill="url(#gG)"/>
<rect x="0" y="0" width="${W}" height="6" fill="${C.green}"/>
<rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="28" fill="none" stroke="${C.green}" stroke-opacity="0.45" stroke-width="2"/>

<!-- brand -->
${mark ? `<image x="58" y="50" width="56" height="56" href="${mark}" xlink:href="${mark}"/>` : ""}
<text x="${mark ? 126 : 58}" y="90" font-family="Barlow Condensed" font-style="italic" font-weight="900" font-size="36" fill="${C.ink}">LIVELINE <tspan fill="${C.lime}">PRO</tspan></text>
<rect x="${mark ? 330 : 262}" y="62" width="196" height="36" rx="18" fill="${C.green}" fill-opacity="0.16" stroke="${C.green}" stroke-width="2"/>
<text x="${(mark ? 330 : 262) + 98}" y="87" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="21" letter-spacing="2" fill="${C.green}">ONE-TIME STEP</text>

<!-- headline -->
<text x="58" y="218" font-family="Barlow Condensed" font-style="italic" font-weight="900" font-size="112" fill="${C.ink}">VERIFY YOUR</text>
<text x="58" y="322" font-family="Barlow Condensed" font-style="italic" font-weight="900" font-size="112" fill="${C.green}">PHONE</text>
<text x="380" y="318" font-family="Barlow" font-weight="700" font-size="34" fill="${C.lime}">1 tap to unlock</text>
<text x="58" y="370" font-family="Barlow" font-weight="600" font-size="24" fill="${C.muted}">Live line · Alerts · Predict · Lino. Telegram sends your number, nothing to type.</text>

${chip(58, perks[0][1], perks[0][2], C.cyan)}
${chip(306, perks[1][1], perks[1][2], C.lime)}
${chip(554, perks[2][1], perks[2][2], C.green)}

<!-- CTA strip -->
<rect x="58" y="512" width="728" height="70" rx="35" fill="url(#btn)"/>
<rect x="58" y="512" width="728" height="70" rx="35" fill="none" stroke="#b9ffd6" stroke-opacity="0.6" stroke-width="2"/>
<text x="400" y="558" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="32" letter-spacing="1" fill="#04220f">TAP THE GREEN BUTTON BELOW</text>
<path d="M618 532 V560 M606 549 L618 562 L630 549" fill="none" stroke="#04220f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>

<!-- phone + shield art -->
<g transform="translate(900 92)">
  <circle cx="160" cy="230" r="210" fill="${C.green}" fill-opacity="0.07"/>
  <circle cx="160" cy="230" r="160" fill="none" stroke="${C.green}" stroke-opacity="0.25" stroke-width="2" stroke-dasharray="6 10"/>
  <rect x="58" y="20" width="204" height="404" rx="38" fill="url(#phone)" stroke="${C.green}" stroke-width="5"/>
  <rect x="76" y="52" width="168" height="336" rx="18" fill="#060b14" stroke="#ffffff" stroke-opacity="0.08"/>
  <rect x="128" y="32" width="64" height="9" rx="4.5" fill="#ffffff" fill-opacity="0.25"/>
  <rect x="96" y="80" width="128" height="14" rx="7" fill="#ffffff" fill-opacity="0.12"/>
  <rect x="96" y="104" width="90" height="10" rx="5" fill="#ffffff" fill-opacity="0.08"/>
  <path d="M160 140 L232 168 V226 C232 276 200 310 160 326 C120 310 88 276 88 226 V168 Z" fill="url(#shield)" stroke="#c9ffe0" stroke-width="3"/>
  <path d="M126 230 L151 255 L198 204" fill="none" stroke="#04220f" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="96" y="346" width="128" height="26" rx="13" fill="${C.green}"/>
  <text x="160" y="365" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="17" fill="#04220f">VERIFIED</text>
</g>

<text x="${W - 58}" y="${H - 36}" text-anchor="end" font-family="Barlow" font-weight="600" font-size="18" fill="${C.muted}">18+ · Free to play · No betting</text>
</svg>`;
}

let cached: Buffer | null = null;
export async function verifyCardPng(): Promise<Buffer> {
  if (!cached) cached = await renderCard(verifyCardSvg());
  return cached;
}

export const VERIFY_CAPTION = [
  "<b>🔐 VERIFY TO UNLOCK LIVELINE PRO</b>",
  "",
  "<blockquote>⚡ <b>Live line</b>, ball by ball\n🎯 <b>Free predictions</b> &amp; points leaderboard\n🔔 <b>Match alerts</b> &amp; Lino, your AI buddy</blockquote>",
  "",
  "👇 <b>Tap the green button below</b>, it's one tap. Telegram shares your number, nothing to type.",
].join("\n");

/** Send the verify card (photo) with a caption and reply markup; reuses Telegram's file_id. */
export async function sendVerifyCard(chatId: string | number, caption: string, replyMarkup: unknown): Promise<TgResult> {
  const fileId = await redis.get(FILE_KEY).catch(() => null);
  if (fileId) {
    const res = await tgCall("sendPhoto", { chat_id: chatId, photo: fileId, caption, parse_mode: "HTML", reply_markup: replyMarkup });
    if (res.ok || res.code === 403 || res.code === 429) return res;
    await redis.del(FILE_KEY).catch(() => undefined);
  }
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("caption", caption);
  form.set("parse_mode", "HTML");
  form.set("reply_markup", JSON.stringify(replyMarkup));
  form.set("photo", new Blob([new Uint8Array(await verifyCardPng())], { type: "image/png" }), "verify.png");
  const res = await tgCall("sendPhoto", form);
  if (res.ok && res.fileId) await redis.set(FILE_KEY, res.fileId).catch(() => undefined);
  return res;
}

export const VERIFY_KEYBOARD = {
  keyboard: [[{ text: "✅ Share phone to verify", request_contact: true, style: "success" }]],
  resize_keyboard: true,
  is_persistent: true,
};
