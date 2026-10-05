import crypto from "crypto";

/**
 * Website phone-verification gate (apps/site). Shared by the site (cookies, OTP) and the
 * api/bot (Telegram one-time login links). Everything here is pure / store-injected so it is
 * unit-testable without Redis.
 */

export const WEBVERIFY_PREFIX = "webverify_";
/** Session cookie lifetime: 90 days. */
export const WEB_SESSION_TTL_S = 90 * 24 * 3600;
/** One-time "Return to website" login token lifetime. */
export const WEB_LOGIN_TOKEN_TTL_S = 15 * 60;
/** A Telegram verify nonce is valid for 15 minutes. */
export const WEB_NONCE_TTL_S = 15 * 60;

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Purpose-separated HMAC key so a login token can never be replayed as a session cookie. */
export function deriveKey(secret: string, purpose: string): Buffer {
  if (!secret || secret.length < 16) throw new Error("WEB_AUTH_SECRET must be at least 16 characters");
  return crypto.createHmac("sha256", secret).update(`llp-web:${purpose}`).digest();
}

export interface SignedPayload { exp: number; [k: string]: unknown }

export function signPayload(payload: SignedPayload, secret: string, purpose: string): string {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", deriveKey(secret, purpose)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyPayload<T extends SignedPayload>(token: string | undefined | null, secret: string, purpose: string, nowMs = Date.now()): T | null {
  if (!token || typeof token !== "string" || token.length > 2048) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  const calc = crypto.createHmac("sha256", deriveKey(secret, purpose)).update(body).digest();
  let given: Buffer;
  try { given = Buffer.from(sig, "base64url"); } catch { return null; }
  if (given.length !== calc.length || !crypto.timingSafeEqual(given, calc)) return null;
  let data: T;
  try { data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T; } catch { return null; }
  if (!data || typeof data.exp !== "number" || data.exp * 1000 <= nowMs) return null;
  return data;
}

/* ---------- Telegram nonce + one-time login token ---------- */

/** 24 random bytes → 32 url-safe chars; `webverify_` + nonce = 42 chars (Telegram start param max 64, [A-Za-z0-9_-]). */
export function newNonce(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function isValidNonce(n: unknown): n is string {
  return typeof n === "string" && /^[A-Za-z0-9_-]{32}$/.test(n);
}

/** `webverify_<nonce>` start parameter → nonce, or null. */
export function parseWebverifyParam(param: string | undefined | null): string | null {
  const p = (param || "").trim();
  if (!p.startsWith(WEBVERIFY_PREFIX)) return null;
  const n = p.slice(WEBVERIFY_PREFIX.length);
  return isValidNonce(n) ? n : null;
}

export type WebVerifyMethod = "telegram" | "sms";

export interface LoginTokenPayload extends SignedPayload { u: string; m: WebVerifyMethod; j: string; n?: string }

export function signLoginToken(userId: string, method: WebVerifyMethod, secret: string, opts: { nonce?: string; nowMs?: number; ttlS?: number } = {}): { token: string; jti: string } {
  const jti = crypto.randomBytes(12).toString("base64url");
  const exp = Math.floor((opts.nowMs ?? Date.now()) / 1000) + (opts.ttlS ?? WEB_LOGIN_TOKEN_TTL_S);
  const payload: LoginTokenPayload = { u: userId, m: method, j: jti, exp, ...(opts.nonce ? { n: opts.nonce } : {}) };
  return { token: signPayload(payload, secret, "login"), jti };
}

export function verifyLoginToken(token: string | undefined | null, secret: string, nowMs = Date.now()): LoginTokenPayload | null {
  const p = verifyPayload<LoginTokenPayload>(token, secret, "login", nowMs);
  if (!p || typeof p.u !== "string" || !p.u || typeof p.j !== "string" || (p.m !== "telegram" && p.m !== "sms")) return null;
  return p;
}

/* ---------- session cookie ---------- */

export interface WebSessionPayload extends SignedPayload { u: string; m: WebVerifyMethod; iat: number }

export function signSession(userId: string, method: WebVerifyMethod, secret: string, nowMs = Date.now(), ttlS = WEB_SESSION_TTL_S): string {
  const iat = Math.floor(nowMs / 1000);
  return signPayload({ u: userId, m: method, iat, exp: iat + ttlS } satisfies WebSessionPayload, secret, "session");
}

export function verifySession(cookie: string | undefined | null, secret: string, nowMs = Date.now()): WebSessionPayload | null {
  const p = verifyPayload<WebSessionPayload>(cookie, secret, "session", nowMs);
  if (!p || typeof p.u !== "string" || !p.u || (p.m !== "telegram" && p.m !== "sms")) return null;
  return p;
}

/* ---------- phone numbers ---------- */

/**
 * Normalise user input to E.164 digits (no "+"). Bare 10-digit Indian mobiles get the +91
 * default. Indian numbers must be 6-9 followed by 9 digits; others 8-15 digits.
 */
export function normalizeWebPhone(input: string, defaultCc = "91"): string | null {
  const raw = String(input || "").trim();
  if (!raw || raw.length > 24) return null;
  const hadPlus = raw.startsWith("+") || raw.startsWith("00");
  let d = raw.replace(/\D/g, "");
  if (raw.startsWith("00")) d = d.slice(2);
  if (!hadPlus) {
    if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
    if (d.length === 10) d = defaultCc + d;
  }
  if (d.startsWith("91")) return /^91[6-9]\d{9}$/.test(d) ? d : null;
  return /^[1-9]\d{7,14}$/.test(d) ? d : null;
}

export function maskWebPhone(e164: string): string {
  const d = String(e164 || "").replace(/\D/g, "");
  if (d.length < 8) return "•••";
  const cc = d.length > 10 ? d.slice(0, d.length - 10) : "";
  return `${cc ? `+${cc} ` : ""}${"•".repeat(Math.min(d.length, 10) - 4)}${d.slice(-4)}`;
}

/* ---------- SMS OTP ---------- */

/** Minimal KV the OTP service needs (Redis in production, a Map in tests). TTLs in seconds. */
export interface OtpStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlS: number): Promise<void>;
  /** Increment and return the new count; the TTL is set when the key is created. */
  incr(key: string, ttlS: number): Promise<number>;
  del(key: string): Promise<void>;
  /** Remaining seconds, or -2 when missing. */
  ttl(key: string): Promise<number>;
}

export interface OtpLimits {
  ttlS: number;            // code lifetime
  resendS: number;         // cooldown between sends to one phone
  maxAttempts: number;     // wrong guesses per code
  perPhoneHour: number;    // sends per phone per hour
  perPhoneDay: number;     // sends per phone per day
  perIpHour: number;       // sends per IP per hour
  perIpDay: number;        // sends per IP per day
  verifyPerIpHour: number; // verify calls per IP per hour
}

export const OTP_DEFAULTS: OtpLimits = {
  ttlS: 300, resendS: 30, maxAttempts: 5, perPhoneHour: 5, perPhoneDay: 10, perIpHour: 10, perIpDay: 30, verifyPerIpHour: 40,
};

export function generateOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(code: string, phone: string, secret: string): string {
  return crypto.createHmac("sha256", deriveKey(secret, "otp")).update(`${phone}:${code}`).digest("hex");
}

/** Opaque, non-reversible key fragment for a phone or IP (keeps raw numbers out of Redis keys). */
export function otpKeyPart(value: string, secret: string): string {
  return crypto.createHmac("sha256", deriveKey(secret, "otp-key")).update(value).digest("hex").slice(0, 32);
}

export type OtpSendResult =
  | { ok: true; code: string; resendIn: number; expiresIn: number }
  | { ok: false; error: "cooldown" | "phone_limit" | "ip_limit"; retryIn: number };

export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; error: "expired" | "wrong" | "locked" | "ip_limit" | "bad_code"; attemptsLeft?: number };

interface OtpRecord { h: string; a: number; exp: number }

export class OtpService {
  constructor(private store: OtpStore, private secret: string, private limits: OtpLimits = OTP_DEFAULTS, private now: () => number = Date.now) {}

  private k(kind: string, v: string) { return `ll:otp:${kind}:${otpKeyPart(v, this.secret)}`; }

  /**
   * Rate-limit, then create + store a hashed code. The caller sends `code` through the SMS
   * provider and must call `cancel()` if that send fails.
   */
  async issue(phone: string, ip: string): Promise<OtpSendResult> {
    const L = this.limits;
    const cdKey = this.k("cd", phone);
    const cd = await this.store.ttl(cdKey);
    if (cd > 0) return { ok: false, error: "cooldown", retryIn: cd };
    const ipH = await this.store.incr(this.k("iph", ip), 3600);
    const ipD = await this.store.incr(this.k("ipd", ip), 86400);
    if (ipH > L.perIpHour || ipD > L.perIpDay) {
      return { ok: false, error: "ip_limit", retryIn: Math.max(1, await this.store.ttl(this.k(ipH > L.perIpHour ? "iph" : "ipd", ip))) };
    }
    const phH = await this.store.incr(this.k("ph", phone), 3600);
    const phD = await this.store.incr(this.k("pd", phone), 86400);
    if (phH > L.perPhoneHour || phD > L.perPhoneDay) {
      return { ok: false, error: "phone_limit", retryIn: Math.max(1, await this.store.ttl(this.k(phH > L.perPhoneHour ? "ph" : "pd", phone))) };
    }
    const code = generateOtp();
    const rec: OtpRecord = { h: hashOtp(code, phone, this.secret), a: 0, exp: Math.floor(this.now() / 1000) + L.ttlS };
    await this.store.set(this.k("code", phone), JSON.stringify(rec), L.ttlS);
    await this.store.set(cdKey, "1", L.resendS);
    return { ok: true, code, resendIn: L.resendS, expiresIn: L.ttlS };
  }

  /** Undo a code whose SMS could not be sent (lets the user retry immediately). */
  async cancel(phone: string): Promise<void> {
    await this.store.del(this.k("code", phone));
    await this.store.del(this.k("cd", phone));
  }

  async verify(phone: string, code: string, ip: string): Promise<OtpVerifyResult> {
    if (!/^\d{6}$/.test(String(code || ""))) return { ok: false, error: "bad_code" };
    const vIp = await this.store.incr(this.k("vip", ip), 3600);
    if (vIp > this.limits.verifyPerIpHour) return { ok: false, error: "ip_limit" };
    const key = this.k("code", phone);
    const raw = await this.store.get(key);
    if (!raw) return { ok: false, error: "expired" };
    let rec: OtpRecord;
    try { rec = JSON.parse(raw) as OtpRecord; } catch { await this.store.del(key); return { ok: false, error: "expired" }; }
    const nowS = Math.floor(this.now() / 1000);
    if (rec.exp <= nowS) { await this.store.del(key); return { ok: false, error: "expired" }; }
    if (rec.a >= this.limits.maxAttempts) { await this.store.del(key); return { ok: false, error: "locked" }; }
    const a = Buffer.from(hashOtp(code, phone, this.secret), "hex"), b = Buffer.from(rec.h, "hex");
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      await this.store.del(key);
      return { ok: true };
    }
    rec.a += 1;
    if (rec.a >= this.limits.maxAttempts) { await this.store.del(key); return { ok: false, error: "locked", attemptsLeft: 0 }; }
    await this.store.set(key, JSON.stringify(rec), Math.max(1, rec.exp - nowS));
    return { ok: false, error: "wrong", attemptsLeft: this.limits.maxAttempts - rec.a };
  }
}
