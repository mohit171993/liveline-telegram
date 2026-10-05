export type Look = {
  face: string;
  jersey: string;
  ink: string;
  number: number;
  role: string;
  icon: string;
  cap: string;
  frame: string;
};

export function Avatar({ look, size = 48 }: { look: Look; size?: number }) {
  const label = `${look.icon} ${look.number}`;
  return (
    <svg className="avatar" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={label}>
      <circle cx="32" cy="32" r="30" fill="#10141e" stroke={look.frame} strokeWidth="3" />
      <path d="M14 38c4-6 10-8 18-8s14 2 18 8v16H14V38z" fill={look.jersey} />
      <circle cx="32" cy="24" r="11" fill="#f6d3b0" />
      <text x="32" y="29" textAnchor="middle" fontSize="16">{look.face}</text>
      {look.cap && <text x="32" y="16" textAnchor="middle" fontSize="12">{look.cap}</text>}
      <text x="32" y="52" textAnchor="middle" fontSize="11" fontFamily="Barlow Condensed, sans-serif" fill={look.ink}>{look.number}</text>
      <text x="50" y="46" textAnchor="middle" fontSize="11">{look.icon}</text>
    </svg>
  );
}

export const STATUS_STICKER: Record<string, string> = { live: "🔴", upcoming: "⏳", completed: "🏁" };
export const MOMENT_STICKER: Record<string, string> = { FOUR: "🏏", SIX: "💥", WICKET: "🎯", FIFTY: "5️⃣", HUNDRED: "💯", WIN: "🏆" };
export const BADGE_STICKER: Record<string, string> = {
  first_call: "🎯", sharpshooter: "🔥", century: "💯", nightwatch: "🌙", fan_colours: "📣",
  streak_3_days: "🔥", streak_7_days: "❄️", rank_club: "⭐", rank_state: "🏅", rank_cap: "🧢",
  rank_legend: "👑", club_nights: "🌃", legend_frame: "🖼️",
};

export function badgeSticker(key: string): string {
  return BADGE_STICKER[key] || "🏅";
}
