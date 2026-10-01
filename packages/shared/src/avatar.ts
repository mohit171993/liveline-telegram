export type RoleId = "bat" | "bowl" | "wk" | "all";

export interface Cartoon {
  face: string;
  jersey: string;
  ink: string;
  number: number;
  role: RoleId;
  icon: string;
  cap: string;
  frame: string;
}

export interface AvatarPick {
  face: string;
  jersey: string;
  cap: string;
  frame: string;
  role: RoleId;
  number: number;
}

export interface Unlock {
  id: string;
  xp: number;
  badge?: string;
}

export const ROLES: { id: RoleId; icon: string; label: string; labelHi: string }[] = [
  { id: "bat", icon: "🏏", label: "Batter", labelHi: "बल्लेबाज" },
  { id: "bowl", icon: "🎯", label: "Bowler", labelHi: "गेंदबाज" },
  { id: "wk", icon: "🧤", label: "Keeper", labelHi: "कीपर" },
  { id: "all", icon: "⚡", label: "All-rounder", labelHi: "ऑलराउंडर" },
];

export const FACES: (Unlock & { emoji: string })[] = [
  { id: "cool", emoji: "😎", xp: 0 },
  { id: "smile", emoji: "😄", xp: 0 },
  { id: "focus", emoji: "😤", xp: 40 },
  { id: "joy", emoji: "🤩", xp: 80 },
  { id: "wink", emoji: "😉", xp: 150 },
  { id: "party", emoji: "🥳", xp: 250 },
  { id: "lion", emoji: "🦁", xp: 600 },
];

export const JERSEYS: (Unlock & { color: string })[] = [
  { id: "lime", color: "#e7ff4d", xp: 0 },
  { id: "india", color: "#ff7a18", xp: 0 },
  { id: "blue", color: "#3d7eff", xp: 40 },
  { id: "gold", color: "#ffd200", xp: 80 },
  { id: "green", color: "#14915c", xp: 150 },
  { id: "night", color: "#1b2436", xp: 250 },
  { id: "rose", color: "#ff5d7a", xp: 400 },
];

export const CAPS: (Unlock & { emoji: string })[] = [
  { id: "none", emoji: "", xp: 0 },
  { id: "cap", emoji: "🧢", xp: 0 },
  { id: "lid", emoji: "⛑️", xp: 80 },
  { id: "sun", emoji: "👒", xp: 150 },
  { id: "crown", emoji: "👑", xp: 600, badge: "rank_cap" },
];

export const FRAMES: (Unlock & { color: string })[] = [
  { id: "plain", color: "#2a3142", xp: 0 },
  { id: "lime", color: "#e7ff4d", xp: 0 },
  { id: "gold", color: "#ffd200", xp: 80 },
  { id: "flame", color: "#ff7a18", xp: 250 },
  { id: "legend", color: "#ff5d7a", xp: 1200, badge: "legend_frame" },
];

export const BADGE_STICKER: Record<string, string> = {
  first_call: "🎯",
  sharpshooter: "🔥",
  century: "💯",
  nightwatch: "🌙",
  fan_colours: "📣",
  streak_3_days: "🔥",
  streak_7_days: "❄️",
  rank_club: "⭐",
  rank_state: "🏅",
  rank_cap: "🧢",
  rank_legend: "👑",
  club_nights: "🌃",
  legend_frame: "🖼️",
};

export const MOMENT_STICKER: Record<string, string> = {
  FOUR: "🏏",
  SIX: "💥",
  WICKET: "🎯",
  FIFTY: "5️⃣",
  HUNDRED: "💯",
  WIN: "🏆",
};

export const STATUS_STICKER: Record<string, string> = {
  live: "🔴",
  upcoming: "⏳",
  completed: "🏁",
};

const CAST_FACES = ["😄", "😎", "🙂", "😏", "🤩", "😤", "😁", "🤗"];

export function inkFor(hex: string): string {
  const raw = hex.replace("#", "");
  if (raw.length < 6) return "#142000";
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  const y = (r * 299 + g * 587 + b * 114) / 1000;
  return y > 150 ? "#142000" : "#f5f7fb";
}

export function roleIcon(role: RoleId): string {
  return ROLES.find((item) => item.id === role)?.icon || "🏏";
}

export function isUnlocked(item: { xp: number; badge?: string }, xp: number, badges: string[]): boolean {
  if (xp < item.xp) return false;
  if (item.badge && !badges.includes(item.badge)) return false;
  return true;
}

export function resolveLook(pick: AvatarPick): Cartoon {
  const face = FACES.find((item) => item.id === pick.face) || FACES[0];
  const jersey = JERSEYS.find((item) => item.id === pick.jersey) || JERSEYS[0];
  const cap = CAPS.find((item) => item.id === pick.cap) || CAPS[0];
  const frame = FRAMES.find((item) => item.id === pick.frame) || FRAMES[0];
  const role = ROLES.some((item) => item.id === pick.role) ? pick.role : "bat";
  const number = Math.min(99, Math.max(1, Math.round(pick.number) || 7));
  return {
    face: face.emoji,
    jersey: jersey.color,
    ink: inkFor(jersey.color),
    number,
    role,
    icon: roleIcon(role),
    cap: cap.emoji,
    frame: frame.color,
  };
}

export function assertAvatar(pick: AvatarPick, xp: number, badges: string[]): string | null {
  const face = FACES.find((item) => item.id === pick.face);
  const jersey = JERSEYS.find((item) => item.id === pick.jersey);
  const cap = CAPS.find((item) => item.id === pick.cap);
  const frame = FRAMES.find((item) => item.id === pick.frame);
  if (!face || !jersey || !cap || !frame) return "UNKNOWN";
  if (!ROLES.some((item) => item.id === pick.role)) return "BAD_ROLE";
  if (pick.number < 1 || pick.number > 99) return "BAD_NUMBER";
  if (!isUnlocked(face, xp, badges) || !isUnlocked(jersey, xp, badges) || !isUnlocked(cap, xp, badges) || !isUnlocked(frame, xp, badges)) {
    return "LOCKED";
  }
  return null;
}

export function castLook(id: string, role: RoleId, jersey: string, index: number): Cartoon {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 33 + id.charCodeAt(i)) >>> 0;
  const face = CAST_FACES[hash % CAST_FACES.length];
  const cap = role === "bowl" ? "🧢" : "⛑️";
  return {
    face,
    jersey,
    ink: inkFor(jersey),
    number: (index % 99) + 1,
    role,
    icon: roleIcon(role),
    cap,
    frame: "#2a3142",
  };
}

export function teamMood(winForBatting: number, recent: string[]): { emoji: string; label: string; labelHi: string } {
  const last = recent[recent.length - 1];
  const boundaries = recent.filter((ball) => ball === "4" || ball === "6").length;
  if (last === "W") return { emoji: "😬", label: "Nervy", labelHi: "घबराहट" };
  if (boundaries >= 2) return { emoji: "🔥", label: "On fire", labelHi: "आग" };
  if (winForBatting >= 65) return { emoji: "😎", label: "Cruising", labelHi: "आराम" };
  if (winForBatting <= 35) return { emoji: "😰", label: "Under pressure", labelHi: "दबाव" };
  return { emoji: "🏏", label: "In the contest", labelHi: "मुकाबला" };
}

export function badgeSticker(key: string): string {
  return BADGE_STICKER[key] || "🏅";
}
