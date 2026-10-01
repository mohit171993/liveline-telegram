export type Team = {
  key: string; name: string; nameHi: string; code: string; color: string; color2: string; flag: string;
};
export type Live = {
  batting: "a" | "b";
  runs: number; wickets: number; overs: string;
  crr: number; rrr: number | null; target: number | null; projected: number | null;
  need: string | null; needHi: string | null;
  win: { a: number; b: number; tie: number };
  striker: { id: string; name: string; runs: number; balls: number; fours: number; sixes: number } | null;
  nonStriker: { id: string; name: string; runs: number; balls: number } | null;
  bowler: { id: string; name: string; overs: string; runs: number; wickets: number; economy: number } | null;
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
};
export type Innings = {
  team: "a" | "b"; title: string; runs: number; wickets: number; overs: string; extras: number;
  batters: { id: string; name: string; runs: number; balls: number; fours: number; sixes: number; out: boolean; dismissal?: string }[];
  bowlers: { id: string; name: string; overs: string; runs: number; wickets: number; economy: number }[];
};
export type Player = { id: string; name: string; role: string; style: string };
export type Me = {
  user: {
    id: string; telegramId: string; username: string | null; firstName: string | null; language: string;
    registered: boolean; needsPhone: boolean; needsTerms: boolean; blocked: boolean; admin: boolean;
    points: number; xp: number; streak: number; dailyStreak: number; streakFreeze: number;
    fanTeamKey: string | null;
    rank: { id: string; name: string; progress: number; next: { name: string; min: number } | null };
    bonusSpins: number; phone: string | null; theme: string;
    referralLink: string;
  };
  channelUrl: string | null;
};

const dict = {
  en: {
    live: "LIVE", upcoming: "Upcoming", recent: "Recent", all: "All", fav: "Favourites",
    predict: "Predict", board: "Board", rewards: "Rewards", alerts: "Alerts", home: "Home",
    line: "Line", card: "Card", charts: "Charts", chat: "Watch", ai: "Buddy",
    need: "Needed", crr: "CRR", rrr: "RRR", proj: "Proj", win: "Model win %",
    partner: "Partnership", thisOver: "This over", openTg: "Open in Telegram",
    verify: "Verify to enter", terms: "I agree to the terms and privacy notice",
    phone: "Share phone in Telegram", join: "Join our channel", demo: "Simulated feed",
    spin: "Free spin", scratch: "Scratch cards", give: "Free draws", ads: "Advertise",
    pass: "Season", missions: "Missions", fans: "Fan meter", cheer: "Cheer", mute: "Mute", unmute: "Sound",
    users: "Users", campaigns: "Campaigns", create: "New campaign", dash: "Dashboard",
    lock: "Locked", submit: "Lock pick", points: "pts",
  },
  hi: {
    live: "लाइव", upcoming: "आने वाले", recent: "नतीजे", all: "सभी", fav: "पसंदीदा",
    predict: "अनुमान", board: "बोर्ड", rewards: "इनाम", alerts: "अलर्ट", home: "होम",
    line: "लाइन", card: "कार्ड", charts: "चार्ट", chat: "वॉच", ai: "बडी",
    need: "बाकी", crr: "सीआरआर", rrr: "आरआरआर", proj: "अनुमान", win: "मॉडल जीत %",
    partner: "साझेदारी", thisOver: "यह ओवर", openTg: "टेलीग्राम में खोलें",
    verify: "अंदर आने के लिए सत्यापन", terms: "मैं नियम और गोपनीयता सूचना मानता हूँ",
    phone: "टेलीग्राम से फ़ोन साझा करें", join: "चैनल से जुड़ें", demo: "डेमो फ़ीड",
    spin: "मुफ़्त स्पिन", scratch: "स्क्रैच कार्ड", give: "मुफ़्त ड्रॉ", ads: "विज्ञापन",
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
    const err = new Error(data.message || data.error || "error") as Error & { code?: string; status?: number };
    err.code = data.error;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export function haptic(kind: "light" | "medium" | "heavy" = "light") {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(kind);
}

export function bootTelegram() {
  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();
  const p = tg?.themeParams;
  if (!p) return;
  const root = document.documentElement;
  if (p.bg_color) root.style.setProperty("--tg-theme-bg-color", p.bg_color);
  if (p.text_color) root.style.setProperty("--tg-theme-text-color", p.text_color);
  if (p.hint_color) root.style.setProperty("--tg-theme-hint-color", p.hint_color);
  if (p.button_color) root.style.setProperty("--tg-theme-button-color", p.button_color);
  if (p.button_text_color) root.style.setProperty("--tg-theme-button-text-color", p.button_text_color);
  if (p.secondary_bg_color) root.style.setProperty("--tg-theme-secondary-bg-color", p.secondary_bg_color);
  tg?.setHeaderColor?.(p.bg_color || "#07080d");
  tg?.setBackgroundColor?.(p.bg_color || "#07080d");
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
        colorScheme?: string;
        setHeaderColor?: (c: string) => void;
        setBackgroundColor?: (c: string) => void;
        HapticFeedback?: { impactOccurred: (s: string) => void; notificationOccurred: (s: string) => void; selectionChanged: () => void };
        BackButton: { show: () => void; hide: () => void; onClick: (fn: () => void) => void; offClick: (fn: () => void) => void };
        MainButton: { setText: (s: string) => void; show: () => void; hide: () => void; onClick: (fn: () => void) => void; offClick: (fn: () => void) => void; enable: () => void };
        requestContact?: (cb?: (ok: boolean) => void) => void;
        openTelegramLink: (url: string) => void;
        openLink: (url: string) => void;
      };
    };
  }
}
