import { env } from "./env";
import { ASSET_V, esc, tgIcon } from "./html";

/** Standalone, mobile-first verify screen (no site nav: nothing behind the gate is reachable). */
function shell(title: string, body: string, extraHead = ""): string {
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#070b14">
<meta name="description" content="Verify your phone once to enter LiveLinePro — free live cricket scores for fans 18+.">
<link rel="icon" href="/brand/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/icon-512.png">
<link rel="preload" href="/fonts/BarlowCondensed-ExtraBold.ttf" as="font" type="font/ttf" crossorigin>
<link rel="stylesheet" href="/site.css?v=${ASSET_V}">
<link rel="stylesheet" href="/verify.css?v=${ASSET_V}">
${extraHead}
</head>
<body class="vf-body">
${body}
</body>
</html>`;
}

const ERRORS: Record<string, string> = {
  link: "That sign-in link is invalid or has expired. Verify again below.",
  used: "That sign-in link was already used. Verify again below — it only takes a moment.",
};

export interface VerifyView { tgLink: string; ttl: number; next: string; smsEnabled: boolean; error: string }

export function verifyPage(v: VerifyView): string {
  const err = ERRORS[v.error] || "";
  const bot = esc(env.botUsername);
  const tgReady = Boolean(v.tgLink);
  const dis = v.smsEnabled ? "" : " disabled";
  const body = `
<main class="vf" data-ttl="${v.ttl}" data-next="${esc(v.next)}" data-sms="${v.smsEnabled ? "1" : "0"}">
  <header class="vf-head">
    <div class="vf-logo"><img src="/brand/icon.svg" width="40" height="40" alt=""><span><b>LIVELINE</b><i>Pro</i></span></div>
    <div class="vf-mascot"><span class="vf-ring"></span><img src="/brand/mascot.svg" width="104" height="104" alt="Lino, the LiveLinePro mascot" class="bob"></div>
    <h1>Verify to <span class="lime">enter</span></h1>
    <p class="vf-sub">Live line, scorecards and Lino AI are free for verified fans aged <b>18+</b>. Verify your phone once — it takes about 10 seconds.</p>
    <ul class="vf-perks" aria-label="What you get">
      <li><span class="vf-perk-i">⚡</span><span><b>Ball-by-ball</b> live line</span></li>
      <li><span class="vf-perk-i">🤖</span><span><b>Lino AI</b> match insights</span></li>
      <li><span class="vf-perk-i">🔔</span><span><b>Wicket alerts</b> on Telegram</span></li>
    </ul>
  </header>
  <div class="vf-main">
  ${err ? `<p class="vf-alert" role="alert">${esc(err)}</p>` : ""}

  <section class="vf-card vf-tg" id="tg-card" aria-labelledby="tg-h">
    <div class="vf-card-top">
      <span class="vf-ic tg">${tgIcon()}</span>
      <div><span class="vf-pill live">Recommended · 1 tap</span><h2 id="tg-h">Telegram</h2><p>Open <b>@${bot}</b> and tap Start — Telegram shares your number securely.</p></div>
    </div>
    <div class="vf-tg-idle" id="tg-idle">
      ${tgReady
        ? `<a class="vf-btn tg" id="tg-btn" href="${esc(v.tgLink)}" target="_blank" rel="noopener">${tgIcon()}Verify with Telegram</a>`
        : `<button class="vf-btn tg" disabled>${tgIcon()}Temporarily unavailable</button>`}
      <p class="vf-fine">Already verified in the bot? You'll be signed in instantly.</p>
    </div>
    <div class="vf-tg-wait" id="tg-wait" hidden aria-live="polite">
      <div class="vf-wait-row"><span class="vf-spin" aria-hidden="true"></span><div><b>Waiting for Telegram…</b><span id="tg-wait-sub">Finish in @${bot}, then come back here.</span></div></div>
      <ol class="vf-steps">
        <li><span><b>Tap Start</b> in @${bot}</span></li>
        <li><span><b>Share your phone</b> — one tap, nothing to type (18+)</span></li>
        <li><span><b>Come back</b> — this page signs you in automatically</span></li>
      </ol>
      <div class="vf-row2">
        <a class="vf-btn ghost" id="tg-again" href="${esc(v.tgLink)}" target="_blank" rel="noopener">${tgIcon()}Open Telegram again</a>
        <button class="vf-link" id="tg-cancel" type="button">Cancel</button>
      </div>
    </div>
    <div class="vf-tg-done" id="tg-done" hidden><span class="vf-check">✓</span><b>Verified!</b> Taking you in…</div>
  </section>

  <div class="vf-or"><span>or</span></div>

  <section class="vf-card vf-sms${v.smsEnabled ? "" : " soon"}" id="sms-card" aria-labelledby="sms-h">
    <div class="vf-card-top">
      <span class="vf-ic sms" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2zm3 6v2h2v-2zm4 0v2h2v-2zm4 0v2h2v-2z"/></svg></span>
      <div>${v.smsEnabled ? `<span class="vf-pill">Indian mobiles</span>` : `<span class="vf-pill soon">Coming soon</span>`}<h2 id="sms-h">SMS code</h2><p>We text a 6-digit code to your mobile.</p></div>
    </div>
    <form class="vf-form" id="sms-form" novalidate>
      <fieldset id="sms-step-phone"${dis}>
        <label class="vf-label" for="sms-phone">Mobile number</label>
        <div class="vf-phone"><span class="vf-cc">🇮🇳 +91</span><input id="sms-phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="14" placeholder="98765 43210" aria-describedby="sms-msg"></div>
        <label class="vf-check-row"><input type="checkbox" id="sms-age"> <span>I confirm I am <b>18 years or older</b>.</span></label>
        <label class="vf-check-row"><input type="checkbox" id="sms-terms"> <span>I accept the <a href="/terms" target="_blank">Terms</a> and <a href="/privacy" target="_blank">Privacy notice</a>.</span></label>
        <button class="vf-btn lime" id="sms-send" type="submit">${v.smsEnabled ? "Send OTP" : "Coming soon"}</button>
      </fieldset>
      <fieldset id="sms-step-code" hidden>
        <p class="vf-sent">Code sent to <b id="sms-to"></b> <button class="vf-link" type="button" id="sms-change">Change</button></p>
        <label class="vf-label" for="sms-code">6-digit code</label>
        <input id="sms-code" class="vf-otp" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" maxlength="6" placeholder="••••••" aria-describedby="sms-msg">
        <button class="vf-btn lime" id="sms-verify" type="button">Verify &amp; enter</button>
        <p class="vf-resend"><button class="vf-link" type="button" id="sms-resend" disabled>Resend code</button> <span id="sms-timer"></span></p>
      </fieldset>
      <p class="vf-msg" id="sms-msg" role="status"></p>
      ${v.smsEnabled ? "" : `<p class="vf-fine">SMS sign-in is on the way. Telegram verification is free and live now.</p>`}
    </form>
  </section>

  </div>
  <footer class="vf-foot">
    <p><span class="pill18">18+</span> A free cricket fan app for adults. Your number is used only to keep one account per person — never shown publicly.</p>
    <p><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="https://t.me/${esc(env.channelUsername)}" rel="noopener">@${esc(env.channelUsername)}</a></p>
  </footer>
</main>
<script src="/verify.js?v=${ASSET_V}" defer></script>`;
  return shell("Verify to enter | LiveLinePro", body);
}

const TERMS = [
  ["Who can use LiveLinePro", "LiveLinePro is a free cricket fan service (website, Telegram bot and Mini App) for people aged 18 and over. By verifying you confirm you are 18+ and that the phone number is yours."],
  ["What we offer", "Live scores, scorecards, schedules, match alerts, Lino AI insights and fan features such as points, XP and badges. Points and XP are for levels and leaderboards only: they have no money value and cannot be exchanged, redeemed or transferred."],
  ["Fair use", "One account per person. Don't automate access, scrape, resell content or try to get around verification. We may suspend accounts that break these terms."],
  ["Data feed", "Scores come from a licensed cricket data feed and may be delayed or corrected. LiveLinePro is not affiliated with the ICC, BCCI or any team."],
  ["Changes", "We may update these terms; continuing to use the service means you accept the current version."],
];
const PRIVACY = [
  ["What we collect", "Your verified phone number (via Telegram's contact button or an SMS code), and — if you use Telegram — your Telegram ID, name, username, language and Premium flag. On the website we set one secure sign-in cookie."],
  ["Why", "To keep one account per person, keep leaderboards fair, send the alerts you ask for, and understand which pages are useful. We never read your phone book and never show your number publicly."],
  ["SMS codes", "One-time codes are stored only as a hash and expire after 5 minutes."],
  ["Sharing", "We don't sell your data. Service providers (hosting, SMS delivery) process it only to run LiveLinePro."],
  ["Your choices", "Send /stop to the bot to turn off messages, or ask us to delete your account via @" + env.botUsername + "."],
];

export function legalPage(kind: "terms" | "privacy"): string {
  const rows = kind === "terms" ? TERMS : PRIVACY;
  const title = kind === "terms" ? "Terms of use" : "Privacy notice";
  return shell(`${title} | LiveLinePro`, `
<main class="vf vf-legal">
  <header class="vf-head"><a class="vf-logo" href="/verify"><img src="/brand/icon.svg" width="36" height="36" alt=""><span><b>LIVELINE</b><i>Pro</i></span></a><h1>${title}</h1></header>
  ${rows.map(([h, p]) => `<section class="vf-card"><h2>${esc(h)}</h2><p>${esc(p)}</p></section>`).join("")}
  <p class="vf-foot"><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/">Back to LiveLinePro</a></p>
</main>`);
}
