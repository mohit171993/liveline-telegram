import { prisma } from "@liveline/db";
import {
  assertContactBelongsToUser,
  formatIst,
  sourceDisplay,
  sourceKey,
  sourceName,
  normalizePhone,
  phoneHash,
  assertAvatar,
  FACES,
  FRAMES,
  CAPS,
  JERSEYS,
  isUnlocked,
  rankFor,
  resolveLook,
  ROLES,
  type AvatarPick,
  type InitDataResult,
  type RoleId,
} from "@liveline/shared";
import { adminChatIds, userIsAdmin } from "./admins";
import { adminAlertPrefs, alertSettings, fullPhone, wantsAlert } from "./automation";
import { redis } from "../redis";
import { rollDailyStreak } from "./engage";
import { ageFromBirthYear } from "@liveline/shared";
import { bumpFriendStreaks, joinSquad } from "./play";
import { env } from "../env";
import { httpError } from "../httpError";
import { loadKey } from "./cryptoKey";
import nodeCrypto from "node:crypto";
import { tgCall, type TgResult } from "../telegram";
import { completePendingWebverify, isWebOnlyTelegramId } from "./webverify";

export { userIsAdmin };

export function userCartoon(user: {
  avatarFace: string;
  avatarJersey: string;
  avatarCap: string;
  avatarFrame: string;
  avatarRole: string;
  avatarNumber: number;
}) {
  const role = (ROLES.some((item) => item.id === user.avatarRole) ? user.avatarRole : "bat") as RoleId;
  return resolveLook({
    face: user.avatarFace,
    jersey: user.avatarJersey,
    cap: user.avatarCap,
    frame: user.avatarFrame,
    role,
    number: user.avatarNumber,
  });
}

export async function avatarShop(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const badges = (await prisma.badge.findMany({ where: { userId } })).map((row) => row.badgeKey);
  const mark = <T extends { xp: number; badge?: string }>(items: T[]) => items.map((item) => ({ ...item, unlocked: isUnlocked(item, user.xp, badges) }));
  return {
    look: userCartoon(user),
    pick: {
      face: user.avatarFace,
      jersey: user.avatarJersey,
      cap: user.avatarCap,
      frame: user.avatarFrame,
      role: user.avatarRole,
      number: user.avatarNumber,
    },
    faces: mark(FACES),
    jerseys: mark(JERSEYS),
    caps: mark(CAPS),
    frames: mark(FRAMES),
    roles: ROLES,
    xp: user.xp,
  };
}

export async function saveAvatar(userId: string, pick: AvatarPick) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const badges = (await prisma.badge.findMany({ where: { userId } })).map((row) => row.badgeKey);
  const problem = assertAvatar(pick, user.xp, badges);
  if (problem === "LOCKED") throw httpError(409, "LOCKED", "Earn that piece with XP or a reward first.");
  if (problem) throw httpError(400, problem);
  const saved = await prisma.user.update({
    where: { id: userId },
    data: {
      avatarFace: pick.face,
      avatarJersey: pick.jersey,
      avatarCap: pick.cap,
      avatarFrame: pick.frame,
      avatarRole: pick.role,
      avatarNumber: pick.number,
    },
  });
  return { look: userCartoon(saved), pick };
}

export async function touchFromInit(data: InitDataResult) {
  const telegramId = String(data.user.id);
  const existing = await prisma.user.findUnique({ where: { telegramId } });
  if (!existing) {
    const created = await prisma.user.create({
      data: {
        telegramId,
        username: data.user.username || null,
        firstName: data.user.first_name || null,
        lastName: data.user.last_name || null,
        languageCode: "en",
        isPremium: Boolean(data.user.is_premium),
        startParam: data.startParam,
        status: "PENDING",
      },
    });
    await userIsAdmin(created.telegramId, created.username);
    void alertAdmins(created.id, "start").catch(() => undefined);
    return created;
  }
  // First-touch attribution: the stored start payload is never overwritten. A user created a few
  // minutes ago without one (opened the app first) adopts the first payload; later re-entries are logged.
  const incoming = (data.startParam || "").trim();
  const adopt = Boolean(incoming && !existing.startParam && Date.now() - existing.createdAt.getTime() < 10 * 60_000);
  if (incoming && !adopt && incoming !== existing.startParam) {
    console.log(JSON.stringify({ level: "info", msg: "start-retouch", telegramId, first: existing.startParam || null, now: incoming, label: sourceDisplay(incoming) }));
  }
  const updated = await prisma.user.update({
    where: { id: existing.id },
    data: {
      ...(adopt ? { startParam: incoming } : {}),
      username: data.user.username || null,
      firstName: data.user.first_name || null,
      lastName: data.user.last_name || null,
      isPremium: Boolean(data.user.is_premium),
      lastSeenAt: new Date(),
      ...(existing.languageLocked ? {} : { languageCode: "en" }),
    },
  });
  const rolled = await rollDailyStreak(updated);
  if (rolled.status === "ACTIVE") await bumpFriendStreaks(rolled.id).catch(() => undefined);
  await userIsAdmin(rolled.telegramId, rolled.username);
  return rolled;
}

export async function touchSession(userId: string, matchKey?: string) {
  const since = new Date(Date.now() - 30 * 60_000);
  const open = await prisma.session.findFirst({
    where: { userId, lastSeen: { gte: since } },
    orderBy: { lastSeen: "desc" },
  });
  if (open) {
    await prisma.session.update({ where: { id: open.id }, data: { lastSeen: new Date(), matchKey: matchKey || open.matchKey } });
    return;
  }
  await prisma.session.create({ data: { userId, matchKey } });
}

export async function acceptTerms(userId: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { termsAcceptedAt: new Date() },
  });
  await maybeActivate(user.id);
  return prisma.user.findUniqueOrThrow({ where: { id: userId } });
}

export async function verifyPhone(telegramId: string, contactUserId: number, phone: string) {
  assertContactBelongsToUser(contactUserId, Number(telegramId));
  const normalized = normalizePhone(phone);
  if (normalized.length < 8) throw httpError(400, "BAD_PHONE", "That phone number does not look valid.");
  const hash = phoneHash(normalized, loadKey().toString("base64"));
  const taken = await prisma.user.findUnique({ where: { phoneHash: hash } });
  let fromWebsite = false;
  if (taken && taken.telegramId !== telegramId) {
    // A website-only (SMS) account with this phone now joins on Telegram: fold it into this one.
    if (isWebOnlyTelegramId(taken.telegramId)) {
      await prisma.user.delete({ where: { id: taken.id } });
      fromWebsite = true;
    } else {
      throw httpError(409, "PHONE_IN_USE", "This phone number is already verified on another LiveLine account.");
    }
  }
  const before = await prisma.user.findUnique({ where: { telegramId }, select: { phoneVerifiedAt: true, verifyMethod: true } });
  const user = await prisma.user.update({
    where: { telegramId },
    data: {
      phone: normalized,
      phoneHash: hash,
      phoneVerifiedAt: before?.phoneVerifiedAt || new Date(),
      ...(before?.verifyMethod ? {} : { verifyMethod: fromWebsite ? "sms" : "telegram" }),
      ...(fromWebsite ? { source: "website" } : {}),
    },
  });
  // A visitor finishing the website gate via Telegram gets the website alert instead (see
  // completePendingWebverify), so admins aren't pinged twice for one verification.
  const webPending = await redis.exists(`ll:wv:tg:${telegramId}`).catch(() => 0);
  if (!before?.phoneVerifiedAt && !fromWebsite && !webPending) void alertAdmins(user.id, "verified").catch(() => undefined);
  await maybeActivate(user.id);
  // Website verify gate: a visitor who came from the site gets their "Return to website" link
  // after the normal verification replies.
  setTimeout(() => void completePendingWebverify(telegramId).catch(() => undefined), 1500);
  return prisma.user.findUniqueOrThrow({ where: { id: user.id } });
}

export async function setLanguage(userId: string, language: "en" | "hi") {
  return prisma.user.update({
    where: { id: userId },
    data: { languageCode: language, languageLocked: true },
  });
}

async function maybeActivate(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.status === "BLOCKED") return;
  if (user.status === "ACTIVE") return;
  if (!user.phoneVerifiedAt || !user.termsAcceptedAt) return;
  const referrerTelegram = parseReferrer(user.startParam);
  let referredById: string | undefined;
  if (referrerTelegram && referrerTelegram !== user.telegramId) {
    const referrer = await prisma.user.findUnique({ where: { telegramId: referrerTelegram } });
    if (referrer && referrer.status === "ACTIVE") {
      referredById = referrer.id;
      const nextCount = referrer.referralCount + 1;
      const themes = new Set(referrer.unlockedThemes.split(",").filter(Boolean));
      if (nextCount >= 3) themes.add("monsoon");
      await prisma.user.update({
        where: { id: referrer.id },
        data: {
          referralCount: nextCount,
          points: { increment: 50 },
          bonusSpins: { increment: 1 },
          unlockedThemes: [...themes].join(","),
        },
      });
      await prisma.scratchCard.create({ data: { userId: referrer.id, source: "referral", sourceRef: user.id } });
      await prisma.notification.create({
        data: {
          userId: referrer.id,
          kind: "referral",
          title: "Referral joined",
          body: "You earned 50 points, a bonus XP spin and a bonus XP card.",
          dedupeKey: `ref:${referrer.id}:${user.id}`,
        },
      }).catch(() => undefined);
    }
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { status: "ACTIVE", referredById, points: { increment: referredById ? 20 : 0 } },
  });
  if (referredById) {
    await prisma.scratchCard.create({ data: { userId: user.id, source: "referral" } });
  }
  const squad = parseSquad(user.startParam);
  if (squad) await joinSquad(user.id, squad).catch(() => undefined);
  const groupId = parseGroup(user.startParam);
  if (groupId) {
    await prisma.groupChat.upsert({ where: { id: groupId }, update: {}, create: { id: groupId } });
    await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId, userId: user.id } },
      update: {},
      create: { groupId, userId: user.id },
    });
  }
  // Registration (ACTIVE) only alerts when the verified alert never went out for this user.
  await alertAdmins(user.id, "verified");
}

function parseReferrer(startParam?: string | null): string | null {
  const match = (startParam || "").match(/^ref_?(\d+)$/);
  return match ? match[1] : null;
}

function parseGroup(startParam?: string | null): string | null {
  const match = (startParam || "").match(/^grp_(.+)$/);
  return match ? match[1] : null;
}

function parseSquad(startParam?: string | null): string | null {
  const match = (startParam || "").match(/^sq_(.+)$/);
  return match ? match[1] : null;
}

/** One-tap verify from the Mini App: the tap accepts the terms and self-declares 18+. */
export async function oneTapConsent(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.ageStatus !== "adult" && user.ageStatus !== "consent") {
    await prisma.user.update({ where: { id: userId }, data: { ageStatus: "adult" } });
  }
  return acceptTerms(userId);
}

/**
 * Validates the signed string Telegram returns from WebApp.requestContact()
 * ("contact=<json>&auth_date=..&hash=..", same HMAC scheme as initData).
 */
export function parseSignedContact(raw: string, botToken: string): { userId: number; phone: string } | null {
  let params: URLSearchParams;
  try { params = new URLSearchParams(raw); } catch { return null; }
  const hash = params.get("hash") || "";
  if (!/^[0-9a-f]{64}$/i.test(hash)) return null;
  const check = [...params.entries()].filter(([k]) => k !== "hash").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = nodeCrypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = nodeCrypto.createHmac("sha256", secret).update(check).digest();
  const given = Buffer.from(hash, "hex");
  if (calc.length !== given.length || !nodeCrypto.timingSafeEqual(calc, given)) return null;
  const age = Date.now() / 1000 - Number(params.get("auth_date") || 0);
  if (!(age < 3600 && age > -300)) return null;
  try {
    const c = JSON.parse(params.get("contact") || "{}") as { user_id?: number; phone_number?: string };
    if (!c.user_id || !c.phone_number) return null;
    return { userId: Number(c.user_id), phone: String(c.phone_number) };
  } catch { return null; }
}

export async function setAge(userId: string, birthYear: number, parentConsent: boolean) {
  const year = new Date().getFullYear();
  const status = ageFromBirthYear(birthYear, parentConsent, year);
  if (status === "denied") {
    throw httpError(403, "AGE_DENIED", "LiveLine is 18+, or 13+ with a parent's consent. We store the birth year only.");
  }
  return prisma.user.update({ where: { id: userId }, data: { birthYear, ageStatus: status } });
}

/** Last delivery result per admin chat (shown in Admin → Alerts). */
export const ALERT_STATUS_KEY = (chatId: string) => `ll:alert:rcpt:${chatId}`;

type InlineMarkup = { inline_keyboard: { text: string; url: string }[][] };

const escHtml = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c));

/**
 * Clickable contact for a user in admin alerts: name as a tg://user mention, @username as a
 * t.me link, and a "💬 Message user" button (t.me/username, else tg://user?id=…).
 * Website-only accounts (no real Telegram id) get no tg:// link.
 */
export function alertContact(user: { telegramId: string; username?: string | null; firstName?: string | null; lastName?: string | null }) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || "—";
  const realTg = !isWebOnlyTelegramId(user.telegramId) && /^\d+$/.test(user.telegramId);
  const uname = (user.username || "").replace(/^@/, "");
  const validUname = /^[A-Za-z0-9_]{4,32}$/.test(uname);
  const nameHtml = realTg ? `<a href="tg://user?id=${user.telegramId}">${escHtml(name)}</a>` : escHtml(name);
  const usernameHtml = uname ? (validUname ? `<a href="https://t.me/${uname}">@${escHtml(uname)}</a>` : `@${escHtml(uname)}`) : "";
  const url = validUname ? `https://t.me/${uname}` : realTg ? `tg://user?id=${user.telegramId}` : "";
  const markup: InlineMarkup | undefined = url ? { inline_keyboard: [[{ text: "💬 Message user", url }]] } : undefined;
  return { name, nameHtml, usernameHtml, markup };
}

async function deliverAlert(chatId: string, text: string, kind: string, markup?: InlineMarkup, userId?: string): Promise<TgResult> {
  const base = { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } };
  const send = async (withButton: boolean) => {
    const body = withButton && markup ? { ...base, reply_markup: markup } : base;
    let r = await tgCall("sendMessage", body);
    if (!r.ok && r.code === 429) {
      await new Promise((res) => setTimeout(res, ((r.retryAfter || 2) + 1) * 1000));
      r = await tgCall("sendMessage", body);
    }
    return r;
  };
  let res = await send(true);
  // tg://user?id buttons are refused for users with privacy restrictions
  // (BUTTON_USER_PRIVACY_RESTRICTED / BUTTON_USER_INVALID / BUTTON_URL_INVALID). The text mention
  // stays, so resend without the button: the alert itself must never fail because of it.
  if (!res.ok && markup && res.code === 400 && /BUTTON|USER_PRIVACY|URL/i.test(res.description || "")) {
    console.warn(JSON.stringify({ level: "warn", msg: "admin-alert-button-dropped", kind, chatId, description: res.description }));
    res = await send(false);
  }
  // Last resort: a rejected tg:// mention in the text (rare) — send plain names.
  if (!res.ok && res.code === 400 && /tg:\/\/user/.test(text) && /entit|parse|USER/i.test(res.description || "")) {
    res = await tgCall("sendMessage", { ...base, text: text.replace(/<a href="tg:\/\/user\?id=\d+">([^<]*)<\/a>/g, "$1") });
  }
  const status = { ok: res.ok, code: res.code ?? null, description: res.description ?? null, kind, at: new Date().toISOString() };
  await redis.set(ALERT_STATUS_KEY(chatId), JSON.stringify(status), "EX", 90 * 24 * 3600).catch(() => undefined);
  if (res.ok && res.messageId) {
    // Keep chat + message id so a sent alert can be edited later (e.g. format changes).
    await prisma.outboundMessage.create({ data: { chatId, kind: "admin_alert_sent", payload: JSON.stringify({ m: res.messageId, u: userId || null, k: kind, b: Boolean(markup) }) } }).catch(() => undefined);
  }
  if (!res.ok) {
    console.error(JSON.stringify({ level: "error", msg: "admin-alert-failed", kind, chatId, code: res.code, description: res.description }));
    await prisma.outboundMessage.create({ data: { chatId, kind: "admin_alert_error", payload: JSON.stringify(status).slice(0, 500) } }).catch(() => undefined);
  }
  return res;
}

/**
 * Admin DM alerts. "start": someone pressed /start (or opened the app) for the first time.
 * "verified": phone verification completed. Each fires once per user (Redis NX) and can be
 * switched off in Admin → Settings. Phones are always masked.
 */
export async function alertAdmins(userId: string, kind: "start" | "verified", opts: { force?: boolean; chatIds?: string[]; test?: boolean; sourceOverride?: string } = {}) {
  const settings = await alertSettings();
  if (!opts.force && kind === "start" && !settings.alert_new_start) return { sent: 0, skipped: "off" };
  if (!opts.force && kind === "verified" && !settings.alert_verified) return { sent: 0, skipped: "off" };
  if (!opts.force) {
    const first = await redis.set(`ll:alert:${kind}:${userId}`, "1", "EX", 90 * 24 * 3600, "NX");
    if (!first) return { sent: 0, skipped: "dup" };
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const esc = escHtml;
  const contact = alertContact(user);
  let text: string;
  if (kind === "verified") {
    const total = await prisma.user.count({ where: { phoneVerifiedAt: { not: null }, isDemo: false } });
    const web = user.source === "website";
    text = [
      `${opts.test ? "🧪 <b>TEST</b> — " : ""}✅ <b>New verified user</b>`,
      ...(web ? [`🌐 Website · verified by ${user.verifyMethod === "sms" ? "SMS OTP" : "Telegram"}`] : []),
      isWebOnlyTelegramId(user.telegramId) ? "ID: website account (no Telegram yet)" : `ID: <code>${user.telegramId}</code>`,
      `Name: ${contact.nameHtml}`,
      contact.usernameHtml ? `Username: ${contact.usernameHtml}` : "Username: none",
      `Language: ${esc(user.languageCode)}`,
      `Phone: ${esc(fullPhone(user.phone))}`,
      `Telegram Premium: ${user.isPremium ? "yes" : "no"}`,
      `Source: ${esc(sourceDisplay(opts.test && opts.sourceOverride ? opts.sourceOverride : user.startParam))}`,
      `Verified: ${formatIst(user.phoneVerifiedAt || new Date())} IST`,
      `Total verified: ${total}`,
    ].join("\n");
  } else {
    const total = await prisma.user.count({ where: { isDemo: false } });
    text = [
      `${opts.test ? "🧪 <b>TEST</b> — " : ""}🆕 <b>New start</b> (not verified yet)`,
      `ID: <code>${user.telegramId}</code>`,
      `Name: ${contact.nameHtml}`,
      contact.usernameHtml ? `Username: ${contact.usernameHtml}` : "Username: none",
      `Language: ${esc(user.languageCode)}`,
      `Telegram Premium: ${user.isPremium ? "yes" : "no"}`,
      `Source: ${esc(sourceDisplay(opts.test && opts.sourceOverride ? opts.sourceOverride : user.startParam))}`,
      `Started: ${formatIst(user.createdAt)} IST`,
      `Total users: ${total}`,
    ].join("\n");
  }
  // Recipients: every bound admin on the roster (env + Admins table) who hasn't switched this
  // alert type off for themselves, plus the optional ADMIN_ALERT_CHAT. Each send is independent.
  const prefs = await adminAlertPrefs();
  const roster = opts.chatIds || (await adminChatIds()).filter((id) => wantsAlert(prefs, id, kind));
  const chats = new Set<string>(roster);
  if (!opts.chatIds && env.adminAlertChat) chats.add(env.adminAlertChat);
  let sent = 0;
  const failed: { chatId: string; code?: number; description?: string }[] = [];
  for (const chatId of chats) {
    const res = await deliverAlert(chatId, text, kind, contact.markup, user.id);
    if (res.ok) sent += 1;
    else failed.push({ chatId, code: res.code, description: res.description });
  }
  return { sent, failed, recipients: [...chats], text };
}

/** Website mask: +91 98xxxxx659 (country code, first 2 and last 3 digits). */
export function maskPhoneWeb(phone?: string | null): string {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return "not shared";
  if (d.length < 8) return "xxx";
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 4)}xxxxx${d.slice(-3)}`;
  if (d.length === 10) return `${d.slice(0, 2)}xxxxx${d.slice(-3)}`;
  return `+${d.slice(0, 4)}${"x".repeat(d.length - 7)}${d.slice(-3)}`;
}

const fmtZone = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);

export type WebVerifyAlertMethod = "sms" | "telegram";

/**
 * Admin alert for a website (livelinepro.pro) verification. Sent once per user (the first time
 * they get through the website gate), never on later logins. firstTime = brand-new or newly
 * phone-verified account; otherwise an existing verified user signing in to the website.
 * Recipients/prefs follow the normal "verified" alert. test=true bypasses dedupe and labels TEST.
 */
export async function alertWebsiteVerify(
  userId: string,
  method: WebVerifyAlertMethod,
  firstTime: boolean,
  opts: { test?: boolean; chatIds?: string[] } = {},
) {
  if (!opts.test) {
    const settings = await alertSettings();
    if (!settings.alert_verified) return { sent: 0, skipped: "off" };
    const first = await redis.set(`ll:alert:web:${userId}`, "1", "EX", 365 * 24 * 3600, "NX");
    if (!first) return { sent: 0, skipped: "dup" };
    // The generic "New verified user" alert must not fire again for this verification.
    if (firstTime) await redis.set(`ll:alert:verified:${userId}`, "1", "EX", 90 * 24 * 3600).catch(() => undefined);
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const esc = escHtml;
  const contact = alertContact(user);
  const at = user.webLoginAt || new Date();
  const total = await prisma.user.count({ where: { phoneVerifiedAt: { not: null }, isDemo: false } });
  const lines = [
    `${opts.test ? "🧪 <b>TEST</b> — " : ""}🌐 <b>Website verification</b> · livelinepro.pro`,
    `Method: ${method === "sms" ? "SMS OTP" : "Telegram via website"}`,
    `Status: ${firstTime ? "🆕 first-time (new verified user)" : "↩️ returning (already verified)"}`,
  ];
  if (method === "sms") {
    lines.push(`Phone: ${esc(fullPhone(user.phone))}`);
    if (!isWebOnlyTelegramId(user.telegramId)) lines.push(`Name: ${contact.nameHtml}`, contact.usernameHtml ? `Username: ${contact.usernameHtml}` : "Username: none", `Telegram ID: <code>${user.telegramId}</code>`);
  } else {
    lines.push(`Name: ${contact.nameHtml}`, contact.usernameHtml ? `Username: ${contact.usernameHtml}` : "Username: none", `User ID: <code>${user.telegramId}</code>`);
  }
  lines.push(`Time: ${fmtZone(at, "Asia/Dubai")} Dubai · ${fmtZone(at, "Asia/Kolkata")} IST`, `Total verified: ${total}`);
  const text = lines.join("\n");
  const prefs = await adminAlertPrefs();
  const roster = opts.chatIds || (await adminChatIds()).filter((id) => wantsAlert(prefs, id, "verified"));
  const chats = new Set<string>(roster);
  if (!opts.chatIds && !opts.test && env.adminAlertChat) chats.add(env.adminAlertChat);
  let sent = 0;
  const failed: { chatId: string; code?: number; description?: string }[] = [];
  for (const chatId of chats) {
    const res = await deliverAlert(chatId, text, opts.test ? "web_verify_test" : "web_verify", contact.markup, user.id);
    if (res.ok) sent += 1;
    else failed.push({ chatId, code: res.code, description: res.description });
  }
  return { sent, failed, recipients: [...chats], text };
}

export async function listUsers(query: { q?: string; status?: string }) {
  const q = query.q?.trim();
  return prisma.user.findMany({
    where: {
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              { telegramId: { contains: q } },
              { username: { contains: q, mode: "insensitive" } },
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export function usersCsv(rows: Awaited<ReturnType<typeof listUsers>>): string {
  const header = ["telegramId", "username", "firstName", "lastName", "language", "phone", "premium", "startParam", "status", "points", "joinedIst"];
  const lines = rows.map((user) =>
    [
      user.telegramId,
      user.username || "",
      user.firstName || "",
      user.lastName || "",
      user.languageCode,
      user.phone || "",
      user.isPremium ? "yes" : "no",
      user.startParam || "",
      user.status,
      String(user.points),
      formatIst(user.createdAt),
    ].map(csvCell).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function setBlocked(userId: string, blocked: boolean, reason?: string) {
  return prisma.user.update({
    where: { id: userId },
    data: blocked
      ? { status: "BLOCKED", blockedAt: new Date(), blockReason: reason || "blocked" }
      : { status: "ACTIVE", blockedAt: null, blockReason: null },
  });
}

export async function publicUser(user: {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string;
  isPremium: boolean;
  phone: string | null;
  status: string;
  points: number;
  xp: number;
  seasonXp: number;
  streak: number;
  dailyStreak: number;
  streakFreeze: number;
  fanTeamKey: string | null;
  avatarFace: string;
  avatarJersey: string;
  avatarCap: string;
  avatarFrame: string;
  avatarRole: string;
  avatarNumber: number;
  bonusSpins: number;
  predictionBoost: number;
  theme: string;
  unlockedThemes: string;
  referralCount: number;
  startParam: string | null;
  termsAcceptedAt: Date | null;
  phoneVerifiedAt: Date | null;
  ageStatus: string;
  predStreak: number;
  streakSavers: number;
  doubleDown: number;
  leagueTier: number;
  friendCode: string | null;
}) {
  const registered = user.status === "ACTIVE";
  return {
    id: user.id,
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    language: user.languageCode,
    isPremium: user.isPremium,
    phone: user.phone,
    status: user.status,
    registered,
    needsPhone: !user.phoneVerifiedAt,
    needsTerms: !user.termsAcceptedAt,
    blocked: user.status === "BLOCKED",
    ageStatus: user.ageStatus,
    needsAge: user.ageStatus !== "adult" && user.ageStatus !== "consent",
    points: user.points,
    xp: user.xp,
    seasonXp: user.seasonXp,
    rank: rankFor(user.xp),
    streak: user.streak,
    predStreak: user.predStreak,
    streakSavers: user.streakSavers,
    doubleDown: user.doubleDown,
    leagueTier: user.leagueTier,
    friendCode: user.friendCode,
    dailyStreak: user.dailyStreak,
    streakFreeze: user.streakFreeze,
    fanTeamKey: user.fanTeamKey,
    look: userCartoon(user),
    bonusSpins: user.bonusSpins,
    predictionBoost: user.predictionBoost,
    theme: user.theme,
    themes: user.unlockedThemes.split(",").filter(Boolean),
    referralCount: user.referralCount,
    referralLink: `https://t.me/LiveLineProBot?start=ref_${user.telegramId}`,
    admin: await userIsAdmin(user.telegramId, user.username),
  };
}

type AlertState = "ok" | "not_started" | "blocked" | "unbound" | "error" | "unknown";
function classify(code?: number | null, description?: string | null): AlertState {
  const d = String(description || "").toLowerCase();
  if (d.includes("blocked by the user") || d.includes("user is deactivated")) return "blocked";
  if (d.includes("can't initiate conversation") || d.includes("chat not found") || d.includes("have no rights to send")) return "not_started";
  return code ? "error" : "unknown";
}

/**
 * Admin → Alerts: every roster admin with their per-type prefs and whether the bot can reach them.
 * probe=true does a harmless sendChatAction to each bound admin to check right now.
 */
export async function adminAlertStatus(probe = false) {
  const { ensureEnvAdmins } = await import("./admins");
  await ensureEnvAdmins();
  const rows = await prisma.adminAccount.findMany({ where: { revokedAt: null }, orderBy: { createdAt: "asc" } });
  const prefs = await adminAlertPrefs();
  const out = [];
  for (const row of rows) {
    if (!row.telegramId) {
      out.push({ telegramId: null, username: row.username, name: null, source: row.source, prefs: { start: true, verified: true }, state: "unbound" as AlertState,
        detail: `@${row.username || "?"} hasn't opened @${env.botUsername} yet, so the bot doesn't know their chat. Ask them to press Start.`, last: null, lastError: null });
      continue;
    }
    const id = row.telegramId;
    const [user, lastRaw, lastErr] = await Promise.all([
      prisma.user.findUnique({ where: { telegramId: id }, select: { username: true, firstName: true, botBlockedAt: true } }),
      redis.get(ALERT_STATUS_KEY(id)).catch(() => null),
      prisma.outboundMessage.findFirst({ where: { chatId: id, kind: { in: ["message_error", "admin_alert_error"] } }, orderBy: { createdAt: "desc" } }),
    ]);
    const last = lastRaw ? JSON.parse(lastRaw) as { ok: boolean; code: number | null; description: string | null; at: string; kind: string } : null;
    let state: AlertState = last ? (last.ok ? "ok" : classify(last.code, last.description)) : "unknown";
    let detail = last ? (last.ok ? `Last alert (${last.kind}) delivered ${formatIst(new Date(last.at))} IST` : `Last alert failed ${formatIst(new Date(last.at))} IST: ${last.description || last.code}`) : "No alert sent since this check was added.";
    if (probe) {
      const r = await tgCall("sendChatAction", { chat_id: id, action: "typing" });
      state = r.ok ? "ok" : classify(r.code, r.description);
      detail = r.ok ? "Reachable now: the bot can DM this admin." : `Not reachable: ${r.description || r.code}`;
    }
    if (state === "not_started") detail = `Hasn't started @${env.botUsername} (Telegram: "${(last && !last.ok && last.description) || "can't initiate conversation"}"). Ask them to open the bot and press Start.`;
    if (state === "blocked") detail = `Has blocked @${env.botUsername}. Ask them to unblock it and press Start.`;
    out.push({
      telegramId: id, username: row.username || user?.username || null, name: user?.firstName || null, source: row.source,
      prefs: { start: wantsAlert(prefs, id, "start"), verified: wantsAlert(prefs, id, "verified") },
      state, detail, last, lastError: lastErr ? { at: lastErr.createdAt.toISOString(), payload: lastErr.payload.slice(0, 300) } : null,
    });
  }
  return out;
}


/** /leads in the bot: newest users first, each with a tap-to-open chat link. Admin-only (full phones).
 *  src = a source key from sourceKey() (e.g. "chatgpt", "direct"), filtering by label rules. */
export async function leadsPage(offset: number, filter: "all" | "verified" | "pending", size = 15, src?: string) {
  const where = { isDemo: false, ...(filter === "verified" ? { phoneVerifiedAt: { not: null } } : filter === "pending" ? { phoneVerifiedAt: null } : {}) };
  let total: number;
  let rows;
  if (src) {
    const all = await prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, select: { id: true, startParam: true } });
    const ids = all.filter((u) => sourceKey(u.startParam) === src).map((u) => u.id);
    total = ids.length;
    const pageIds = ids.slice(offset, offset + size);
    const found = await prisma.user.findMany({ where: { id: { in: pageIds } } });
    rows = pageIds.map((id) => found.find((u) => u.id === id)!).filter(Boolean);
  } else {
    [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: offset, take: size }),
    ]);
  }
  const lines = rows.map((u, i) => {
    const c = alertContact(u);
    const link = c.usernameHtml || (isWebOnlyTelegramId(u.telegramId) ? "website only" : `<a href="tg://user?id=${u.telegramId}">💬 open chat</a>`);
    return `${offset + i + 1}. ${u.phoneVerifiedAt ? "✅" : "⏳"} <b>${c.nameHtml}</b> · ${link}\n    ${u.phone ? escHtml(fullPhone(u.phone)) + " · " : ""}<code>${escHtml(u.telegramId)}</code> · ${escHtml(sourceDisplay(u.startParam))} · ${formatIst(u.createdAt)} IST`;
  });
  const label = filter === "verified" ? "verified" : filter === "pending" ? "not verified" : "all";
  const srcLabel = src ? ` · source: ${escHtml(src)}` : "";
  const text = [`👥 <b>Leads</b> (${label}${srcLabel}) · ${total} total · newest first`, "Tap a name or link to open the chat.", "", ...(lines.length ? lines : ["No users match."])].join("\n");
  return { text, total, offset, size };
}

/** Per-source breakdown (labels from @liveline/shared sourceName). Days are Asia/Dubai calendar days. */
export async function sourcesReport() {
  const users = await prisma.user.findMany({ where: { isDemo: false }, select: { startParam: true, createdAt: true, phoneVerifiedAt: true } });
  const dubaiDay = (d: Date) => new Date(d.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
  const today = dubaiDay(new Date());
  const weekStart = dubaiDay(new Date(Date.now() - 6 * 86_400_000));
  const map = new Map<string, { key: string; label: string; raw: Set<string>; users: number; verified: number; users_today: number; verified_today: number; users_7d: number; verified_7d: number }>();
  for (const u of users) {
    const key = sourceKey(u.startParam);
    const row = map.get(key) || { key, label: sourceName(u.startParam), raw: new Set<string>(), users: 0, verified: 0, users_today: 0, verified_today: 0, users_7d: 0, verified_7d: 0 };
    if (u.startParam) row.raw.add(u.startParam);
    row.users += 1;
    const j = dubaiDay(u.createdAt);
    if (j === today) row.users_today += 1;
    if (j >= weekStart) row.users_7d += 1;
    if (u.phoneVerifiedAt) {
      row.verified += 1;
      const v = dubaiDay(u.phoneVerifiedAt);
      if (v === today) row.verified_today += 1;
      if (v >= weekStart) row.verified_7d += 1;
    }
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.users - a.users).map((r) => ({ ...r, raw: [...r.raw].slice(0, 10) }));
}
