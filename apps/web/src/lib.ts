export type Team = {
  key: string; name: string; nameHi: string; code: string; color: string; color2: string; flag: string;
};
export type Live = {
  batting: "a" | "b";
  runs: number; wickets: number; overs: string;
  crr: number; rrr: number | null; target: number | null; projected: number | null;
  need: string | null; needHi: string | null;
  win: { a: number; b: number; tie: number };
  striker: { id: string; name: string; runs: number; balls: number; fours: number; sixes: number; look?: Look } | null;
  nonStriker: { id: string; name: string; runs: number; balls: number; look?: Look } | null;
  bowler: { id: string; name: string; overs: string; runs: number; wickets: number; economy: number; look?: Look } | null;
  mood?: { emoji: string; label: string; labelHi: string };
  luck?: { score: number; emoji: string; label: string; labelHi: string };
  forecast?: { runs: number; low: number; high: number; wicketChance: number };
  partnership: { runs: number; balls: number };
  thisOver: string[];
  recent: string[];
};
export type Match = {
  key: string; demo: boolean; seriesKey: string; seriesName: string; name: string; format: string;
  status: "live" | "upcoming" | "completed"; startAt: number; venue: string; city: string; pitch: string; toss: string;
  result?: string; teams: { a: Team; b: Team }; scoreline: { a: string; b: string }; live: Live | null;
  innings?: Innings[]; commentary?: { over: string; text: string; textHi: string; kind: string }[];
  wagon?: { x: number; y: number; runs: number; wicket: boolean }[];
  manhattan?: { over: number; runs: number; wickets: number; innings: number }[];
  worm?: { over: number; runs: number; innings: number }[];
  xi?: { a: Player[]; b: Player[] };
  h2h?: { played: number; aWins: number; bWins: number; last: string };
  points?: { team: string; p: number; w: number; l: number; nrr: string; pts: number }[];
  predictionOpen?: { ball: boolean; over: boolean; match: boolean };
  nextBallAt?: number;
  voteOpen?: boolean;
  moments?: { over: string; text: string; kind: string }[];
};
export type Innings = {
  team: "a" | "b"; title: string; runs: number; wickets: number; overs: string; extras: number;
  batters: { id: string; name: string; runs: number; balls: number; fours: number; sixes: number; out: boolean; dismissal?: string; look?: Look }[];
  bowlers: { id: string; name: string; overs: string; runs: number; wickets: number; economy: number; look?: Look }[];
};
export type Look = {
  face: string; jersey: string; ink: string; number: number; role: string; icon: string; cap: string; frame: string;
};
export type Player = { id: string; name: string; role: string; style: string; look?: Look };
/** Server feature flags (from /api/me). Prize-free by default. */
export const FEATURES = { vouchers: false, winProb: false };

export type Me = {
  features?: { vouchers: boolean; winProb: boolean };
  user: {
    id: string; telegramId: string; username: string | null; firstName: string | null; language: string;
    registered: boolean; needsPhone: boolean; needsTerms: boolean; needsAge?: boolean; ageStatus?: string; blocked: boolean; admin: boolean;
    points: number; xp: number; streak: number; predStreak?: number; streakSavers?: number; doubleDown?: number; leagueTier?: number; friendCode?: string | null; dailyStreak: number; streakFreeze: number;
    fanTeamKey: string | null;
    look: Look;
    rank: { id: string; name: string; progress: number; next: { name: string; min: number } | null };
    bonusSpins: number; phone: string | null; theme: string;
    referralLink: string;
  };
  channelUrl: string | null;
};

const dict = {
  en: {
    live: "LIVE", upcoming: "Upcoming", recent: "Recent", all: "All", fav: "Favourites",
    predict: "Predict", board: "Board", rewards: "XP", alerts: "Alerts", home: "Home",
    line: "Line", card: "Card", charts: "Charts", chat: "Watch", ai: "Buddy",
    need: "Needed", crr: "CRR", rrr: "RRR", proj: "Proj", win: "Match momentum",
    partner: "Partnership", thisOver: "This over", openTg: "Open in Telegram",
    verify: "Verify to enter", terms: "I agree to the terms and privacy notice",
    phone: "Share phone in Telegram", join: "Join our channel", demo: "Simulated feed",
    spin: "Daily XP Spin", scratch: "Bonus XP cards", give: "Free draws", ads: "Advertise",
    pass: "Season", missions: "Missions", fans: "Fan meter", cheer: "Cheer", mute: "Mute", unmute: "Sound",
    users: "Users", campaigns: "Campaigns", create: "New campaign", dash: "Dashboard",
    lock: "Locked", submit: "Lock pick", points: "pts",
  },
  hi: {
    live: "लाइव", upcoming: "आने वाले", recent: "नतीजे", all: "सभी", fav: "पसंदीदा",
    predict: "अनुमान", board: "बोर्ड", rewards: "XP", alerts: "अलर्ट", home: "होम",
    line: "लाइन", card: "कार्ड", charts: "चार्ट", chat: "वॉच", ai: "बडी",
    need: "बाकी", crr: "सीआरआर", rrr: "आरआरआर", proj: "अनुमान", win: "मॉडल जीत %",
    partner: "साझेदारी", thisOver: "यह ओवर", openTg: "टेलीग्राम में खोलें",
    verify: "अंदर आने के लिए सत्यापन", terms: "मैं नियम और गोपनीयता सूचना मानता हूँ",
    phone: "टेलीग्राम से फ़ोन साझा करें", join: "चैनल से जुड़ें", demo: "डेमो फ़ीड",
    spin: "डेली XP स्पिन", scratch: "बोनस XP कार्ड", give: "मुफ़्त ड्रॉ", ads: "विज्ञापन",
    pass: "सीज़न", missions: "मिशन", fans: "फैन मीटर", cheer: "जयकार", mute: "म्यूट", unmute: "साउंड",
    users: "यूज़र", campaigns: "अभियान", create: "नया अभियान", dash: "डैशबोर्ड",
    lock: "लॉक", submit: "पिक लॉक करें", points: "अंक",
  },
} as const;

export type Lang = keyof typeof dict;
export function t(lang: string, key: keyof typeof dict.en): string {
  const pack = lang === "hi" ? dict.hi : dict.en;
  return pack[key] || dict.en[key];
}

export function initData(): string {
  return window.Telegram?.WebApp?.initData || "";
}

export function inTelegram(): boolean {
  return Boolean(initData());
}

export function apiBase(): string {
  const runtime = window.__LL_API__ || import.meta.env.VITE_API_URL || "";
  return runtime.replace(/\/$/, "");
}

export function wsBase(): string {
  const base = apiBase();
  if (!base) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}`;
  }
  return base.replace(/^http/, "ws");
}

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (!headers.has("content-type") && opts.body) headers.set("content-type", "application/json");
  headers.set("authorization", `tma ${initData()}`);
  const res = await fetch(`${apiBase()}${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(friendlyError(data.error, data.message, res.status)) as Error & { code?: string; status?: number };
    err.code = data.error;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

const FRIENDLY: Record<string, string> = {
  REGISTRATION_REQUIRED: "Verify your phone in the bot to unlock this.",
  AGE_GATE: "Confirm your age to continue.",
  SLOW_DOWN: "Easy! Try again in a few seconds.",
  NOT_FOUND: "That isn't available right now.",
  NO_WHEEL: "The wheel is being set up. Try again in a minute.",
  BLOCKED: "This account is blocked.",
  ADMIN_ONLY: "Admins only.",
};

export function friendlyError(code?: string, message?: string, status?: number): string {
  if (code && FRIENDLY[code]) return message && message !== code && !/^[A-Z_]+$/.test(message) ? message : FRIENDLY[code];
  if (message && !/^[A-Z_]+$/.test(message)) return message;
  if (status && status >= 500) return "Our server hiccupped. Try again.";
  if (code) return code.toLowerCase().split("_").join(" ").replace(/^./, (c) => c.toUpperCase()) + ".";
  return "Something went wrong. Try again.";
}

/** Small toast for every action. Rendered by <Toaster /> in ui.tsx. */
export function toast(text: string, kind: "ok" | "err" = "ok") {
  window.dispatchEvent(new CustomEvent("ll-toast", { detail: { text, kind } }));
  if (kind === "err") window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
}

export function haptic(kind: "light" | "medium" | "heavy" = "light") {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(kind);
}

export function bootTelegram() {
  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();
  if (!localStorage.getItem("ll-theme") && (tg?.colorScheme === "light" || tg?.colorScheme === "dark")) {
    document.documentElement.dataset.theme = tg.colorScheme;
  }
  const bg = document.documentElement.dataset.theme === "light" ? "#F3F6FB" : "#070B14";
  tg?.setHeaderColor?.(bg);
  tg?.setBackgroundColor?.(bg);
}

declare global {
  interface Window {
    __LL_API__?: string;
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe?: { start_param?: string; user?: { language_code?: string } };
        ready: () => void;
        expand: () => void;
        themeParams?: Record<string, string>;
        colorScheme?: "light" | "dark";
        setHeaderColor?: (c: string) => void;
        setBackgroundColor?: (c: string) => void;
        HapticFeedback?: { impactOccurred: (s: string) => void; notificationOccurred: (s: string) => void; selectionChanged: () => void };
        BackButton: { show: () => void; hide: () => void; onClick: (fn: () => void) => void; offClick: (fn: () => void) => void };
        MainButton: { setText: (s: string) => void; show: () => void; hide: () => void; onClick: (fn: () => void) => void; offClick: (fn: () => void) => void; enable: () => void };
        requestContact?: (cb?: (ok: boolean, res?: { status?: string; response?: string }) => void) => void;
        close?: () => void;
        isVersionAtLeast?: (v: string) => boolean;
        openTelegramLink: (url: string) => void;
        openLink: (url: string) => void;
        addToHomeScreen?: () => void;
        shareToStory?: (mediaUrl: string, params?: { text?: string }) => void;
      };
    };
  }
}
