import { prisma } from "@liveline/db";
import {
  applyBoost,
  istDay,
  predictionWindowOpen,
  settleBallPick,
  settleMatchPick,
  settleOverPick,
  type AdvanceResult,
  type Ball,
  type CricketMatchState,
} from "@liveline/shared";
import { env } from "../env";
import { httpError } from "../httpError";
import { getMatch } from "../feed";
import { grantScratch } from "./rewards";
import { bumpMission, grantXp, nudgeRank } from "./engage";
import { userCartoon } from "./users";

const BALL_PICKS = new Set(["dot", "1", "2", "3", "4", "6", "wicket", "extra"]);

export async function predictionState(userId: string, matchKey: string) {
  const found = await getMatch(matchKey);
  if (!found) throw httpError(404, "NOT_FOUND");
  const mine = await prisma.prediction.findMany({
    where: { userId, matchKey },
    orderBy: { lockedAt: "desc" },
    take: 30,
  });
  return { open: found.view.predictionOpen, nextBallAt: found.view.nextBallAt, nextBallIndex: found.view.nextBallIndex, mine };
}

export async function placePrediction(userId: string, matchKey: string, kind: "BALL" | "OVER" | "MATCH", pick: string) {
  const found = await getMatch(matchKey);
  if (!found) throw httpError(404, "NOT_FOUND");
  const { state } = found;
  const now = Date.now();
  if (kind === "BALL") {
    if (!BALL_PICKS.has(pick)) throw httpError(400, "BAD_PICK");
    if (state.status !== "live" || !predictionWindowOpen(now, state.nextBallAt, env.lockMs)) {
      throw httpError(409, "LOCKED", "That ball is locked. Wait for the next one.");
    }
    const inn = state.innings[state.current];
    const targetKey = String(inn?.balls.length || 0);
    const row = await createPrediction(userId, matchKey, "BALL", targetKey, pick);
    await bumpMission(userId, "predict").catch(() => undefined);
    await grantXp(userId, 2).catch(() => undefined);
    return row;
  }
  if (kind === "OVER") {
    const runs = Number(pick);
    if (!Number.isFinite(runs) || runs < 0 || runs > 40) throw httpError(400, "BAD_PICK");
    const inn = state.innings[state.current];
    if (state.status !== "live" || !inn || inn.legalBalls % 6 !== 0 || !predictionWindowOpen(now, state.nextBallAt, env.lockMs)) {
      throw httpError(409, "LOCKED", "Over predictions lock once the over starts.");
    }
    const overNumber = Math.floor(inn.legalBalls / 6) + 1;
    return createPrediction(userId, matchKey, "OVER", `over:${state.current}:${overNumber}`, String(runs));
  }
  if (pick !== "a" && pick !== "b" && pick !== "tie") throw httpError(400, "BAD_PICK");
  if (state.status !== "upcoming" || now >= state.startAt) {
    throw httpError(409, "LOCKED", "Match result locks at the first ball.");
  }
  return createPrediction(userId, matchKey, "MATCH", "match", pick);
}

async function createPrediction(userId: string, matchKey: string, kind: string, targetKey: string, pick: string) {
  try {
    return await prisma.prediction.create({
      data: { userId, matchKey, kind, targetKey, pick },
    });
  } catch {
    throw httpError(409, "ALREADY_LOCKED", "You already locked a pick for that.");
  }
}

export async function settleFeed(events: AdvanceResult[]) {
  for (const event of events) {
    if (event.ball) await settleBall(event.match, event.ball);
    for (const name of event.events) {
      if (name.startsWith("over:")) await settleOver(event.match, name);
      if (name.startsWith("result:")) await settleMatch(event.match);
    }
  }
}

async function settleBall(match: CricketMatchState, ball: Ball) {
  const rows = await prisma.prediction.findMany({
    where: { matchKey: match.key, kind: "BALL", targetKey: String(ball.i), settledAt: null },
  });
  for (const row of rows) {
    const result = settleBallPick(row.pick, ball);
    await applySettlement(row.id, row.userId, result, `Ball ${ball.over}.${ball.ballInOver || "wd"} was ${result.actual}`);
  }
}

async function settleOver(match: CricketMatchState, eventName: string) {
  const [, , inningsIndex, overNumber] = eventName.split(":");
  const inn = match.innings[Number(inningsIndex)];
  const over = inn?.overs.find((item) => item.n === Number(overNumber));
  if (!over) return;
  const rows = await prisma.prediction.findMany({
    where: { matchKey: match.key, kind: "OVER", targetKey: `over:${inningsIndex}:${overNumber}`, settledAt: null },
  });
  for (const row of rows) {
    const result = settleOverPick(row.pick, over.runs);
    await applySettlement(row.id, row.userId, result, `Over ${overNumber} went for ${over.runs}`);
  }
}

async function settleMatch(match: CricketMatchState) {
  if (!match.winner) return;
  const rows = await prisma.prediction.findMany({
    where: { matchKey: match.key, kind: "MATCH", targetKey: "match", settledAt: null },
  });
  for (const row of rows) {
    const result = settleMatchPick(row.pick, match.winner);
    await applySettlement(row.id, row.userId, result, match.result || result.actual);
  }
}

async function applySettlement(
  predictionId: string,
  userId: string,
  result: { correct: boolean; points: number; actual: string },
  detail: string,
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const boosted = applyBoost(result.points, user.predictionBoost);
  const streak = result.correct ? user.streak + 1 : 0;
  await prisma.prediction.update({
    where: { id: predictionId },
    data: { settledAt: new Date(), correct: result.correct, points: boosted.points, detail },
  });
  await prisma.user.update({
    where: { id: userId },
    data: {
      points: { increment: boosted.points },
      predictionBoost: boosted.boostsLeft,
      streak,
      bestStreak: Math.max(user.bestStreak, streak),
    },
  });
  if (result.correct) {
    await grantScratch(userId, "prediction", predictionId).catch(() => undefined);
    await grantXp(userId, 8).catch(() => undefined);
  }
  await nudgeRank(userId).catch(() => undefined);
  if (streak === 3 || streak === 7) {
    await prisma.user.update({ where: { id: userId }, data: { bonusSpins: { increment: 1 } } });
  }
  await awardBadges(userId, streak);
}

async function awardBadges(userId: string, streak: number) {
  const total = await prisma.prediction.aggregate({ where: { userId, settledAt: { not: null } }, _sum: { points: true }, _count: true });
  const keys: string[] = [];
  if ((total._count || 0) >= 1) keys.push("first_call");
  if (streak >= 3) keys.push("sharpshooter");
  if ((total._sum.points || 0) >= 100) keys.push("century");
  for (const badgeKey of keys) {
    await prisma.badge.create({ data: { userId, badgeKey } }).catch(() => undefined);
  }
}

export async function leaderboard(scope: string, opts: { matchKey?: string; groupId?: string; userId: string }) {
  const dayStart = new Date(`${istDay()}T00:00:00+05:30`);
  const where: {
    settledAt: { gte?: Date; not: null };
    matchKey?: string;
    userId?: { in: string[] };
  } = { settledAt: { not: null } };
  if (scope === "daily") where.settledAt = { not: null, gte: dayStart };
  if (scope === "match" && opts.matchKey) where.matchKey = opts.matchKey;
  if (scope === "group") {
    const groupId = opts.groupId;
    if (!groupId) return [];
    const members = await prisma.groupMember.findMany({ where: { groupId } });
    where.userId = { in: members.map((m) => m.userId) };
  }
  const rows = await prisma.prediction.groupBy({
    by: ["userId"],
    where,
    _sum: { points: true },
    orderBy: { _sum: { points: "desc" } },
    take: 50,
  });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((row, index) => {
    const user = byId.get(row.userId);
    return {
      rank: index + 1,
      userId: row.userId,
      name: user?.username ? `@${user.username}` : user?.firstName || "Player",
      points: row._sum.points || 0,
      you: row.userId === opts.userId,
      look: user ? userCartoon(user) : null,
    };
  });
}
