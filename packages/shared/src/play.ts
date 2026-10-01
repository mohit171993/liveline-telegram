import { containsBetting } from "./policy";
import { containsProfanity } from "./profanity";
import { shiftIstDay } from "./engage";

/** Minimum gap between editMessageText calls for one pinned live score. */
export const PIN_EDIT_GAP_MS = 5000;
export const DANMAKU_GAP_MS = 8000;
export const DANMAKU_MAX = 42;
export const PACKS_PER_DAY = 2;
export const TICKET_LEAD_MS = 30 * 60_000;

export const SPONSOR_CATEGORIES = [
  "audio",
  "fmcg",
  "beverage",
  "apparel",
  "telecom",
  "auto",
  "finance",
  "retail",
  "other",
] as const;

export const BANNED_SPONSOR_CATEGORIES = [
  "betting",
  "gaming",
  "rmg",
  "fantasy_cash",
  "bookmaker",
  "stars",
] as const;

export function sponsorAllowed(category: string, ...copy: string[]): { ok: boolean; reason?: string } {
  const cat = (category || "").trim().toLowerCase();
  if ((BANNED_SPONSOR_CATEGORIES as readonly string[]).includes(cat)) {
    return { ok: false, reason: "Betting, real-money gaming, and Stars prizes cannot sponsor LiveLine." };
  }
  if (!(SPONSOR_CATEGORIES as readonly string[]).includes(cat)) {
    return { ok: false, reason: "Pick a sponsor category. Betting brands are not accepted." };
  }
  if (containsBetting(copy.filter(Boolean).join(" "))) {
    return { ok: false, reason: "That copy mentions betting, odds, or real-money gaming." };
  }
  return { ok: true };
}

/** Birth year only. 18+ is adult. 13–17 needs parental consent (DPDP). Under 13 is refused. */
export function ageFromBirthYear(birthYear: number, parentConsent: boolean, nowYear: number): "adult" | "consent" | "denied" {
  if (!Number.isInteger(birthYear) || birthYear < 1920 || birthYear > nowYear) return "denied";
  const age = nowYear - birthYear;
  if (age >= 18) return "adult";
  if (age >= 13 && parentConsent) return "consent";
  return "denied";
}

export function ticketWindow(now: number, startAt: number): "early" | "open" | "closed" {
  if (now < startAt - TICKET_LEAD_MS) return "early";
  if (now < startAt) return "open";
  return "closed";
}

export function liveScoreCard(input: { name: string; status: string; line: string; need?: string | null; sponsor?: string | null }): string {
  const head = input.status === "live" ? "🔴 LIVE" : input.status === "upcoming" ? "🕐 Upcoming" : "✅ Result";
  const lines = [`${head} · ${input.name}`, input.line];
  if (input.need) lines.push(input.need);
  lines.push("Points only · no betting");
  if (input.sponsor) lines.push(`Sponsored · ${input.sponsor}`);
  return lines.join("\n");
}

export function squadCode(chatId: string): string {
  const digits = chatId.replace(/\D/g, "") || "0";
  const n = Number(digits.slice(-10));
  return `sq${(Number.isFinite(n) ? n : 0).toString(36)}`;
}

export const CHIP_KINDS = ["triple", "freehit", "boost"] as const;
export type ChipKind = (typeof CHIP_KINDS)[number];

export function chipMultiplier(chip: string | null | undefined): number {
  if (chip === "triple") return 3;
  if (chip === "boost" || chip === "doubledown") return 2;
  return 1;
}

export function settleWithKit(input: {
  correct: boolean;
  points: number;
  chip: string | null;
  savers: number;
  predStreak: number;
}): { points: number; predStreak: number; saverUsed: boolean; chipConsumed: boolean } {
  const points = input.correct ? input.points * chipMultiplier(input.chip) : 0;
  let predStreak = input.predStreak;
  let saverUsed = false;
  if (input.correct) predStreak += 1;
  else if (input.savers > 0 && input.predStreak > 0) saverUsed = true;
  else predStreak = 0;
  return {
    points,
    predStreak,
    saverUsed,
    chipConsumed: Boolean(input.chip && input.chip !== "freehit"),
  };
}

export function luckIndex(recent: string[]): { score: number; emoji: string; label: string; labelHi: string } {
  let score = 50;
  for (const token of recent.slice(-12)) {
    if (token === "6") score += 8;
    else if (token === "4") score += 5;
    else if (token === "W") score -= 12;
    else if (token === "0" || token === "·" || token === ".") score -= 2;
  }
  score = Math.max(0, Math.min(100, score));
  if (score >= 70) return { score, emoji: "🍀", label: "Riding luck", labelHi: "किस्मत साथ है" };
  if (score <= 35) return { score, emoji: "😬", label: "Luck is thin", labelHi: "किस्मत कमज़ोर" };
  return { score, emoji: "⚖️", label: "Even luck", labelHi: "किस्मत बराबर" };
}

export function nextOverForecast(crr: number, wickets: number): { runs: number; low: number; high: number; wicketChance: number } {
  const base = Number.isFinite(crr) && crr > 0 ? crr : 6;
  const mid = Math.max(3, Math.min(20, Math.round(base - Math.max(0, wickets - 3) * 0.4)));
  const wicketChance = Math.max(8, Math.min(55, Math.round(18 + wickets * 4)));
  return { runs: mid, low: Math.max(0, mid - 4), high: mid + 5, wicketChance };
}

export function voteIsOpen(status: string, legalBalls: number, maxOvers: number): boolean {
  if (status === "completed") return true;
  if (status !== "live") return false;
  return legalBalls >= Math.floor(maxOvers * 6 * 0.75);
}

export const VOTE_CATEGORIES = [
  { id: "potm", emoji: "🏆", label: "Player of the match", labelHi: "मैच का खिलाड़ी" },
  { id: "boundary", emoji: "💥", label: "Boundary hunter", labelHi: "बाउंड्री शिकारी" },
  { id: "spell", emoji: "🎯", label: "Spell of the night", labelHi: "रात की स्पेल" },
  { id: "moment", emoji: "✨", label: "Moment maker", labelHi: "पल बनाने वाला" },
] as const;

export function statsPick(
  players: { id: string; runs: number; fours: number; sixes: number; wickets: number }[],
  category: string,
): string {
  const score = (p: { runs: number; fours: number; sixes: number; wickets: number }) => {
    if (category === "boundary") return p.fours * 4 + p.sixes * 8;
    if (category === "spell") return p.wickets * 25 - Math.round(p.runs / 5);
    if (category === "moment") return p.sixes * 10 + p.wickets * 8;
    return p.runs + p.sixes * 6 + p.wickets * 20 + p.fours * 2;
  };
  return [...players].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0]?.id || "";
}

export function danmakuOk(text: string): "ok" | "short" | "long" | "betting" | "profanity" {
  const body = text.trim();
  if (body.length < 2) return "short";
  if (body.length > DANMAKU_MAX) return "long";
  if (containsBetting(body)) return "betting";
  if (containsProfanity(body)) return "profanity";
  return "ok";
}

export function keyMoments<T extends { kind: string }>(lines: T[]): T[] {
  return lines.filter((line) => line.kind === "SIX" || line.kind === "WICKET" || line.kind === "FOUR");
}

export const LEAGUE_TIERS = [
  "Gully",
  "Club",
  "District",
  "State",
  "National",
  "Challenger",
  "Premier",
  "Elite",
  "Cap",
  "Legend",
] as const;

export function leagueOutcome(rank: number, size: number): "promote" | "stay" | "relegate" {
  if (size < 4) return "stay";
  const edge = Math.max(1, Math.ceil(size * 0.3));
  if (rank <= edge) return "promote";
  if (rank > size - edge) return "relegate";
  return "stay";
}

export function applyLeagueMove(tier: number, outcome: "promote" | "stay" | "relegate"): number {
  const current = Math.max(1, Math.min(10, tier));
  if (outcome === "promote") return Math.min(10, current + 1);
  if (outcome === "relegate") return Math.max(1, current - 1);
  return current;
}

export function leagueName(tier: number): string {
  return LEAGUE_TIERS[Math.max(1, Math.min(10, tier)) - 1] || LEAGUE_TIERS[0];
}

export function nextFriendStreak(lastDay: string | null, today: string, prev: number): number {
  if (lastDay === today) return prev;
  if (lastDay && shiftIstDay(lastDay, 1) === today) return prev + 1;
  return 1;
}

export function validXi(ids: string[]): boolean {
  return ids.length === 11 && new Set(ids).size === 11 && ids.every((id) => id.length > 0);
}

export function fanXiTally(picks: string[][]): { id: string; votes: number }[] {
  const counts = new Map<string, number>();
  for (const xi of picks) {
    for (const id of xi) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 11)
    .map(([id, votes]) => ({ id, votes }));
}

interface RosterPlayer {
  id: string;
  name: string;
  role: "bat" | "bowl" | "all" | "wk";
  team: string;
  clue: string;
  path: string;
  mates: string;
  rating: number;
}

/** Original clue lines about the cartoon XI. No photos, no copied biographies. */
const ROSTER: RosterPlayer[] = [
  { id: "ind_rohit", name: "Rohit Sharma", role: "bat", team: "IND", clue: "Opens and hits in the air", path: "Opener → India top", mates: "Shubman Gill", rating: 92 },
  { id: "ind_gill", name: "Shubman Gill", role: "bat", team: "IND", clue: "Right-hand top order", path: "Under-19 → India opener", mates: "Rohit Sharma", rating: 84 },
  { id: "ind_kohli", name: "Virat Kohli", role: "bat", team: "IND", clue: "Chase finisher, cover drive", path: "Delhi → India No.3", mates: "Rohit Sharma", rating: 95 },
  { id: "ind_pant", name: "Rishabh Pant", role: "wk", team: "IND", clue: "Left-hand keeper", path: "Keeper → middle order", mates: "Rohit Sharma", rating: 80 },
  { id: "ind_hardik", name: "Hardik Pandya", role: "all", team: "IND", clue: "Hits and bowls seam", path: "All-rounder → death overs", mates: "Jasprit Bumrah", rating: 86 },
  { id: "ind_bumrah", name: "Jasprit Bumrah", role: "bowl", team: "IND", clue: "Yorkers at the death", path: "Gujarat → India death", mates: "Hardik Pandya", rating: 97 },
  { id: "ind_jadeja", name: "Ravindra Jadeja", role: "all", team: "IND", clue: "Left-arm spin and a direct hit", path: "Bits → three skills", mates: "Hardik Pandya", rating: 88 },
  { id: "aus_head", name: "Travis Head", role: "bat", team: "AUS", clue: "Left-hand and in a hurry", path: "Opener → powerplay", mates: "Mitchell Marsh", rating: 90 },
  { id: "aus_cummins", name: "Pat Cummins", role: "bowl", team: "AUS", clue: "Hits the pitch hard", path: "Fast bowler → leader", mates: "Mitchell Starc", rating: 91 },
  { id: "aus_starc", name: "Mitchell Starc", role: "bowl", team: "AUS", clue: "Left-arm swing, new ball", path: "Swing → yorker", mates: "Pat Cummins", rating: 89 },
  { id: "aus_maxwell", name: "Glenn Maxwell", role: "all", team: "AUS", clue: "Reverse sweep and off spin", path: "Finisher → spin overs", mates: "Travis Head", rating: 83 },
  { id: "eng_butler", name: "Jos Buttler", role: "wk", team: "ENG", clue: "Keeper who starts in the powerplay", path: "Keeper → opener", mates: "Joe Root", rating: 87 },
  { id: "eng_stokes", name: "Ben Stokes", role: "all", team: "ENG", clue: "Left-hand and a heavy ball", path: "All-rounder → the fight", mates: "Joe Root", rating: 90 },
  { id: "eng_root", name: "Joe Root", role: "bat", team: "ENG", clue: "Quiet accumulator", path: "No.4 → anchor", mates: "Ben Stokes", rating: 85 },
  { id: "sa_rabada", name: "Kagiso Rabada", role: "bowl", team: "SA", clue: "Right-arm fast, hits the seam", path: "Fast → new ball", mates: "Quinton de Kock", rating: 90 },
  { id: "pak_babar", name: "Babar Azam", role: "bat", team: "PAK", clue: "Cover drive, sets the tempo", path: "Top order → captaincy", mates: "Mohammad Rizwan", rating: 88 },
];

export interface Puzzle {
  key: string;
  kind: "clue" | "path" | "rank" | "link";
  prompt: string;
  promptHi: string;
  options: { id: string; label: string }[];
  answer: string;
  rarity: number;
  points: number;
}

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(seed: string, items: T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  let h = hash(seed);
  while (out.length < count && pool.length) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const index = h % pool.length;
    out.push(pool.splice(index, 1)[0]);
  }
  return out;
}

function rarityFor(role: RosterPlayer["role"]): number {
  if (role === "bowl") return 0.85;
  if (role === "all") return 0.6;
  if (role === "wk") return 0.45;
  return 0.25;
}

function pointsFor(rarity: number): number {
  return 8 + Math.round(rarity * 24);
}

export function dailyPuzzles(day: string): Puzzle[] {
  const clue = pick(day + ":clue", ROSTER, 4);
  const subject = clue[0];
  const path = pick(day + ":path", ROSTER, 4);
  const ranked = pick(day + ":rank", ROSTER, 5).sort((a, b) => a.name.localeCompare(b.name));
  const ordered = [...ranked].sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id));
  const link = pick(day + ":link", ROSTER, 1)[0];
  const mates = ROSTER.filter((p) => p.id !== link.id);
  const linkOptions = pick(day + ":linkopt", mates, 3);
  const linkAnswer = ROSTER.find((p) => p.name === link.mates) || linkOptions[0];
  if (!linkOptions.some((p) => p.id === linkAnswer.id)) linkOptions[0] = linkAnswer;
  const clueRarity = rarityFor(subject.role);
  const pathRarity = rarityFor(path[0].role);
  const rankRarity = 0.7;
  const linkRarity = rarityFor(link.role);
  return [
    {
      key: "clue",
      kind: "clue",
      prompt: subject.clue,
      promptHi: subject.clue,
      options: clue.map((p) => ({ id: p.id, label: p.name })),
      answer: subject.id,
      rarity: clueRarity,
      points: pointsFor(clueRarity),
    },
    {
      key: "path",
      kind: "path",
      prompt: `Whose cartoon path is “${path[0].path}”?`,
      promptHi: `यह रास्ता किसका है: “${path[0].path}”?`,
      options: path.map((p) => ({ id: p.id, label: p.name })),
      answer: path[0].id,
      rarity: pathRarity,
      points: pointsFor(pathRarity),
    },
    {
      key: "rank",
      kind: "rank",
      prompt: "Rank these five by Floodlight rating, highest first. It is our index, not an official list.",
      promptHi: "इन पाँच को फ्लडलाइट रेटिंग से ऊपर से नीचे लगाएँ। यह हमारी सूची है।",
      options: ranked.map((p) => ({ id: p.id, label: p.name })),
      answer: ordered.map((p) => p.id).join(","),
      rarity: rankRarity,
      points: pointsFor(rankRarity),
    },
    {
      key: "link",
      kind: "link",
      prompt: `Who shares a dressing room with ${link.name} in this cartoon XI?`,
      promptHi: `${link.name} के साथ इस कार्टून XI में कौन है?`,
      options: linkOptions.map((p) => ({ id: p.id, label: p.name })),
      answer: linkAnswer.id,
      rarity: linkRarity,
      points: pointsFor(linkRarity),
    },
  ];
}

export function gradePuzzle(puzzle: Puzzle, answer: string): { correct: boolean; points: number } {
  const got = answer.trim();
  const correct = got === puzzle.answer;
  return { correct, points: correct ? puzzle.points : 0 };
}

export function resultGrid(marks: ("hit" | "miss" | "open")[]): string {
  return marks.map((mark) => (mark === "hit" ? "🟩" : mark === "miss" ? "⬛" : "⬜")).join("");
}

export interface StickerDef {
  id: string;
  team: string;
  set: string;
  emoji: string;
  face: string;
  name: string;
}

export const STICKERS: StickerDef[] = [
  { id: "ind_bat", team: "ind", set: "India night", emoji: "🏏", face: "😎", name: "Cover drive" },
  { id: "ind_bowl", team: "ind", set: "India night", emoji: "🎯", face: "😤", name: "Yorker" },
  { id: "ind_keep", team: "ind", set: "India night", emoji: "🧤", face: "😄", name: "Keeper" },
  { id: "ind_all", team: "ind", set: "India night", emoji: "⚡", face: "🤩", name: "All-round" },
  { id: "aus_bat", team: "aus", set: "Gold caps", emoji: "🏏", face: "😁", name: "Pull shot" },
  { id: "aus_bowl", team: "aus", set: "Gold caps", emoji: "🎯", face: "😠", name: "Bouncer" },
  { id: "aus_keep", team: "aus", set: "Gold caps", emoji: "🧤", face: "😉", name: "Glove" },
  { id: "aus_all", team: "aus", set: "Gold caps", emoji: "⚡", face: "🥳", name: "Finisher" },
  { id: "eng_bat", team: "eng", set: "Blue caps", emoji: "🏏", face: "🙂", name: "Leave" },
  { id: "eng_bowl", team: "eng", set: "Blue caps", emoji: "🎯", face: "😮", name: "Swing" },
  { id: "eng_keep", team: "eng", set: "Blue caps", emoji: "🧤", face: "😜", name: "Stumping" },
  { id: "eng_all", team: "eng", set: "Blue caps", emoji: "⚡", face: "😇", name: "Fight" },
];

export function stickerPull(seed: string, count = 3): string[] {
  const out: string[] = [];
  let h = hash(seed);
  while (out.length < count) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    out.push(STICKERS[h % STICKERS.length].id);
  }
  return out;
}

export function swapOk(haveOffer: number, friendHasWant: number): boolean {
  return haveOffer >= 2 && friendHasWant >= 2;
}

export const PLAY_SLOTS = [
  "live_pin",
  "inline_card",
  "squad",
  "fan_vote",
  "danmaku",
  "chip",
  "pred_streak",
  "puzzle",
  "album",
  "ticket",
  "luck",
  "league",
  "fan_xi",
] as const;
