import { prisma } from "@liveline/db";
import {
  CHEER_EMOJIS,
  fanLoudness,
  istDay,
  istHour,
  MISSIONS,
  nextDailyStreak,
  periodKey,
  rankFor,
  SEASON_KEY,
  SEASON_TIERS,
  scoreGuessPoints,
  shiftIstDay,
  triviaFor,
  type CricketMatchState,
  type MissionEvent,
} from "@liveline/shared";
import { httpError } from "../httpError";
import { redis } from "../redis";
import { getMatch, readUniverse } from "../feed";
import { recordAdEvent, serveSlot } from "./ads";
import { sendTelegramMessage } from "../telegram";

async function sponsorSuffix(userId: string, slot: string, matchKey?: string): Promise<string> {
  const ad = await serveSlot({ userId, slot, matchKey }).catch(() => null);
  if (!ad) return "";
  await recordAdEvent(userId, ad.id, "impression").catch(() => undefined);
  return `\nSponsored · ${ad.headline}`;
}

export async function rollDailyStreak<T extends { id: string; status: string; lastActiveDay: string | null; dailyStreak: number; bestDailyStreak: number; streakFreeze: number }>(user: T): Promise<T> {
  if (user.status !== "ACTIVE") return user;
  const today = istDay();
  const next = nextDailyStreak({
    lastDay: user.lastActiveDay,
    today,
    yesterday: shiftIstDay(today, -1),
    streak: user.dailyStreak,
    freeze: user.streakFreeze,
  });
  if (!next.continued && next.lastDay === user.lastActiveDay) return user;
  if (next.lastDay === user.lastActiveDay && next.streak === user.dailyStreak) return user;
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      dailyStreak: next.streak,
      bestDailyStreak: Math.max(user.bestDailyStreak, next.streak),
      streakFreeze: next.freeze,
      lastActiveDay: next.lastDay,
    },
  });
  if (next.continued) await grantXp(user.id, 4);
  if (next.streak >= 3) await prisma.badge.create({ data: { userId: user.id, badgeKey: "streak_3_days" } }).catch(() => undefined);
  if (next.streak >= 7) {
    const badge = await prisma.badge.create({ data: { userId: user.id, badgeKey: "streak_7_days" } }).then(() => true).catch(() => false);
    if (badge) await prisma.user.update({ where: { id: user.id }, data: { streakFreeze: { increment: 1 } } });
  }
  return { ...user, ...updated } as T;
}

export async function grantXp(userId: string, amount: number) {
  if (amount <= 0) return;
  const user = await prisma.user.update({
    where: { id: userId },
    data: { xp: { increment: amount }, seasonXp: { increment: amount } },
  });
  const rank = rankFor(user.xp);
  if (rank.id !== "gully") {
    await prisma.badge.create({ data: { userId, badgeKey: `rank_${rank.id}` } }).catch(() => undefined);
  }
  return user;
}

export async function bumpMission(userId: string, event: MissionEvent, by = 1) {
  const day = istDay();
  for (const mission of MISSIONS) {
    if (mission.event !== event) continue;
    const key = periodKey(mission.period, day);
    await prisma.missionProgress.upsert({
      where: { userId_missionKey_periodKey: { userId, missionKey: mission.key, periodKey: key } },
      create: { userId, missionKey: mission.key, periodKey: key, progress: by },
      update: { progress: { increment: by } },
    });
  }
}

export async function engagementHome(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const day = istDay();
  const [missions, claims, badges] = await Promise.all([
    prisma.missionProgress.findMany({ where: { userId, periodKey: { in: [day, periodKey("weekly", day)] } } }),
    prisma.seasonClaim.findMany({ where: { userId, seasonKey: SEASON_KEY } }),
    prisma.badge.findMany({ where: { userId }, orderBy: { earnedAt: "desc" } }),
  ]);
  const progress = new Map(missions.map((row) => [row.missionKey, row]));
  const claimed = new Set(claims.map((row) => row.tier));
  return {
    xp: user.xp,
    seasonXp: user.seasonXp,
    rank: rankFor(user.xp),
    dailyStreak: user.dailyStreak,
    streakFreeze: user.streakFreeze,
    fanTeamKey: user.fanTeamKey,
    seasonKey: SEASON_KEY,
    missions: MISSIONS.map((mission) => {
      const row = progress.get(mission.key);
      const value = row?.progress || 0;
      return {
        ...mission,
        progress: value,
        done: value >= mission.target,
        claimed: Boolean(row?.claimed),
      };
    }),
    tiers: SEASON_TIERS.map((tier) => ({
      ...tier,
      unlocked: user.seasonXp >= tier.xp,
      claimed: claimed.has(tier.tier),
    })),
    badges: badges.map((b) => b.badgeKey),
    slots: ["mission", "season_pass", "celebration", "fan_meter", "minigame", "cheer", "nudge"],
  };
}

export async function claimMission(userId: string, missionKey: string) {
  const mission = MISSIONS.find((item) => item.key === missionKey);
  if (!mission) throw httpError(404, "NOT_FOUND");
  const key = periodKey(mission.period, istDay());
  const row = await prisma.missionProgress.findUnique({
    where: { userId_missionKey_periodKey: { userId, missionKey, periodKey: key } },
  });
  if (!row || row.progress < mission.target) throw httpError(409, "INCOMPLETE", "Finish the mission first.");
  if (row.claimed) throw httpError(409, "CLAIMED", "Already claimed.");
  await prisma.missionProgress.update({ where: { id: row.id }, data: { claimed: true } });
  await prisma.user.update({ where: { id: userId }, data: { points: { increment: mission.points } } });
  await grantXp(userId, mission.xp);
  return { ok: true, points: mission.points, xp: mission.xp };
}

export async function claimSeasonTier(userId: string, tier: number) {
  const spec = SEASON_TIERS.find((item) => item.tier === tier);
  if (!spec) throw httpError(404, "NOT_FOUND");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.seasonXp < spec.xp) throw httpError(409, "LOCKED", "Not enough season XP.");
  try {
    await prisma.seasonClaim.create({ data: { userId, seasonKey: SEASON_KEY, tier } });
  } catch {
    throw httpError(409, "CLAIMED", "Already claimed.");
  }
  if (spec.kind === "points" && spec.points) {
    await prisma.user.update({ where: { id: userId }, data: { points: { increment: spec.points } } });
  }
  if (spec.kind === "freeze" && spec.freeze) {
    await prisma.user.update({ where: { id: userId }, data: { streakFreeze: { increment: spec.freeze } } });
  }
  if (spec.kind === "theme" && spec.theme) {
    const themes = new Set(user.unlockedThemes.split(",").filter(Boolean));
    themes.add(spec.theme);
    await prisma.user.update({ where: { id: userId }, data: { unlockedThemes: [...themes].join(",") } });
  }
  if (spec.kind === "badge" && spec.badge) {
    await prisma.badge.create({ data: { userId, badgeKey: spec.badge } }).catch(() => undefined);
  }
  if (spec.kind === "boost") {
    await prisma.user.update({ where: { id: userId }, data: { predictionBoost: { increment: 1 } } });
  }
  return { ok: true, label: spec.label };
}

export async function setFanTeam(userId: string, teamKey: string) {
  const matches = await readUniverse();
  const known = matches.some((match) => match.teams.a.key === teamKey || match.teams.b.key === teamKey);
  if (!known) throw httpError(400, "BAD_TEAM", "Pick a team from the current matches.");
  await prisma.user.update({ where: { id: userId }, data: { fanTeamKey: teamKey } });
  await prisma.badge.create({ data: { userId, badgeKey: "fan_colours" } }).catch(() => undefined);
  return { teamKey };
}

export async function fanMeter(userId: string, matchKey: string) {
  const found = await getMatch(matchKey);
  if (!found) throw httpError(404, "NOT_FOUND");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const { a, b } = found.state.teams;
  const [aFans, bFans, aLoud, bLoud] = await Promise.all([
    prisma.user.count({ where: { fanTeamKey: a.key, status: "ACTIVE" } }),
    prisma.user.count({ where: { fanTeamKey: b.key, status: "ACTIVE" } }),
    redis.get(`ll:loud:${matchKey}:a`),
    redis.get(`ll:loud:${matchKey}:b`),
  ]);
  const loudA = fanLoudness(aFans, Number(aLoud || 0));
  const loudB = fanLoudness(bFans, Number(bLoud || 0));
  const you = user.fanTeamKey === a.key ? "a" : user.fanTeamKey === b.key ? "b" : null;
  return {
    a: loudA,
    b: loudB,
    aFans,
    bFans,
    you,
    teams: { a, b },
  };
}

export async function cheer(userId: string, matchKey: string, emoji: string) {
  if (!(CHEER_EMOJIS as readonly string[]).includes(emoji)) throw httpError(400, "BAD_EMOJI");
  const paced = await redis.set(`ll:cheer:u:${userId}`, "1", "PX", 700, "NX");
  if (!paced) throw httpError(429, "THROTTLED", "Easy. Let the last cheer land.");
  const burst = await redis.incr(`ll:cheer:b:${userId}`);
  if (burst === 1) await redis.expire(`ll:cheer:b:${userId}`, 10);
  if (burst > 8) throw httpError(429, "THROTTLED", "The stand is full. Wait a moment.");
  const found = await getMatch(matchKey);
  if (!found) throw httpError(404, "NOT_FOUND");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  let side: "a" | "b" | null = null;
  if (user.fanTeamKey === found.state.teams.a.key) side = "a";
  if (user.fanTeamKey === found.state.teams.b.key) side = "b";
  if (side) {
    await redis.incr(`ll:loud:${matchKey}:${side}`);
    await redis.expire(`ll:loud:${matchKey}:${side}`, 180);
  }
  const day = istDay();
  const xpKey = `ll:cheerxp:${userId}:${day}`;
  const xpCount = await redis.incr(xpKey);
  if (xpCount === 1) await redis.expire(xpKey, 60 * 60 * 30);
  if (xpCount <= 10) await grantXp(userId, 1);
  await bumpMission(userId, "cheer");
  await redis.publish("ll:live", JSON.stringify({ type: "cheer", key: matchKey, emoji, side, id: `${userId}:${Date.now()}` }));
  return { ok: true, side };
}

export async function playState(userId: string, matchKey: string) {
  const found = await getMatch(matchKey);
  if (!found) throw httpError(404, "NOT_FOUND");
  const view = found.view;
  const mine = await prisma.playEntry.findMany({ where: { userId, matchKey } });
  const breakInfo = view.break;
  const triviaSeed = breakInfo ? `${matchKey}:${breakInfo.kind}:${breakInfo.until}` : "";
  const trivia = breakInfo ? triviaFor(triviaSeed) : null;
  const triviaKey = trivia ? `${breakInfo!.kind}:${breakInfo!.until}` : "";
  const oversKey = `inn:${view.overs10?.innings ?? found.state.current}`;
  return {
    trivia: trivia
      ? {
          targetKey: triviaKey,
          prompt: trivia.prompt,
          promptHi: trivia.promptHi,
          options: trivia.options,
          mine: mine.find((row) => row.kind === "trivia" && row.targetKey === triviaKey) || null,
        }
      : null,
    overs10: view.overs10
      ? {
          ...view.overs10,
          targetKey: oversKey,
          mine: mine.find((row) => row.kind === "overs10" && row.targetKey === oversKey) || null,
        }
      : null,
  };
}

export async function submitPlay(userId: string, matchKey: string, kind: "trivia" | "overs10", pick: string) {
  const state = await playState(userId, matchKey);
  if (kind === "trivia") {
    if (!state.trivia) throw httpError(409, "CLOSED", "Trivia opens on an innings break or strategic timeout.");
    if (state.trivia.mine) throw httpError(409, "ALREADY", "You already answered.");
    const q = triviaFor(`${matchKey}:${state.trivia.targetKey}`);
    const index = state.trivia.options.indexOf(pick);
    const correct = index === q.answer;
    const points = correct ? 15 : 0;
    const row = await prisma.playEntry.create({
      data: {
        userId,
        matchKey,
        kind,
        targetKey: state.trivia.targetKey,
        pick,
        points,
        settledAt: new Date(),
      },
    });
    if (points) await prisma.user.update({ where: { id: userId }, data: { points: { increment: points } } });
    await grantXp(userId, correct ? 12 : 3);
    await bumpMission(userId, "play");
    return { correct, points, answer: state.trivia.options[q.answer], id: row.id };
  }
  if (!state.overs10?.open) throw httpError(409, "CLOSED", "The 10-over guess is closed.");
  if (state.overs10.mine) throw httpError(409, "ALREADY", "Guess locked.");
  const guess = Number(pick);
  if (!Number.isInteger(guess) || guess < 20 || guess > 220) throw httpError(400, "BAD_PICK", "Guess a score between 20 and 220.");
  const row = await prisma.playEntry.create({
    data: { userId, matchKey, kind, targetKey: state.overs10.targetKey, pick: String(guess) },
  });
  await bumpMission(userId, "play");
  await grantXp(userId, 3);
  return { locked: true, id: row.id };
}

export async function settleOversGuess(match: CricketMatchState) {
  const inn = match.innings[match.current];
  if (!inn || inn.legalBalls < 60) return;
  const actual = inn.overs.slice(0, 10).reduce((sum, over) => sum + over.runs, 0);
  const rows = await prisma.playEntry.findMany({
    where: { matchKey: match.key, kind: "overs10", targetKey: `inn:${match.current}`, settledAt: null },
  });
  for (const row of rows) {
    const points = scoreGuessPoints(Number(row.pick), actual);
    await prisma.playEntry.update({ where: { id: row.id }, data: { points, settledAt: new Date() } });
    if (points) {
      await prisma.user.update({ where: { id: row.userId }, data: { points: { increment: points } } });
      await grantXp(row.userId, points >= 25 ? 15 : 8);
    }
  }
}

export async function nudgeRank(userId: string) {
  const dayStart = new Date(`${istDay()}T00:00:00+05:30`);
  const rows = await prisma.prediction.groupBy({
    by: ["userId"],
    where: { settledAt: { not: null, gte: dayStart } },
    _sum: { points: true },
    orderBy: { _sum: { points: "desc" } },
    take: 50,
  });
  const rank = rows.findIndex((row) => row.userId === userId) + 1;
  if (rank <= 0) return;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.isDemo) return;
  const previous = user.lastBoardRank;
  if (previous != null && rank >= previous) {
    if (previous !== rank) await prisma.user.update({ where: { id: userId }, data: { lastBoardRank: rank } });
    return;
  }
  await prisma.user.update({ where: { id: userId }, data: { lastBoardRank: rank } });
  if (previous == null) return;
  const dedupeKey = `rank:${userId}:${istDay()}:${rank}`;
  try {
    await prisma.notification.create({
      data: { userId, kind: "rank", title: "Leaderboard", body: `You moved up to #${rank}`, dedupeKey },
    });
  } catch {
    return;
  }
  const sponsor = await sponsorSuffix(userId, "nudge");
  const text = user.languageCode === "hi" ? `आप #${rank} पर पहुँच गए।` : `You moved up to #${rank}.`;
  await sendTelegramMessage(user.telegramId, `📈 ${text}${sponsor}`).catch(() => undefined);
}

export async function nudgePredictionWindow(match: CricketMatchState, overToken: string) {
  const predictors = await prisma.prediction.findMany({
    where: { matchKey: match.key },
    select: { userId: true },
    distinct: ["userId"],
    take: 200,
  });
  const fans = await prisma.favorite.findMany({
    where: { kind: "team", refKey: { in: [match.teams.a.key, match.teams.b.key] } },
    select: { userId: true },
    take: 200,
  });
  const ids = [...new Set([...predictors, ...fans].map((row) => row.userId))].slice(0, 250);
  if (!ids.length) return;
  const users = await prisma.user.findMany({ where: { id: { in: ids }, status: "ACTIVE", isDemo: false } });
  for (const user of users) {
    const dedupeKey = `predwin:${user.id}:${match.key}:${overToken}`;
    try {
      await prisma.notification.create({
        data: {
          userId: user.id,
          kind: "prediction",
          title: match.name,
          body: "Prediction window open!",
          matchKey: match.key,
          dedupeKey,
        },
      });
    } catch {
      continue;
    }
    const sponsor = await sponsorSuffix(user.id, "nudge", match.key);
    const line = user.languageCode === "hi" ? "अनुमान की खिड़की खुली है!" : "Prediction window open!";
    await sendTelegramMessage(user.telegramId, `🎯 <b>${match.teams.a.code} vs ${match.teams.b.code}</b>\n${line}${sponsor}`).catch(() => undefined);
  }
}

export async function maybeStreakNudges() {
  if (istHour() < 22) return;
  const today = istDay();
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE", isDemo: false, dailyStreak: { gt: 0 }, NOT: { lastActiveDay: today } },
    take: 400,
  });
  for (const user of users) {
    const dedupeKey = `streakwarn:${user.id}:${today}`;
    const body = user.streakFreeze > 0
      ? "Your streak ends in 2h. A freeze is ready if you miss today."
      : "Your streak ends in 2h.";
    try {
      await prisma.notification.create({
        data: { userId: user.id, kind: "streak", title: "Streak", body, dedupeKey },
      });
    } catch {
      continue;
    }
    const sponsor = await sponsorSuffix(user.id, "nudge");
    const text = user.languageCode === "hi" ? "आपकी स्ट्रीक 2 घंटे में खत्म होगी।" : body;
    await sendTelegramMessage(user.telegramId, `🔥 ${text}${sponsor}`).catch(() => undefined);
  }
}

export { shiftIstDay };
