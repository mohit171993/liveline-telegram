import { prisma } from "@liveline/db";
import {
  assertContactBelongsToUser,
  formatIst,
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
import { alertSettings, maskPhone } from "./automation";
import { redis } from "../redis";
import { rollDailyStreak } from "./engage";
import { ageFromBirthYear } from "@liveline/shared";
import { bumpFriendStreaks, joinSquad } from "./play";
import { env } from "../env";
import { httpError } from "../httpError";
import { loadKey } from "./cryptoKey";
import nodeCrypto from "node:crypto";
import { sendTelegramMessage } from "../telegram";

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
  const updated = await prisma.user.update({
    where: { id: existing.id },
    data: {
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
  if (taken && taken.telegramId !== telegramId) {
    throw httpError(409, "PHONE_IN_USE", "This phone number is already verified on another LiveLine account.");
  }
  const before = await prisma.user.findUnique({ where: { telegramId }, select: { phoneVerifiedAt: true } });
  const user = await prisma.user.update({
    where: { telegramId },
    data: { phone: normalized, phoneHash: hash, phoneVerifiedAt: before?.phoneVerifiedAt || new Date() },
  });
  if (!before?.phoneVerifiedAt) void alertAdmins(user.id, "verified").catch(() => undefined);
  await maybeActivate(user.id);
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
          body: "You earned 50 points, a bonus spin, and a scratch card.",
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

/**
 * Admin DM alerts. "start": someone pressed /start (or opened the app) for the first time.
 * "verified": phone verification completed. Each fires once per user (Redis NX) and can be
 * switched off in Admin → Settings. Phones are always masked.
 */
export async function alertAdmins(userId: string, kind: "start" | "verified", opts: { force?: boolean; chatIds?: string[] } = {}) {
  const settings = await alertSettings();
  if (!opts.force && kind === "start" && !settings.alert_new_start) return { sent: 0, skipped: "off" };
  if (!opts.force && kind === "verified" && !settings.alert_verified) return { sent: 0, skipped: "off" };
  if (!opts.force) {
    const first = await redis.set(`ll:alert:${kind}:${userId}`, "1", "EX", 90 * 24 * 3600, "NX");
    if (!first) return { sent: 0, skipped: "dup" };
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || "—";
  const esc = (v: string) => v.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));
  let text: string;
  if (kind === "verified") {
    const total = await prisma.user.count({ where: { phoneVerifiedAt: { not: null }, isDemo: false } });
    text = [
      "✅ <b>New verified user</b>",
      `ID: <code>${user.telegramId}</code>`,
      user.username ? `@${esc(user.username)}` : "No username",
      `Name: ${esc(name)}`,
      `Language: ${esc(user.languageCode)}`,
      `Phone: ${esc(maskPhone(user.phone))}`,
      `Telegram Premium: ${user.isPremium ? "yes" : "no"}`,
      `Source: ${esc(user.startParam || "direct")}`,
      `Verified: ${formatIst(user.phoneVerifiedAt || new Date())} IST`,
      `Total verified: ${total}`,
    ].join("\n");
  } else {
    const total = await prisma.user.count({ where: { isDemo: false } });
    text = [
      "🆕 <b>New start</b> (not verified yet)",
      `ID: <code>${user.telegramId}</code>`,
      user.username ? `@${esc(user.username)}` : "No username",
      `Name: ${esc(name)}`,
      `Language: ${esc(user.languageCode)}`,
      `Telegram Premium: ${user.isPremium ? "yes" : "no"}`,
      `Source: ${esc(user.startParam || "direct")}`,
      `Started: ${formatIst(user.createdAt)} IST`,
      `Total users: ${total}`,
    ].join("\n");
  }
  const chats = new Set<string>(opts.chatIds || await adminChatIds());
  if (!opts.chatIds && env.adminAlertChat) chats.add(env.adminAlertChat);
  let sent = 0;
  for (const chatId of chats) {
    const id = await sendTelegramMessage(chatId, text).catch((err) => {
      console.error(JSON.stringify({ level: "error", msg: "admin-alert", kind, err: String(err) }));
      return null;
    });
    if (id) sent += 1;
  }
  return { sent, text };
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
