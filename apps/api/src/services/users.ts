import { prisma } from "@liveline/db";
import {
  assertContactBelongsToUser,
  formatIst,
  isAdmin,
  normalizePhone,
  parseAdminList,
  phoneHash,
  type InitDataResult,
} from "@liveline/shared";
import { env } from "../env";
import { httpError } from "../httpError";
import { loadKey } from "./cryptoKey";
import { sendTelegramMessage } from "../telegram";

const admins = () => parseAdminList(env.adminRaw);

export function userIsAdmin(telegramId: string, username?: string | null): boolean {
  return isAdmin(admins(), telegramId, username);
}

export async function touchFromInit(data: InitDataResult) {
  const telegramId = String(data.user.id);
  const existing = await prisma.user.findUnique({ where: { telegramId } });
  if (!existing) {
    return prisma.user.create({
      data: {
        telegramId,
        username: data.user.username || null,
        firstName: data.user.first_name || null,
        lastName: data.user.last_name || null,
        languageCode: (data.user.language_code || "en").startsWith("hi") ? "hi" : "en",
        isPremium: Boolean(data.user.is_premium),
        startParam: data.startParam,
        status: "PENDING",
      },
    });
  }
  return prisma.user.update({
    where: { id: existing.id },
    data: {
      username: data.user.username || null,
      firstName: data.user.first_name || null,
      lastName: data.user.last_name || null,
      isPremium: Boolean(data.user.is_premium),
      lastSeenAt: new Date(),
      ...(existing.languageLocked ? {} : { languageCode: (data.user.language_code || existing.languageCode).startsWith("hi") ? "hi" : existing.languageCode }),
    },
  });
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
  const user = await prisma.user.update({
    where: { telegramId },
    data: { phone: normalized, phoneHash: hash, phoneVerifiedAt: new Date() },
  });
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
  const groupId = parseGroup(user.startParam);
  if (groupId) {
    await prisma.groupChat.upsert({ where: { id: groupId }, update: {}, create: { id: groupId } });
    await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId, userId: user.id } },
      update: {},
      create: { groupId, userId: user.id },
    });
  }
  await alertAdmins(user.id);
}

function parseReferrer(startParam?: string | null): string | null {
  const match = (startParam || "").match(/^ref_?(\d+)$/);
  return match ? match[1] : null;
}

function parseGroup(startParam?: string | null): string | null {
  const match = (startParam || "").match(/^grp_(.+)$/);
  return match ? match[1] : null;
}

async function alertAdmins(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const total = await prisma.user.count({ where: { status: "ACTIVE" } });
  const text = [
    "🆕 <b>New LiveLinePro registration</b>",
    `ID: <code>${user.telegramId}</code>`,
    user.username ? `@${user.username}` : "No username",
    `Name: ${[user.firstName, user.lastName].filter(Boolean).join(" ") || "—"}`,
    `Language: ${user.languageCode}`,
    `Phone: ${user.phone || "not shared"}`,
    `Telegram Premium: ${user.isPremium ? "yes" : "no"}`,
    `Source: ${user.startParam || "direct"}`,
    `Joined: ${formatIst(user.createdAt)} IST`,
    `Total users: ${total}`,
  ].join("\n");
  const chats = new Set<string>([...admins().ids]);
  if (env.adminAlertChat) chats.add(env.adminAlertChat);
  for (const chatId of chats) {
    await sendTelegramMessage(chatId, text).catch((err) => {
      console.error(JSON.stringify({ level: "error", msg: "admin-alert", err: String(err) }));
    });
  }
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

export function publicUser(user: {
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
  streak: number;
  bonusSpins: number;
  predictionBoost: number;
  theme: string;
  unlockedThemes: string;
  referralCount: number;
  startParam: string | null;
  termsAcceptedAt: Date | null;
  phoneVerifiedAt: Date | null;
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
    points: user.points,
    streak: user.streak,
    bonusSpins: user.bonusSpins,
    predictionBoost: user.predictionBoost,
    theme: user.theme,
    themes: user.unlockedThemes.split(",").filter(Boolean),
    referralCount: user.referralCount,
    referralLink: `https://t.me/LiveLineProBot?start=ref_${user.telegramId}`,
    admin: userIsAdmin(user.telegramId, user.username),
  };
}
