export type Celebration = "FOUR" | "SIX" | "WICKET" | "FIFTY" | "HUNDRED" | "WIN";

const ORDER: Celebration[] = ["FOUR", "WICKET", "SIX", "FIFTY", "HUNDRED", "WIN"];

export function celebrations(moment: "FOUR" | "SIX" | "WICKET" | undefined, events: string[]): Celebration[] {
  const found = new Set<Celebration>();
  if (moment) found.add(moment);
  if (events.some((e) => e.startsWith("fifty:"))) found.add("FIFTY");
  if (events.some((e) => e.startsWith("hundred:"))) found.add("HUNDRED");
  if (events.some((e) => e.startsWith("result:"))) found.add("WIN");
  return ORDER.filter((item) => found.has(item));
}

export const RANKS = [
  { id: "gully", name: "Gully Player", min: 0 },
  { id: "club", name: "Club Star", min: 80 },
  { id: "state", name: "State Hero", min: 250 },
  { id: "cap", name: "India Cap", min: 600 },
  { id: "legend", name: "Legend", min: 1200 },
] as const;

export function rankFor(xp: number) {
  let current: (typeof RANKS)[number] = RANKS[0];
  for (const rank of RANKS) if (xp >= rank.min) current = rank;
  const next = RANKS[RANKS.indexOf(current) + 1] || null;
  const span = next ? next.min - current.min : 1;
  return {
    id: current.id,
    name: current.name,
    min: current.min,
    next: next ? { id: next.id, name: next.name, min: next.min } : null,
    progress: Math.min(1, (xp - current.min) / span),
  };
}

export function shiftIstDay(day: string, delta: number): string {
  const t = Date.parse(`${day}T12:00:00+05:30`) + delta * 86_400_000;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(t));
}

export function weekKey(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function nextDailyStreak(input: {
  lastDay: string | null;
  today: string;
  yesterday: string;
  streak: number;
  freeze: number;
}): { streak: number; freeze: number; lastDay: string; usedFreeze: boolean; continued: boolean } {
  if (input.lastDay === input.today) {
    return { streak: input.streak, freeze: input.freeze, lastDay: input.today, usedFreeze: false, continued: false };
  }
  if (!input.lastDay) {
    return { streak: 1, freeze: input.freeze, lastDay: input.today, usedFreeze: false, continued: false };
  }
  if (input.lastDay === input.yesterday) {
    return { streak: input.streak + 1, freeze: input.freeze, lastDay: input.today, usedFreeze: false, continued: true };
  }
  const missedYesterday = input.lastDay === shiftIstDay(input.yesterday, -1);
  if (missedYesterday && input.freeze > 0) {
    return { streak: input.streak + 1, freeze: input.freeze - 1, lastDay: input.today, usedFreeze: true, continued: true };
  }
  return { streak: 1, freeze: input.freeze, lastDay: input.today, usedFreeze: false, continued: false };
}

export const MISSIONS = [
  { key: "predict_5", period: "daily", target: 5, xp: 20, points: 10, event: "predict", label: "Predict 5 balls", labelHi: "5 गेंदों का अनुमान" },
  { key: "share_1", period: "daily", target: 1, xp: 15, points: 8, event: "share", label: "Share a score card", labelHi: "स्कोर कार्ड शेयर करें" },
  { key: "cheer_3", period: "daily", target: 3, xp: 12, points: 6, event: "cheer", label: "Cheer 3 times", labelHi: "3 बार जयकार" },
  { key: "predict_20", period: "weekly", target: 20, xp: 40, points: 20, event: "predict", label: "Predict 20 balls", labelHi: "20 गेंदों का अनुमान" },
  { key: "play_2", period: "weekly", target: 2, xp: 30, points: 15, event: "play", label: "Play 2 mini-games", labelHi: "2 मिनी-गेम खेलें" },
] as const;

export type MissionEvent = (typeof MISSIONS)[number]["event"];

export function periodKey(period: "daily" | "weekly", day: string): string {
  return period === "daily" ? day : weekKey(day);
}

export const SEASON_KEY = "floodlight-2026";

export const SEASON_TIERS = [
  { tier: 1, xp: 30, label: "10 points", kind: "points" as const, points: 10 },
  { tier: 2, xp: 80, label: "Streak freeze", kind: "freeze" as const, freeze: 1 },
  { tier: 3, xp: 150, label: "25 points", kind: "points" as const, points: 25 },
  { tier: 4, xp: 250, label: "Monsoon theme", kind: "theme" as const, theme: "monsoon" },
  { tier: 5, xp: 400, label: "Club nights badge", kind: "badge" as const, badge: "club_nights" },
  { tier: 6, xp: 600, label: "Prediction boost", kind: "boost" as const },
  { tier: 7, xp: 850, label: "50 points", kind: "points" as const, points: 50 },
  { tier: 8, xp: 1200, label: "Legend frame", kind: "badge" as const, badge: "legend_frame" },
];

export function fanLoudness(picks: number, cheers: number): number {
  return Math.max(0, picks) * 3 + Math.max(0, cheers);
}

export const CHEER_EMOJIS = ["🔥", "👏", "😱", "💚", "🎺"] as const;

export function cheerAllowed(lastMs: number, now: number, windowCount: number): boolean {
  if (now - lastMs < 700) return false;
  return windowCount < 8;
}

export function scoreGuessPoints(guess: number, actual: number): number {
  if (!Number.isFinite(guess) || !Number.isFinite(actual)) return 0;
  const delta = Math.abs(Math.round(guess) - Math.round(actual));
  if (delta === 0) return 25;
  if (delta <= 6) return 15;
  if (delta <= 12) return 8;
  return 0;
}

export interface TriviaQ {
  id: string;
  prompt: string;
  promptHi: string;
  options: string[];
  answer: number;
}

const TRIVIA: TriviaQ[] = [
  { id: "balls", prompt: "How many legal balls are in a T20 innings?", promptHi: "T20 पारी में कितनी कानूनी गेंदें होती हैं?", options: ["100", "120", "150", "90"], answer: 1 },
  { id: "power", prompt: "A T20 powerplay lasts how many overs?", promptHi: "T20 पावरप्ले कितने ओवर का होता है?", options: ["4", "6", "8", "10"], answer: 1 },
  { id: "wide", prompt: "A wide adds how many runs before any extra?", promptHi: "वाइड पर कम से कम कितने रन जुड़ते हैं?", options: ["0", "1", "2", "4"], answer: 1 },
  { id: "overs", prompt: "Which score is a fifty?", promptHi: "फिफ्टी कौन सा स्कोर है?", options: ["49", "50", "100", "25"], answer: 1 },
  { id: "max", prompt: "What is the highest score off one legal ball, without extras?", promptHi: "एक कानूनी गेंद पर बिना अतिरिक्त के अधिकतम रन?", options: ["4", "5", "6", "7"], answer: 2 },
  { id: "tie", prompt: "If the scores finish level after both innings, the match is a…", promptHi: "दोनों पारियाँ बराबर रहें तो मैच…", options: ["tie", "no-result only", "super over always", "draw in T20"], answer: 0 },
];

export function triviaFor(seed: string): TriviaQ {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  const q = TRIVIA[hash % TRIVIA.length];
  return q;
}

export function oversAt(overs: { runs: number }[], legalBalls: number, mark = 10): number | null {
  if (legalBalls < mark * 6) return null;
  return overs.slice(0, mark).reduce((sum, over) => sum + over.runs, 0);
}
