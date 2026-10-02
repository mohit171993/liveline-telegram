import { prisma } from "@liveline/db";
import {
  normalizePhone,
  phoneHash,
  randomId,
  signLoginToken,
  verifyPayload,
  WEB_NONCE_TTL_S,
  type SignedPayload,
  type WebVerifyMethod,
} from "@liveline/shared";
import { redis } from "../redis";
import { tgCall } from "../telegram";
import { loadKey } from "./cryptoKey";
import { alertAdmins } from "./users";

/**
 * Website verify gate (apps/site), api/bot side.
 *
 * Telegram route: the site stores `ll:wv:n:<nonce>` = {s:"pending"} in the shared Redis and
 * sends the visitor to t.me/<bot>?start=webverify_<nonce>. The bot remembers the pending nonce
 * for that Telegram user; once the phone is verified (or instantly, if it already is) the nonce
 * is marked verified with the user id — the site's verify page polls it and logs in — and the
 * bot replies with a "Return to website" button carrying a signed one-time login token.
 *
 * SMS route: the site runs the OTP itself and then calls POST /internal/web-auth/sms-verified
 * with a short-lived signed request; we create/find the user here (same users/CRM tables).
 */

const PREVIEW_SITE = "https://liveline-site-production.up.railway.app";

export const webAuthSecret = () => process.env.WEB_AUTH_SECRET || "";
export const webVerifyEnabled = () => webAuthSecret().length >= 16;

/** Where "Return to website" points: SITE_URL, else the current preview host (no domain yet). Never posted publicly. */
export function siteUrl(): string {
  const v = (process.env.SITE_URL || "").trim().replace(/\/+$/, "");
  return /^https:\/\//.test(v) ? v : PREVIEW_SITE;
}

const nonceKey = (n: string) => `ll:wv:n:${n}`;
const pendingKey = (telegramId: string) => `ll:wv:tg:${telegramId}`;

interface NonceRecord { s: "pending" | "verified"; c: number; u?: string; m?: WebVerifyMethod }

async function readNonce(nonce: string): Promise<NonceRecord | null> {
  const raw = await redis.get(nonceKey(nonce)).catch(() => null);
  if (!raw) return null;
  try { return JSON.parse(raw) as NonceRecord; } catch { return null; }
}

export type WebverifyStart = "logged_in" | "pending" | "expired" | "blocked" | "disabled";

/**
 * /start webverify_<nonce>. Already verified → log in now. Otherwise remember the nonce so the
 * normal phone-verification flow can finish it (see completePendingWebverify).
 */
export async function startWebverify(telegramId: string, chatId: number | string, nonce: string): Promise<WebverifyStart> {
  if (!webVerifyEnabled()) return "disabled";
  const rec = await readNonce(nonce);
  if (!rec || rec.s !== "pending") return "expired";
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (user && (user.status === "BLOCKED" || user.blockedAt)) return "blocked";
  if (user?.phoneVerifiedAt) {
    await markVerified(user.id, chatId, nonce);
    return "logged_in";
  }
  await redis.set(pendingKey(telegramId), nonce, "EX", WEB_NONCE_TTL_S);
  return "pending";
}

/** Called right after a Telegram phone verification (bot contact or Mini App). */
export async function completePendingWebverify(telegramId: string): Promise<boolean> {
  if (!webVerifyEnabled()) return false;
  const nonce = await redis.getdel(pendingKey(telegramId)).catch(() => null);
  if (!nonce) return false;
  const rec = await readNonce(nonce);
  if (!rec || rec.s !== "pending") return false;
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user?.phoneVerifiedAt || user.status === "BLOCKED" || user.blockedAt) return false;
  await markVerified(user.id, telegramId, nonce);
  return true;
}

async function markVerified(userId: string, chatId: number | string, nonce: string) {
  const ttl = await redis.ttl(nonceKey(nonce));
  const rec: NonceRecord = { s: "verified", c: Date.now(), u: userId, m: "telegram" };
  await redis.set(nonceKey(nonce), JSON.stringify(rec), "EX", Math.max(60, ttl > 0 ? ttl : 300));
  const user = await prisma.user.update({ where: { id: userId }, data: { webLoginAt: new Date() } });
  if (!user.verifyMethod) await prisma.user.update({ where: { id: userId }, data: { verifyMethod: "telegram" } }).catch(() => undefined);
  const { token } = signLoginToken(userId, "telegram", webAuthSecret(), { nonce });
  const url = `${siteUrl()}/verify/t/${token}`;
  await tgCall("sendMessage", {
    chat_id: chatId,
    text: "✅ <b>Verified.</b> You're signed in on the LiveLinePro website.\n\nIf the website tab is still open it continues automatically — or tap below to go back.",
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: [[{ text: "↩️ Return to website", url }]] },
  });
}

/* ---------------- SMS route (site → api, signed) ---------------- */

export interface SmsVerifiedRequest extends SignedPayload { p: string; age: boolean; terms: boolean; ip?: string }

export class WebAuthError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); }
}

/** Find (by phone) or create the website user after a successful SMS OTP. */
export async function smsVerified(signed: string): Promise<{ userId: string; created: boolean }> {
  if (!webVerifyEnabled()) throw new WebAuthError(503, "DISABLED", "Website verification is not configured.");
  const req = verifyPayload<SmsVerifiedRequest>(signed, webAuthSecret(), "internal-sms");
  if (!req || typeof req.p !== "string") throw new WebAuthError(401, "BAD_SIGNATURE", "Bad or expired request.");
  if (!req.age || !req.terms) throw new WebAuthError(400, "TERMS", "18+ and terms acceptance are required.");
  const phone = normalizePhone(req.p);
  if (phone.length < 8 || phone.length > 15) throw new WebAuthError(400, "BAD_PHONE", "Invalid phone.");
  const hash = phoneHash(phone, loadKey().toString("base64"));
  const existing = await prisma.user.findUnique({ where: { phoneHash: hash } });
  if (existing) {
    if (existing.status === "BLOCKED" || existing.blockedAt) throw new WebAuthError(403, "BLOCKED", "This account is blocked.");
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        webLoginAt: new Date(),
        ...(existing.termsAcceptedAt ? {} : { termsAcceptedAt: new Date() }),
        ...(existing.phoneVerifiedAt ? {} : { phoneVerifiedAt: new Date(), verifyMethod: "sms" }),
      },
    });
    if (!existing.phoneVerifiedAt) void alertAdmins(existing.id, "verified").catch(() => undefined);
    return { userId: existing.id, created: false };
  }
  const now = new Date();
  const user = await prisma.user.create({
    data: {
      // Website-only account: no Telegram identity yet. The "web:" id is never messaged
      // (excluded from reminders/broadcasts as unreachable).
      telegramId: randomId("web:"),
      phone,
      phoneHash: hash,
      phoneVerifiedAt: now,
      termsAcceptedAt: now,
      ageStatus: "adult",
      status: "ACTIVE",
      source: "website",
      verifyMethod: "sms",
      startParam: "web_sms",
      webLoginAt: now,
      lastSeenAt: now,
    },
  });
  void alertAdmins(user.id, "verified").catch(() => undefined);
  return { userId: user.id, created: true };
}

/** True for website-only (SMS) accounts that have no Telegram chat to message. */
export const isWebOnlyTelegramId = (telegramId: string) => telegramId.startsWith("web:");
