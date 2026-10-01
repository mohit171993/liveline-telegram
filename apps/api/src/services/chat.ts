import { prisma } from "@liveline/db";
import { containsProfanity, maskProfanity } from "@liveline/shared";
import { httpError } from "../httpError";
import { redis } from "../redis";

const EMOJIS = new Set(["🔥", "👏", "😱", "💀", "🎯", "❤️"]);

async function guard(userId: string, matchKey: string) {
  const mod = await prisma.moderation.findFirst({
    where: { userId, OR: [{ matchKey }, { matchKey: "" }] },
  });
  if (mod?.banned) throw httpError(403, "BANNED");
  if (mod?.mutedUntil && mod.mutedUntil > new Date()) throw httpError(403, "MUTED");
  const n = await redis.incr(`ll:chatrate:${userId}`);
  if (n === 1) await redis.expire(`ll:chatrate:${userId}`, 10);
  if (n > 8) throw httpError(429, "SLOW_DOWN");
}

export async function listChat(matchKey: string) {
  const [messages, polls, reactions] = await Promise.all([
    prisma.watchMessage.findMany({
      where: { matchKey, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 60,
      include: { user: true },
    }),
    prisma.watchPoll.findMany({ where: { matchKey }, orderBy: { createdAt: "desc" }, take: 5, include: { votes: true } }),
    prisma.watchReaction.groupBy({ by: ["emoji", "matchKey"], where: { matchKey, messageId: "" }, _count: true }),
  ]);
  return {
    messages: messages.reverse().map((m) => ({
      id: m.id,
      body: m.body,
      at: m.createdAt,
      name: m.user.username ? `@${m.user.username}` : m.user.firstName || "Fan",
      userId: m.userId,
    })),
    reactions: Object.fromEntries(reactions.map((r) => [r.emoji, r._count])),
    polls: polls.map((p) => ({
      id: p.id,
      question: p.question,
      options: JSON.parse(p.options) as string[],
      votes: JSON.parse(p.options).map((_: string, index: number) => p.votes.filter((v) => v.option === index).length),
      closesAt: p.closesAt,
    })),
  };
}

export async function postChat(userId: string, matchKey: string, body: string) {
  const text = body.trim().slice(0, 280);
  if (!text) throw httpError(400, "EMPTY");
  if (containsProfanity(text) && maskProfanity(text).replace(/•/g, "").trim().length < 2) {
    throw httpError(400, "PROFANITY");
  }
  await guard(userId, matchKey);
  const message = await prisma.watchMessage.create({
    data: { userId, matchKey, body: maskProfanity(text) },
    include: { user: true },
  });
  const dto = {
    id: message.id,
    body: message.body,
    at: message.createdAt,
    name: message.user.username ? `@${message.user.username}` : message.user.firstName || "Fan",
    userId,
    matchKey,
  };
  await redis.publish(`ll:chat:${matchKey}`, JSON.stringify({ type: "chat", message: dto }));
  return dto;
}

export async function react(userId: string, matchKey: string, emoji: string) {
  if (!EMOJIS.has(emoji)) throw httpError(400, "BAD_EMOJI");
  await prisma.watchReaction.upsert({
    where: { matchKey_userId_emoji_messageId: { matchKey, userId, emoji, messageId: "" } },
    update: {},
    create: { matchKey, userId, emoji, messageId: "" },
  });
  await redis.publish(`ll:chat:${matchKey}`, JSON.stringify({ type: "reaction", emoji }));
  return { ok: true };
}

export async function createPoll(userId: string, matchKey: string, question: string, options: string[]) {
  if (options.length < 2 || options.length > 4) throw httpError(400, "BAD_POLL");
  await guard(userId, matchKey);
  const poll = await prisma.watchPoll.create({
    data: {
      userId,
      matchKey,
      question: question.slice(0, 120),
      options: JSON.stringify(options.map((o) => o.slice(0, 40))),
      closesAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  await redis.publish(`ll:chat:${matchKey}`, JSON.stringify({ type: "poll", id: poll.id, question: poll.question }));
  return poll;
}

export async function votePoll(userId: string, pollId: string, option: number) {
  const poll = await prisma.watchPoll.findUnique({ where: { id: pollId } });
  if (!poll) throw httpError(404, "NOT_FOUND");
  const options = JSON.parse(poll.options) as string[];
  if (option < 0 || option >= options.length) throw httpError(400, "BAD_OPTION");
  await prisma.watchPollVote.upsert({
    where: { pollId_userId: { pollId, userId } },
    update: { option },
    create: { pollId, userId, option },
  });
  return { ok: true };
}

export async function moderate(targetUserId: string, matchKey: string, action: "mute" | "ban" | "clear", minutes = 30) {
  if (action === "clear") {
    await prisma.moderation.deleteMany({ where: { userId: targetUserId, matchKey } });
    return { ok: true };
  }
  await prisma.moderation.upsert({
    where: { userId_matchKey: { userId: targetUserId, matchKey } },
    update: {
      banned: action === "ban",
      mutedUntil: action === "mute" ? new Date(Date.now() + minutes * 60_000) : null,
    },
    create: {
      userId: targetUserId,
      matchKey,
      banned: action === "ban",
      mutedUntil: action === "mute" ? new Date(Date.now() + minutes * 60_000) : null,
    },
  });
  return { ok: true };
}
