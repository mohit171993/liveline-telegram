import { useId } from "react";

const ALIAS: Record<string, string> = {
  unitedarabemirates: "UAE", unitedstates: "USA", unitedstatesofamerica: "USA",
  ind: "IND", india: "IND", aus: "AUS", australia: "AUS", eng: "ENG", england: "ENG",
  sa: "SA", southafrica: "SA", rsa: "SA", nz: "NZ", newzealand: "NZ", pak: "PAK", pakistan: "PAK",
  ban: "BAN", bangladesh: "BAN", sl: "SL", srilanka: "SL", wi: "WI", westindies: "WI",
  afg: "AFG", afghanistan: "AFG", ire: "IRE", ireland: "IRE", zim: "ZIM", zimbabwe: "ZIM",
  ned: "NED", netherlands: "NED", sco: "SCO", scotland: "SCO", uae: "UAE", usa: "USA",
  nep: "NEP", nepal: "NEP", oma: "OMA", oman: "OMA",
};

const KNOWN_FLAGS = new Set(["IND", "AUS", "ENG", "SA", "NZ", "PAK", "BAN", "SL", "WI", "AFG", "IRE", "ZIM", "NED", "SCO", "UAE", "USA", "NEP", "OMA"]);
/** True when we have real flag art for this team (national sides); clubs / franchises get a monogram badge instead. */
export function hasFlag(code: string, name = ""): boolean {
  const id = flagCode(code);
  if (!KNOWN_FLAGS.has(id)) return false;
  // "India Women", "Pakistan A" etc. are still national sides; franchises never alias to a country code by name.
  const n = name.toLowerCase().replace(/[^a-z]/g, "");
  return !n || Object.keys(ALIAS).some((k) => k.length > 3 && n.startsWith(k)) || n.length <= 4;
}

export function flagCode(code: string): string {
  const raw = code.toLowerCase().replace(/[^a-z]/g, "");
  return ALIAS[raw] || code.slice(0, 3).toUpperCase();
}

export function FlagArt({ id }: { id: string }) {
  switch (id) {
    case "IND":
      return (
        <>
          <rect width="60" height="14" fill="#FF9933" />
          <rect y="14" width="60" height="14" fill="#FFFFFF" />
          <rect y="28" width="60" height="14" fill="#138808" />
          <circle cx="30" cy="21" r="5" fill="none" stroke="#000080" strokeWidth="1.2" />
        </>
      );
    case "AUS":
      return (
        <>
          <rect width="60" height="42" fill="#012169" />
          <rect width="30" height="22" fill="#012169" />
          <path d="M0 0 L30 22 M30 0 L0 22" stroke="#fff" strokeWidth="4" />
          <path d="M0 0 L30 22 M30 0 L0 22" stroke="#C8102E" strokeWidth="2" />
          <path d="M15 0 V22 M0 11 H30" stroke="#fff" strokeWidth="7" />
          <path d="M15 0 V22 M0 11 H30" stroke="#C8102E" strokeWidth="3" />
          <circle cx="46" cy="30" r="2.2" fill="#fff" />
          <circle cx="40" cy="18" r="1.4" fill="#fff" />
          <circle cx="50" cy="16" r="1.4" fill="#fff" />
          <circle cx="52" cy="24" r="1.4" fill="#fff" />
          <circle cx="44" cy="26" r="1.3" fill="#fff" />
        </>
      );
    case "ENG":
      return (
        <>
          <rect width="60" height="42" fill="#FFFFFF" />
          <rect x="25" width="10" height="42" fill="#CF142B" />
          <rect y="16" width="60" height="10" fill="#CF142B" />
        </>
      );
    case "SA":
      return (
        <>
          <rect width="60" height="21" fill="#DE3831" />
          <rect y="21" width="60" height="21" fill="#002395" />
          <path d="M0 0 L26 21 L0 42 Z" fill="#007A4D" />
          <path d="M0 6 L18 21 L0 36 Z" fill="#FFB81C" />
          <path d="M0 10 L12 21 L0 32 Z" fill="#000" />
        </>
      );
    case "NZ":
      return (
        <>
          <rect width="60" height="42" fill="#012169" />
          <path d="M0 0 L24 16 M24 0 L0 16" stroke="#fff" strokeWidth="3" />
          <path d="M12 0 V16 M0 8 H24" stroke="#fff" strokeWidth="5" />
          <path d="M12 0 V16 M0 8 H24" stroke="#C8102E" strokeWidth="2" />
          <circle cx="44" cy="12" r="2" fill="#fff" />
          <circle cx="52" cy="20" r="2" fill="#fff" />
          <circle cx="46" cy="28" r="2.2" fill="#fff" />
          <circle cx="38" cy="22" r="1.6" fill="#fff" />
        </>
      );
    case "PAK":
      return (
        <>
          <rect width="16" height="42" fill="#fff" />
          <rect x="16" width="44" height="42" fill="#01411C" />
          <circle cx="36" cy="21" r="7" fill="#fff" />
          <circle cx="39" cy="19" r="6" fill="#01411C" />
          <circle cx="46" cy="14" r="1.3" fill="#fff" />
        </>
      );
    case "BAN":
      return (
        <>
          <rect width="60" height="42" fill="#006A4E" />
          <circle cx="26" cy="21" r="10" fill="#F42A41" />
        </>
      );
    case "SL":
      return (
        <>
          <rect width="14" height="42" fill="#FFBE29" />
          <rect x="14" width="32" height="42" fill="#8D153A" />
          <rect x="46" width="14" height="42" fill="#00534E" />
          <rect x="24" y="12" width="12" height="18" fill="#FFBE29" />
        </>
      );
    case "WI":
      return (
        <>
          <rect width="60" height="42" fill="#7B1113" />
          <path d="M8 34 L30 6 L52 34 Z" fill="#FCD116" />
          <rect x="27" y="22" width="6" height="14" fill="#007A3D" />
        </>
      );
    case "AFG":
      return (
        <>
          <rect width="20" height="42" fill="#000" />
          <rect x="20" width="20" height="42" fill="#D32011" />
          <rect x="40" width="20" height="42" fill="#007A36" />
          <circle cx="30" cy="21" r="6" fill="#fff" />
        </>
      );
    case "IRE":
      return (
        <>
          <rect width="20" height="42" fill="#169B62" />
          <rect x="20" width="20" height="42" fill="#fff" />
          <rect x="40" width="20" height="42" fill="#FF883E" />
        </>
      );
    case "ZIM":
      return (
        <>
          <rect width="60" height="6" y="0" fill="#006400" />
          <rect width="60" height="6" y="6" fill="#FFD200" />
          <rect width="60" height="6" y="12" fill="#D40000" />
          <rect width="60" height="6" y="18" fill="#000" />
          <rect width="60" height="6" y="24" fill="#D40000" />
          <rect width="60" height="6" y="30" fill="#FFD200" />
          <rect width="60" height="6" y="36" fill="#006400" />
          <polygon points="0,0 22,21 0,42" fill="#fff" />
          <polygon points="0,6 14,21 0,36" fill="#D40000" />
        </>
      );
    case "NED":
      return (
        <>
          <rect width="60" height="14" fill="#AE1C28" />
          <rect y="14" width="60" height="14" fill="#fff" />
          <rect y="28" width="60" height="14" fill="#21468B" />
        </>
      );
    case "SCO":
      return (
        <>
          <rect width="60" height="42" fill="#005EB8" />
          <path d="M0 0 L60 42 M60 0 L0 42" stroke="#fff" strokeWidth="8" />
        </>
      );
    case "UAE":
      return (
        <>
          <rect width="16" height="42" fill="#FF0000" />
          <rect x="16" width="44" height="14" fill="#00732F" />
          <rect x="16" y="14" width="44" height="14" fill="#fff" />
          <rect x="16" y="28" width="44" height="14" fill="#000" />
        </>
      );
    case "USA":
      return (
        <>
          <rect width="60" height="42" fill="#BF0A30" />
          <rect y="6" width="60" height="6" fill="#fff" />
          <rect y="18" width="60" height="6" fill="#fff" />
          <rect y="30" width="60" height="6" fill="#fff" />
          <rect width="26" height="22" fill="#002868" />
        </>
      );
    case "NEP":
      return (
        <>
          <rect width="60" height="42" fill="#fff" />
          <path d="M6 4 L40 18 L6 20 Z" fill="#DC143C" />
          <path d="M6 20 L44 34 L6 38 Z" fill="#DC143C" />
        </>
      );
    default:
      return (
        <>
          <rect width="60" height="42" fill="#10182A" />
          <text x="30" y="27" textAnchor="middle" fill="#E7FF4D" fontSize="14" fontFamily="Sora, sans-serif" fontWeight="700">{id.slice(0, 3)}</text>
        </>
      );
  }
}

export function Flag({ code, size = 32 }: { code: string; size?: number }) {
  const id = flagCode(code);
  const clip = useId().replace(/:/g, "");
  const height = Math.round(size * 0.68);
  return (
    <svg className="flag" width={size} height={height} viewBox="0 0 60 42" role="img" aria-label={id}>
      <defs>
        <clipPath id={clip}><rect width="60" height="42" rx="7" /></clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}><FlagArt id={id} /></g>
      <rect width="60" height="42" rx="7" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1.5" />
    </svg>
  );
}
