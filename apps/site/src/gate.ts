import type { Context, Hono, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  OtpService, WEBVERIFY_PREFIX, WEB_NONCE_TTL_S, WEB_SESSION_TTL_S, isValidNonce, newNonce, normalizeWebPhone, signPayload,
  signSession, verifyLoginToken, verifySession, type OtpStore, type WebSessionPayload, type WebVerifyMethod,
} from "@liveline/shared";
import { redis } from "./data";
import { env } from "./env";
import { createSmsProvider, smsConfigFromEnv, type SmsProvider } from "./sms";
import { legalPage, verifyPage } from "./verifyPage";

/**
 * Mandatory phone verification for the website. Unverified visitors are redirected to /verify;
 * verified ones carry a signed, httpOnly 90-day session cookie checked locally (no DB hit).
 */
export const gate = {
  enabled: process.env.SITE_GATE_ENABLED !== "false",
  secret: process.env.WEB_AUTH_SECRET || "",
  apiUrl: (process.env.API_INTERNAL_URL || "").replace(/\/+$/, ""),
};
/** Fail closed: with the gate on but no secret, nobody can log in (and we say so in the logs). */
export const gateReady = () => gate.secret.length >= 16;

export const SESSION_COOKIE = "llp_s";
const NONCE_COOKIE = "llp_wv";
const NEXT_COOKIE = "llp_next";

const sms: SmsProvider | null = createSmsProvider(smsConfigFromEnv());
export const smsEnabled = () => Boolean(sms) && Boolean(gate.apiUrl);

const redisReady = async () => { if (redis.status === "wait") await redis.connect(); };

const store: OtpStore = {
  async get(k) { await redisReady(); return redis.get(k); },
  async set(k, v, ttl) { await redisReady(); await redis.set(k, v, "EX", Math.max(1, Math.ceil(ttl))); },
  async incr(k, ttl) { await redisReady(); const n = await redis.incr(k); if (n === 1) await redis.expire(k, ttl); return n; },
  async del(k) { await redisReady(); await redis.del(k); },
  async ttl(k) { await redisReady(); return redis.ttl(k); },
};
const otp = () => new OtpService(store, gate.secret);

/* ---------------- helpers ---------------- */

const isHttps = (c: Context) => (c.req.header("x-forwarded-proto") || new URL(c.req.url).protocol.replace(":", "")) === "https";
const clientIp = (c: Context) => (c.req.header("x-real-ip") || c.req.header("x-forwarded-for")?.split(",")[0] || "local").trim().slice(0, 64);

/** Only same-site relative paths, never back into the verify flow. */
export function safeNext(raw: string | undefined | null): string {
  const v = String(raw || "");
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || v.length > 512 || /[\r\n]/.test(v)) return "/";
  if (v === "/verify" || v.startsWith("/verify/") || v.startsWith("/verify?")) return "/";
  return v;
}

/** All values of one cookie name (a host-only and a domain-wide copy can both be present). */
function cookieValues(c: Context, name: string): string[] {
  const raw = c.req.header("cookie") || "";
  return raw.split(/;\s*/).filter((p) => p.startsWith(`${name}=`)).map((p) => { try { return decodeURIComponent(p.slice(name.length + 1)); } catch { return ""; } }).filter(Boolean);
}

/**
 * Remembered-device cookie scope: on the real domain the session is shared by the apex and www
 * (Domain=livelinepro.pro), so switching between them never asks for a new OTP. Other hosts stay host-only.
 */
export function sessionCookieDomain(host: string, siteUrl = env.siteUrl): string | undefined {
  let root = "";
  try { root = siteUrl ? new URL(siteUrl).hostname.replace(/^www\./, "") : ""; } catch { root = ""; }
  const h = host.split(":")[0].toLowerCase();
  if (!root || !root.includes(".")) return undefined;
  return h === root || h.endsWith(`.${root}`) ? root : undefined;
}
const reqHost = (c: Context) => c.req.header("x-forwarded-host") || c.req.header("host") || "";

export function currentSession(c: Context): WebSessionPayload | null {
  if (!gateReady()) return null;
  for (const v of cookieValues(c, SESSION_COOKIE)) {
    const p = verifySession(v, gate.secret);
    if (p) return p;
  }
  return null;
}

/** Re-sign the remembered-device session once a day of use, so an active browser stays signed in (90 days rolling). */
export const SESSION_ROLL_AFTER_S = 24 * 3600;

function writeSession(c: Context, userId: string, method: WebVerifyMethod) {
  const domain = sessionCookieDomain(reqHost(c));
  // Drop an older host-only copy so only the domain-wide cookie remains.
  if (domain) deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isHttps(c) });
  setCookie(c, SESSION_COOKIE, signSession(userId, method, gate.secret), {
    httpOnly: true, secure: isHttps(c), sameSite: "Lax", path: "/", maxAge: WEB_SESSION_TTL_S, ...(domain ? { domain } : {}),
  });
}

function startSession(c: Context, userId: string, method: WebVerifyMethod) {
  writeSession(c, userId, method);
  deleteCookie(c, NONCE_COOKIE, { path: "/" });
}

const nonceKey = (n: string) => `ll:wv:n:${n}`;

/** Same-origin check for the JSON POST endpoints (CSRF). */
function sameOrigin(c: Context): boolean {
  const origin = c.req.header("origin");
  if (!origin) return (c.req.header("sec-fetch-site") || "same-origin") === "same-origin";
  try { return new URL(origin).host === (c.req.header("x-forwarded-host") || c.req.header("host")); } catch { return false; }
}

async function json(c: Context): Promise<Record<string, unknown>> {
  try { return (await c.req.json()) as Record<string, unknown>; } catch { return {}; }
}

const noStore = (c: Context) => { c.header("cache-control", "no-store"); };

/* ---------------- gate middleware ---------------- */

const OPEN_EXACT = new Set(["/healthz", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/privacy", "/terms", "/legal", "/favicon.ico", "/site.css", "/site.js", "/verify.css", "/verify.js"]);
const OPEN_PREFIX = ["/verify/", "/og/", "/fonts/", "/brand/", "/legal/"];

export function isOpenPath(path: string): boolean {
  return path === "/verify" || OPEN_EXACT.has(path) || OPEN_PREFIX.some((p) => path.startsWith(p));
}

export const gateMiddleware: MiddlewareHandler = async (c, next) => {
  if (!gate.enabled) return next();
  const path = c.req.path;
  if (isOpenPath(path)) return next();
  const session = currentSession(c);
  if (session) {
    if (Date.now() / 1000 - session.iat > SESSION_ROLL_AFTER_S) writeSession(c, session.u, session.m);
    await next();
    // Gated HTML must never be stored by shared caches.
    const cc = c.res.headers.get("cache-control");
    if (cc && cc.includes("public")) c.res.headers.set("cache-control", cc.replace("public", "private"));
    c.res.headers.append("vary", "Cookie");
    return;
  }
  if (path.startsWith("/fragment/")) return c.text("", 401, { "cache-control": "no-store" });
  const qs = new URL(c.req.url).search;
  return c.redirect(`/verify?next=${encodeURIComponent(safeNext(path + qs))}`, 302);
};

/* ---------------- routes ---------------- */

async function ensureNonce(c: Context): Promise<{ nonce: string; ttl: number }> {
  await redisReady();
  const have = getCookie(c, NONCE_COOKIE);
  if (isValidNonce(have)) {
    const raw = await redis.get(nonceKey(have));
    const ttl = await redis.ttl(nonceKey(have));
    if (raw && ttl > 120 && JSON.parse(raw).s === "pending") return { nonce: have, ttl };
  }
  const nonce = newNonce();
  await redis.set(nonceKey(nonce), JSON.stringify({ s: "pending", c: Date.now() }), "EX", WEB_NONCE_TTL_S);
  setCookie(c, NONCE_COOKIE, nonce, { httpOnly: true, secure: isHttps(c), sameSite: "Lax", path: "/", maxAge: WEB_NONCE_TTL_S });
  return { nonce, ttl: WEB_NONCE_TTL_S };
}

export function registerGateRoutes(app: Hono) {
  app.get("/verify", async (c) => {
    noStore(c);
    const next = safeNext(c.req.query("next"));
    if (!gate.enabled || currentSession(c)) return c.redirect(next, 302);
    setCookie(c, NEXT_COOKIE, next, { httpOnly: true, secure: isHttps(c), sameSite: "Lax", path: "/", maxAge: 3600 });
    let tgLink = "";
    let ttl = 0;
    if (gateReady()) {
      try {
        const n = await ensureNonce(c);
        tgLink = `https://t.me/${env.botUsername}?start=${WEBVERIFY_PREFIX}${n.nonce}`;
        ttl = n.ttl;
      } catch (err) {
        console.error(JSON.stringify({ level: "error", msg: "webverify-nonce", err: String(err) }));
      }
    }
    return c.html(verifyPage({ tgLink, ttl, next, smsEnabled: smsEnabled() && gateReady(), error: c.req.query("e") || "" }));
  });

  /** Fresh Telegram link (the page calls this when the 15-minute nonce is about to run out). */
  app.post("/verify/tg/new", async (c) => {
    noStore(c);
    if (!sameOrigin(c) || !gateReady()) return c.json({ ok: false }, 403);
    deleteCookie(c, NONCE_COOKIE, { path: "/" });
    await redisReady();
    const nonce = newNonce();
    await redis.set(nonceKey(nonce), JSON.stringify({ s: "pending", c: Date.now() }), "EX", WEB_NONCE_TTL_S);
    setCookie(c, NONCE_COOKIE, nonce, { httpOnly: true, secure: isHttps(c), sameSite: "Lax", path: "/", maxAge: WEB_NONCE_TTL_S });
    return c.json({ ok: true, link: `https://t.me/${env.botUsername}?start=${WEBVERIFY_PREFIX}${nonce}`, ttl: WEB_NONCE_TTL_S });
  });

  /** Polled by the verify page while the visitor verifies in Telegram. Bound to this browser by cookie. */
  app.get("/verify/tg/status", async (c) => {
    noStore(c);
    if (currentSession(c)) return c.json({ status: "verified", next: safeNext(getCookie(c, NEXT_COOKIE)) });
    const nonce = getCookie(c, NONCE_COOKIE);
    if (!gateReady() || !isValidNonce(nonce)) return c.json({ status: "expired" });
    await redisReady();
    const raw = await redis.get(nonceKey(nonce));
    if (!raw) return c.json({ status: "expired" });
    const rec = JSON.parse(raw) as { s: string; u?: string };
    if (rec.s !== "verified" || !rec.u) return c.json({ status: "pending" });
    // One browser, one login: consume the nonce.
    if ((await redis.del(nonceKey(nonce))) !== 1) return c.json({ status: "expired" });
    startSession(c, rec.u, "telegram");
    return c.json({ status: "verified", next: safeNext(getCookie(c, NEXT_COOKIE)) });
  });

  /** "Return to website" button from the bot: signed, one-time, 15-minute login token. */
  app.get("/verify/t/:token", async (c) => {
    noStore(c);
    c.header("referrer-policy", "no-referrer");
    const p = gateReady() ? verifyLoginToken(c.req.param("token"), gate.secret) : null;
    if (!p) return c.redirect("/verify?e=link", 302);
    await redisReady();
    const first = await redis.set(`ll:wv:jti:${p.j}`, "1", "EX", 24 * 3600, "NX");
    if (!first) return c.redirect(currentSession(c) ? safeNext(getCookie(c, NEXT_COOKIE)) : "/verify?e=used", 302);
    startSession(c, p.u, p.m);
    const next = safeNext(getCookie(c, NEXT_COOKIE));
    deleteCookie(c, NEXT_COOKIE, { path: "/" });
    return c.redirect(next, 302);
  });

  app.post("/verify/sms/send", async (c) => {
    noStore(c);
    if (!sameOrigin(c)) return c.json({ ok: false, error: "forbidden" }, 403);
    if (!smsEnabled() || !gateReady()) return c.json({ ok: false, error: "coming_soon", message: "SMS verification is coming soon. Use Telegram for now." }, 503);
    const body = await json(c);
    if (body.age !== true || body.terms !== true) return c.json({ ok: false, error: "terms", message: "Please confirm you're 18+ and accept the terms." }, 400);
    const phone = normalizeWebPhone(String(body.phone || ""));
    if (!phone) return c.json({ ok: false, error: "bad_phone", message: "Enter a valid mobile number." }, 400);
    const r = await otp().issue(phone, clientIp(c));
    if (!r.ok) {
      const message = r.error === "cooldown" ? `Please wait ${r.retryIn}s before requesting another code.`
        : "Too many codes requested. Please try again later or verify with Telegram.";
      return c.json({ ok: false, error: r.error, retryIn: r.retryIn, message }, 429);
    }
    try {
      await sms!.sendOtp(phone, r.code);
    } catch (err) {
      await otp().cancel(phone);
      console.error(JSON.stringify({ level: "error", msg: "sms-send", provider: sms!.name, err: String(err).slice(0, 300) }));
      return c.json({ ok: false, error: "send_failed", message: "We couldn't send the SMS right now. Please try again or verify with Telegram." }, 502);
    }
    return c.json({ ok: true, resendIn: r.resendIn, expiresIn: r.expiresIn });
  });

  app.post("/verify/sms/verify", async (c) => {
    noStore(c);
    if (!sameOrigin(c)) return c.json({ ok: false, error: "forbidden" }, 403);
    if (!smsEnabled() || !gateReady()) return c.json({ ok: false, error: "coming_soon" }, 503);
    const body = await json(c);
    if (body.age !== true || body.terms !== true) return c.json({ ok: false, error: "terms", message: "Please confirm you're 18+ and accept the terms." }, 400);
    const phone = normalizeWebPhone(String(body.phone || ""));
    if (!phone) return c.json({ ok: false, error: "bad_phone", message: "Enter a valid mobile number." }, 400);
    const r = await otp().verify(phone, String(body.code || ""), clientIp(c));
    if (!r.ok) {
      const message = r.error === "wrong" ? `That code isn't right. ${r.attemptsLeft} ${r.attemptsLeft === 1 ? "try" : "tries"} left.`
        : r.error === "locked" ? "Too many wrong tries. Request a new code."
        : r.error === "expired" ? "This code has expired. Request a new one."
        : r.error === "bad_code" ? "Enter the 6-digit code." : "Too many attempts. Please try again later.";
      return c.json({ ok: false, error: r.error, attemptsLeft: r.attemptsLeft, message }, r.error === "ip_limit" ? 429 : 400);
    }
    // Create / find the user in the shared users + CRM tables (api owns the DB and admin alerts).
    const t = signPayload({ exp: Math.floor(Date.now() / 1000) + 60, p: phone, age: true, terms: true }, gate.secret, "internal-sms");
    let userId = "";
    try {
      const res = await fetch(`${gate.apiUrl}/internal/web-auth/sms-verified`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t }), signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; userId?: string; error?: string };
      if (data.error === "BLOCKED") return c.json({ ok: false, error: "blocked", message: "This number can't be used to sign in." }, 403);
      if (!res.ok || !data.ok || !data.userId) throw new Error(`api ${res.status} ${data.error || ""}`);
      userId = data.userId;
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "sms-verified-api", err: String(err) }));
      return c.json({ ok: false, error: "server", message: "Verified, but we couldn't finish signing you in. Please try again." }, 502);
    }
    startSession(c, userId, "sms");
    return c.json({ ok: true, next: safeNext(getCookie(c, NEXT_COOKIE)) });
  });

  app.post("/verify/signout", (c) => {
    if (!sameOrigin(c)) return c.json({ ok: false }, 403);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    const domain = sessionCookieDomain(reqHost(c));
    if (domain) deleteCookie(c, SESSION_COOKIE, { path: "/", domain });
    return c.json({ ok: true });
  });

  app.get("/privacy", (c) => c.html(legalPage("privacy")));
  app.get("/terms", (c) => c.html(legalPage("terms")));
  app.get("/legal", (c) => c.redirect("/terms", 301));
}
