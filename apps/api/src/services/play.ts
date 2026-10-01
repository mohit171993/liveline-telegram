import { prisma } from "@liveline/db";
import {
  CHIP_KINDS,
  DANMAKU_GAP_MS,
  LEAGUE_TIERS,
  PACKS_PER_DAY,
  PIN_EDIT_GAP_MS,
  STICKERS,
  VOTE_CATEGORIES,
  applyLeagueMove,
  dailyPuzzles,
  danmakuOk,
  fanXiTally,
  gradePuzzle,
  istDay,
  leagueName,
  leagueOutcome,
  liveScoreCard,
  nextFriendStreak,
  resultGrid,
  squadCode,
  statsPick,
  stickerPull,
  swapOk,
  ticketWindow,
  validXi,
  voteIsOpen,
  type ChipKind,
} from "@liveline/shared";
import { env, telegramDryRun } from "../env";
import { httpError } from "../httpError";
import { redis } from "../redis";
import { getMatch, readUniverse } from "../feed";
import { editTelegramMessage, sendTelegramMessage } from "../telegram";
import { serveSlot } from "./ads";

function publicPuzzle(day: string) {
  return dailyPuzzles(day).map(({ answer: _answer, ...rest }) => rest);
}

export async function ensureChips(userId: string, seriesKey: string) {
  for (const kind of CHIP_KINDS) {
    await prisma.seriesChip.upsert({
      where: { userId_seriesKey_kind: { userId, seriesKey, kind } },
      update: {},
      create: { userId, seriesKey, kind },
    });
  }
  return prisma.seriesChip.findMany({ where: { userId, seriesKey } });
}

export async function chipInventory(userId: string, seriesKey: string) {
  const chips = await ensureChips(userId, seriesKey);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    seriesKey,
    chips,
    savers: user.streakSavers,
    doubleDown: user.doubleDown,
    predStreak: user.predStreak,
    bestPredStreak: user.bestPredStreak,
    note: "Earned only. Not for sale, not transferable, no Stars.",
  };
}

export async function takeChip(userId: string, seriesKey: string, kind: string): Promise<boolean> {
  if (kind === "doubledown") {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.doubleDown < 1) return false;
    return true;
  }
  if (!CHIP_KINDS.includes(kind as ChipKind)) return false;
  const row = await prisma.seriesChip.findUnique({
    where: { userId_seriesKey_kind: { userId, seriesKey, kind } },
  });
  return Boolean(row && !row.used);
}

export async function consumeChip(userId: string, seriesKey: string, kind: string) {
  if (!kind || kind === "freehit" || kind === "doubledown") return;
  await prisma.seriesChip.updateMany({
    where: { userId, seriesKey, kind, used: false },
    data: { used: true },
  });
}

export async function useFreeHit(userId: string, seriesKey: string, matchKey: string, kind: string, targetKey: string) {
  const owned = await prisma.seriesChip.findUnique({
    where: { userId_seriesKey_kind: { userId, seriesKey, kind: "freehit" } },
  });
  if (!owned || owned.used) return false;
  const existing = await prisma.prediction.findUnique({
    where: { userId_matchKey_kind_targetKey: { userId, matchKey, kind, targetKey } },
  });
  if (!existing || existing.settledAt) return false;
  await prisma.prediction.delete({ where: { id: existing.id } });
  await prisma.seriesChip.update({ where: { id: owned.id }, data: { used: true } });
  return true;
}

export async function addSquadPoints(userId: string, points: number) {
  if (points <= 0) return;
  const links = await prisma.groupMember.findMany({ where: { userId } });
  for (const link of links) {
    await prisma.groupChat.update({ where: { id: link.groupId }, data: { points: { increment: points } } });
  }
  await prisma.user.update({
    where: { id: userId },
    data: { leaguePoints: { increment: points }, leagueWeek: isoWeek(istDay()) },
  });
}

function isoWeek(day: string): string {
  const date = new Date(`${day}T12:00:00+05:30`);
  const target = new Date(date.valueOf());
  const dayNr = (date.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function ensureFriendCode(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.friendCode) return user.friendCode;
  const code = `LL${user.telegramId.slice(-6)}`;
  await prisma.user.update({ where: { id: userId }, data: { friendCode: code } }).catch(() => undefined);
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).friendCode || code;
}

export async function bumpFriendStreaks(userId: string) {
  const today = istDay();
  const links = await prisma.friendLink.findMany({ where: { OR: [{ userId }, { friendId: userId }] } });
  for (const link of links) {
    const otherId = link.userId === userId ? link.friendId : link.userId;
    const other = await prisma.user.findUnique({ where: { id: otherId } });
    if (!other || other.lastActiveDay !== today) continue;
    const streak = nextFriendStreak(link.lastDay || null, today, link.streak);
    await prisma.friendLink.update({
      where: { userId_friendId: { userId: link.userId, friendId: link.friendId } },
      data: { streak, lastDay: today },
    });
  }
}

export async function linkFriend(userId: string, code: string) {
  const friend = await prisma.user.findUnique({ where: { friendCode: code.trim() } });
  if (!friend || friend.id === userId) throw httpError(404, "NO_FRIEND", "That friend code is not on LiveLine.");
  const [a, b] = [userId, friend.id].sort();
  const row = await prisma.friendLink.upsert({
    where: { userId_friendId: { userId: a, friendId: b } },
    update: {},
    create: { userId: a, friendId: b },
  });
  return { friend: friend.firstName || friend.username || "Friend", streak: row.streak };
}

export async function upsertSquad(chatId: string, title: string, kind: "group" | "channel") {
  const code = squadCode(chatId);
  return prisma.groupChat.upsert({
    where: { id: chatId },
    update: { title, kind, referralCode: code },
    create: { id: chatId, title, kind, referralCode: code },
  });
}

export async function joinSquad(userId: string, code: string) {
  const squad = await prisma.groupChat.findUnique({ where: { referralCode: code.trim() } });
  if (!squad) throw httpError(404, "NO_SQUAD");
  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId: squad.id, userId } },
    update: {},
    create: { groupId: squad.id, userId },
  });
  return squad;
}

export async function squadBoard(userId: string) {
  const mine = await prisma.groupMember.findMany({ where: { userId }, include: { group: true } });
  const rows = await prisma.groupChat.findMany({ orderBy: { points: "desc" }, take: 20 });
  return {
    yours: mine.map((m) => ({ id: m.group.id, title: m.group.title, points: m.group.points, code: m.group.referralCode, kind: m.group.kind })),
    rows: rows.map((g, i) => ({ rank: i + 1, id: g.id, title: g.title || "Squad", points: g.points, kind: g.kind, you: mine.some((m) => m.groupId === g.id) })),
  };
}

export async function createSquad(userId: string, title: string) {
  const chatId = `sq_${userId.slice(0, 8)}_${title.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "xi"}`;
  const squad = await upsertSquad(chatId, title.slice(0, 40), "group");
  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId: squad.id, userId } },
    update: {},
    create: { groupId: squad.id, userId },
  });
  return squad;
}

function lineFor(view: { status: string; teams: { a: { code: string }; b: { code: string } }; live: { batting: "a" | "b"; runs: number; wickets: number; overs: string; need: string | null } | null; result?: string; scoreline: { a: string; b: string } }) {
  if (view.live) return `${view.teams[view.live.batting].code} ${view.live.runs}/${view.live.wickets} (${view.live.overs})`;
  if (view.result) return view.result;
  return `${view.teams.a.code} ${view.scoreline.a} · ${view.teams.b.code} ${view.scoreline.b}`;
}

export async function scoreText(matchKey: string, userId?: string) {
  const found = await getMatch(matchKey);
  if (!found) throw httpError(404, "NOT_FOUND");
  const sponsor = userId ? await serveSlot({ userId, slot: "live_pin", matchKey }).catch(() => null) : null;
  return liveScoreCard({
    name: found.view.name,
    status: found.view.status,
    line: lineFor(found.view),
    need: found.view.live?.need,
    sponsor: sponsor?.headline,
  });
}

export async function pinLive(chatId: string, matchKey: string) {
  const text = await scoreText(matchKey);
  let messageId = Math.abs(Number(chatId.replace(/\D/g, "").slice(-6)) || 1);
  if (telegramDryRun()) {
    await prisma.outboundMessage.create({ data: { chatId, kind: "pin", payload: JSON.stringify({ text, matchKey }) } });
  } else {
    const res = await fetch(`https://api.telegram.org/bot${env.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    const data = (await res.json()) as { ok?: boolean; result?: { message_id?: number } };
    if (data.result?.message_id) messageId = data.result.message_id;
    await fetch(`https://api.telegram.org/bot${env.botToken}/pinChatMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, disable_notification: true }),
    }).catch(() => undefined);
  }
  const row = await prisma.livePin.upsert({
    where: { chatId },
    update: { matchKey, messageId },
    create: { chatId, matchKey, messageId },
  });
  return { ...row, text };
}

export async function syncLivePins(matchKey: string) {
  const pins = await prisma.livePin.findMany({ where: { matchKey } });
  if (!pins.length) return;
  const text = await scoreText(matchKey).catch(() => "");
  if (!text) return;
  for (const pin of pins) {
    const gate = await redis.set(`ll:pinedit:${pin.chatId}`, "1", "PX", PIN_EDIT_GAP_MS, "NX");
    if (!gate) continue;
    await editTelegramMessage(pin.chatId, pin.messageId, text);
    await prisma.livePin.update({ where: { chatId: pin.chatId }, data: { updatedAt: new Date() } });
  }
}

export async function inlineCards(query: string) {
  const matches = await readUniverse();
  const q = query.trim().toLowerCase();
  return matches
    .filter((m) => !q || m.name.toLowerCase().includes(q) || m.teams.a.code.toLowerCase().includes(q) || m.teams.b.code.toLowerCase().includes(q))
    .slice(0, 6);
}

export function playersFrom(state: { innings: { batters: { id: string; runs: number; fours: number; sixes: number }[]; bowlers: { id: string; runs: number; wickets: number }[] }[]; squads: { a: { id: string; name: string }[]; b: { id: string; name: string }[] } }) {
  const map = new Map<string, { id: string; name: string; runs: number; fours: number; sixes: number; wickets: number }>();
  for (const side of ["a", "b"] as const) {
    for (const p of state.squads[side]) map.set(p.id, { id: p.id, name: p.name, runs: 0, fours: 0, sixes: 0, wickets: 0 });
  }
  for (const inn of state.innings) {
    for (const b of inn.batters) {
      const row = map.get(b.id) || { id: b.id, name: b.id, runs: 0, fours: 0, sixes: 0, wickets: 0 };
      row.runs += b.runs;
      row.fours += b.fours;
      row.sixes += b.sixes;
      map.set(b.id, row);
    }
    for (const b of inn.bowlers) {
      const row = map.get(b.id) || { id: b.id, name: b.id, runs: 0, fours: 0, sixes: 0, wickets: 0 };
      row.wickets += b.wickets;
      map.set(b.id, row);
    }
  }
  return [...map.values()];
}

export async function voteState(userId: string, matchKey: string) {
  const found = await getMatch(matchKey);
  if (!found) throw httpError(404, "NOT_FOUND");
  const legal = found.state.innings[found.state.current]?.legalBalls || found.state.innings.at(-1)?.legalBalls || 0;
  const open = voteIsOpen(found.state.status, legal, found.state.maxOvers);
  const players = playersFrom(found.state);
  const mine = await prisma.fanVote.findMany({ where: { userId, matchKey } });
  const tallies = await prisma.fanVote.groupBy({ by: ["category", "playerId"], where: { matchKey }, _count: true });
  const reveal = found.state.status === "completed";
  const categories = VOTE_CATEGORIES.map((cat) => {
    const statsId = statsPick(players, cat.id);
    const bucket = tallies.filter((t) => t.category === cat.id).sort((a, b) => b._count - a._count);
    const fanId = bucket[0]?.playerId || "";
    return {
      ...cat,
      yours: mine.find((m) => m.category === cat.id)?.playerId || null,
      fan: reveal ? players.find((p) => p.id === fanId)?.name || "—" : null,
      stats: reveal ? players.find((p) => p.id === statsId)?.name || "—" : null,
      agree: reveal ? fanId === statsId : null,
    };
  });
  return { open, reveal, players: players.map((p) => ({ id: p.id, name: p.name })), categories };
}

export async function castVote(userId: string, matchKey: string, category: string, playerId: string) {
  const state = await voteState(userId, matchKey);
  if (!state.open) throw httpError(409, "VOTE_CLOSED", "The fan vote opens late in the match.");
  if (!VOTE_CATEGORIES.some((c) => c.id === category)) throw httpError(400, "BAD_CATEGORY");
  if (!state.players.some((p) => p.id === playerId)) throw httpError(400, "BAD_PLAYER");
  await prisma.fanVote.upsert({
    where: { matchKey_userId_category: { matchKey, userId, category } },
    update: { playerId },
    create: { matchKey, userId, category, playerId },
  });
  return voteState(userId, matchKey);
}

export async function alertVoteOpen(matchKey: string, status: string, legalBalls: number, maxOvers: number, title: string) {
  if (!voteIsOpen(status, legalBalls, maxOvers)) return;
  const gate = await redis.set(`ll:votealert:${matchKey}`, "1", "EX", 60 * 60 * 12, "NX");
  if (!gate) return;
  const users = await prisma.user.findMany({ where: { status: "ACTIVE", isDemo: false }, select: { id: true, telegramId: true }, take: 200 });
  const text = `🏆 Fan vote is open · ${title}\nPick a player of the match. Points only.`;
  for (const user of users) {
    await prisma.notification.create({
      data: { userId: user.id, kind: "vote", title: "Fan vote", body: text, matchKey, dedupeKey: `vote:${matchKey}:${user.id}` },
    }).catch(() => undefined);
    await sendTelegramMessage(user.telegramId, text).catch(() => undefined);
  }
}

export function fansCardSvg(title: string, rows: { label: string; fan: string; stats: string; agree: boolean | null }[]): string {
  const body = rows
    .map((row, i) => {
      const y = 86 + i * 48;
      return `<text x="24" y="${y}" fill="#f5f7fb" font-size="16" font-family="sans-serif">${row.label}</text><text x="24" y="${y + 18}" fill="#e7ff4d" font-size="13" font-family="sans-serif">Fans ${row.fan} · Stats ${row.stats} ${row.agree ? "🤝" : ""}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360" viewBox="0 0 720 360"><rect width="720" height="360" rx="28" fill="#10141c"/><text x="24" y="48" fill="#e7ff4d" font-size="28" font-family="sans-serif">Fans vs stats</text><text x="24" y="72" fill="#8e99b0" font-size="14" font-family="sans-serif">${title}</text>${body}</svg>`;
}

export async function postDanmaku(userId: string, matchKey: string, text: string) {
  const verdict = danmakuOk(text);
  if (verdict !== "ok") throw httpError(400, verdict.toUpperCase(), "Keep it short and about the cricket.");
  const gate = await redis.set(`ll:danmaku:${userId}`, "1", "PX", DANMAKU_GAP_MS, "NX");
  if (!gate) throw httpError(429, "THROTTLED", "Wait a moment before the next comment.");
  const note = await prisma.danmakuNote.create({ data: { userId, matchKey, body: text.trim() } });
  await redis.publish("ll:live", JSON.stringify({ type: "danmaku", key: matchKey, id: note.id, body: note.body }));
  return { id: note.id, body: note.body };
}

export async function listDanmaku(matchKey: string) {
  const rows = await prisma.danmakuNote.findMany({ where: { matchKey }, orderBy: { createdAt: "desc" }, take: 20 });
  return rows.reverse().map((r) => ({ id: r.id, body: r.body }));
}

export async function puzzleHome(userId: string) {
  const day = istDay();
  const attempts = await prisma.puzzleAttempt.findMany({ where: { userId, day } });
  const marks = ["clue", "path", "rank", "link"].map((key) => {
    const row = attempts.find((a) => a.puzzleKey === key);
    if (!row) return "open" as const;
    return row.correct ? "hit" as const : "miss" as const;
  });
  return { day, puzzles: publicPuzzle(day), grid: resultGrid(marks), attempts: attempts.map((a) => ({ key: a.puzzleKey, correct: a.correct, points: a.points })) };
}

export async function answerPuzzle(userId: string, key: string, answer: string) {
  const day = istDay();
  const puzzle = dailyPuzzles(day).find((p) => p.key === key);
  if (!puzzle) throw httpError(400, "BAD_PUZZLE");
  const graded = gradePuzzle(puzzle, answer);
  try {
    await prisma.puzzleAttempt.create({
      data: { userId, day, puzzleKey: key, answer: answer.slice(0, 200), correct: graded.correct, points: graded.points },
    });
  } catch {
    throw httpError(409, "ALREADY", "That puzzle is already answered today.");
  }
  if (graded.points) {
    await prisma.user.update({ where: { id: userId }, data: { points: { increment: graded.points }, leaguePoints: { increment: graded.points } } });
  }
  const done = await prisma.puzzleAttempt.count({ where: { userId, day, correct: true } });
  if (done >= 4) {
    await prisma.user.updateMany({ where: { id: userId, streakSavers: { lt: 3 } }, data: { streakSavers: { increment: 1 } } });
  }
  return puzzleHome(userId);
}

export async function albumHome(userId: string) {
  const day = istDay();
  const opened = await prisma.stickerPackOpen.count({ where: { userId, day } });
  const held = await prisma.stickerHolding.findMany({ where: { userId } });
  const sets = [...new Map(STICKERS.map((s) => [s.set, s.team])).entries()].map(([set, team]) => {
    const cards = STICKERS.filter((s) => s.set === set);
    const have = cards.filter((c) => held.some((h) => h.stickerKey === c.id)).length;
    return { set, team, have, total: cards.length, complete: have === cards.length };
  });
  return {
    packsLeft: Math.max(0, PACKS_PER_DAY - opened),
    stickers: STICKERS.map((s) => ({ ...s, count: held.find((h) => h.stickerKey === s.id)?.count || 0 })),
    sets,
    note: "Two free packs a day. No purchase, no Stars. Swap a duplicate with a friend.",
  };
}

export async function openPack(userId: string) {
  const day = istDay();
  const opened = await prisma.stickerPackOpen.count({ where: { userId, day } });
  if (opened >= PACKS_PER_DAY) throw httpError(409, "NO_PACK", "Two free packs a day. Come back tomorrow.");
  const pull = stickerPull(`${userId}:${day}:${opened}`);
  await prisma.stickerPackOpen.create({ data: { userId, day } });
  for (const stickerKey of pull) {
    await prisma.stickerHolding.upsert({
      where: { userId_stickerKey: { userId, stickerKey } },
      update: { count: { increment: 1 } },
      create: { userId, stickerKey, count: 1 },
    });
  }
  return { pull: pull.map((id) => STICKERS.find((s) => s.id === id)), ...(await albumHome(userId)) };
}

export async function swapSticker(userId: string, offer: string, want: string, friendCode: string) {
  if (offer === want) throw httpError(400, "SAME");
  const friend = await prisma.user.findUnique({ where: { friendCode } });
  if (!friend || friend.id === userId) throw httpError(404, "NO_FRIEND");
  const mine = await prisma.stickerHolding.findUnique({ where: { userId_stickerKey: { userId, stickerKey: offer } } });
  const theirs = await prisma.stickerHolding.findUnique({ where: { userId_stickerKey: { userId: friend.id, stickerKey: want } } });
  if (!swapOk(mine?.count || 0, theirs?.count || 0)) {
    throw httpError(409, "NEED_DUPLICATE", "A swap needs a duplicate on both sides. Packs cannot be transferred.");
  }
  await prisma.$transaction([
    prisma.stickerHolding.update({ where: { userId_stickerKey: { userId, stickerKey: offer } }, data: { count: { decrement: 1 } } }),
    prisma.stickerHolding.update({ where: { userId_stickerKey: { userId: friend.id, stickerKey: want } }, data: { count: { decrement: 1 } } }),
    prisma.stickerHolding.upsert({
      where: { userId_stickerKey: { userId, stickerKey: want } },
      update: { count: { increment: 1 } },
      create: { userId, stickerKey: want, count: 1 },
    }),
    prisma.stickerHolding.upsert({
      where: { userId_stickerKey: { userId: friend.id, stickerKey: offer } },
      update: { count: { increment: 1 } },
      create: { userId: friend.id, stickerKey: offer, count: 1 },
    }),
  ]);
  return albumHome(userId);
}

export async function claimTicket(userId: string, matchKey: string, teamKey: string) {
  const found = await getMatch(matchKey);
  if (!found) throw httpError(404, "NOT_FOUND");
  const window = ticketWindow(Date.now(), found.state.startAt);
  if (window === "early") throw httpError(409, "TOO_EARLY", "The gate opens 30 minutes before the start.");
  if (window === "closed") throw httpError(409, "CLOSED", "That gate has shut.");
  if (teamKey !== found.state.teams.a.key && teamKey !== found.state.teams.b.key) throw httpError(400, "BAD_TEAM");
  const badge = teamKey === found.state.teams.a.key ? found.view.teams.a.flag : found.view.teams.b.flag;
  const row = await prisma.matchTicket.upsert({
    where: { userId_matchKey: { userId, matchKey } },
    update: {},
    create: { userId, matchKey, teamKey, badge },
  });
  return row;
}

export async function listTickets(userId: string) {
  const rows = await prisma.matchTicket.findMany({ where: { userId }, orderBy: { claimedAt: "desc" } });
  const matches = await readUniverse();
  return rows.map((row) => {
    const match = matches.find((m) => m.key === row.matchKey);
    const stub = match?.status === "completed";
    return { ...row, stub: row.stub || Boolean(stub), name: match?.name || row.matchKey, window: match ? ticketWindow(Date.now(), match.startAt) : "closed" };
  });
}

export async function markStubs() {
  const open = await prisma.matchTicket.findMany({ where: { stub: false } });
  const matches = await readUniverse();
  for (const ticket of open) {
    const match = matches.find((m) => m.key === ticket.matchKey);
    if (match?.status === "completed") await prisma.matchTicket.update({ where: { userId_matchKey: { userId: ticket.userId, matchKey: ticket.matchKey } }, data: { stub: true } });
  }
}

export async function saveFanXi(userId: string, matchKey: string, playerIds: string[]) {
  if (!validXi(playerIds)) throw httpError(400, "NEED_11", "Pick 11 different players.");
  const found = await getMatch(matchKey);
  if (!found) throw httpError(404, "NOT_FOUND");
  const allowed = new Set([...found.state.squads.a, ...found.state.squads.b].map((p) => p.id));
  if (playerIds.some((id) => !allowed.has(id))) throw httpError(400, "BAD_PLAYER");
  await prisma.fanXi.upsert({
    where: { matchKey_userId: { matchKey, userId } },
    update: { playerIds: playerIds.join(",") },
    create: { matchKey, userId, playerIds: playerIds.join(",") },
  });
  return fanXiBoard(matchKey);
}

export async function fanXiBoard(matchKey: string) {
  const rows = await prisma.fanXi.findMany({ where: { matchKey } });
  return { picks: rows.length, xi: fanXiTally(rows.map((r) => r.playerIds.split(","))) };
}

export async function leagueHome(userId: string) {
  const you = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const peers = await prisma.user.findMany({
    where: { leagueTier: you.leagueTier, status: "ACTIVE" },
    orderBy: { leaguePoints: "desc" },
    take: 30,
  });
  const rank = Math.max(1, peers.findIndex((p) => p.id === userId) + 1);
  const outcome = leagueOutcome(rank || peers.length, peers.length);
  return {
    tier: you.leagueTier,
    name: leagueName(you.leagueTier),
    tiers: LEAGUE_TIERS,
    points: you.leaguePoints,
    rank,
    outcome,
    next: leagueName(applyLeagueMove(you.leagueTier, outcome)),
    rows: peers.slice(0, 10).map((p, i) => ({ rank: i + 1, name: p.username ? `@${p.username}` : p.firstName || "Player", points: p.leaguePoints, you: p.id === userId })),
  };
}

export async function settleLeagueWeek() {
  const week = isoWeek(istDay());
  const last = await redis.get("ll:league:week");
  if (last === week) return;
  if (last) {
    for (let tier = 1; tier <= 10; tier++) {
      const peers = await prisma.user.findMany({ where: { leagueTier: tier, leaguePoints: { gt: 0 } }, orderBy: { leaguePoints: "desc" } });
      for (let index = 0; index < peers.length; index++) {
        const peer = peers[index];
        const outcome = leagueOutcome(index + 1, peers.length);
        const next = applyLeagueMove(peer.leagueTier, outcome);
        await prisma.user.update({ where: { id: peer.id }, data: { leagueTier: next, leaguePoints: 0, leagueWeek: week } });
      }
    }
  }
  await redis.set("ll:league:week", week);
}

export async function playHome(userId: string, seriesKey: string) {
  const [chips, puzzle, album, tickets, squads, league, code, friends] = await Promise.all([
    chipInventory(userId, seriesKey),
    puzzleHome(userId),
    albumHome(userId),
    listTickets(userId),
    squadBoard(userId),
    leagueHome(userId),
    ensureFriendCode(userId),
    prisma.friendLink.findMany({ where: { OR: [{ userId }, { friendId: userId }] } }),
  ]);
  return { chips, puzzle, album, tickets, squads, league, friendCode: code, friendStreak: friends.reduce((m, f) => Math.max(m, f.streak), 0) };
}
