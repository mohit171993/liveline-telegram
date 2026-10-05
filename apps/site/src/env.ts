/** Runtime config. SITE_URL is the future public domain (e.g. https://livelinepro.in) — never a Railway host. */
function cleanSiteUrl(raw: string | undefined): string {
  const v = (raw || "").trim().replace(/\/+$/, "");
  if (!v) return "";
  // Hard rule: the Railway hostname must never leak into canonicals, OG tags or the sitemap.
  if (/railway\.(app|internal)/i.test(v)) return "";
  return v;
}

export const env = {
  port: Number(process.env.PORT || 3000),
  siteUrl: cleanSiteUrl(process.env.SITE_URL),
  /** Search engines are kept out until the real domain is live: set ALLOW_INDEXING=true then. */
  allowIndexing: process.env.ALLOW_INDEXING === "true" && Boolean(cleanSiteUrl(process.env.SITE_URL)),
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  useMock: process.env.USE_MOCK_PROVIDER === "true",
  botUsername: (process.env.BOT_USERNAME || "LiveLineProBot").replace(/^@/, ""),
  channelUsername: (process.env.CHANNEL_USERNAME || "LiveLine_Pro").replace(/^@/, ""),
  openaiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  linoAi: process.env.LINO_AI_ENABLED !== "false",
};

/** Absolute URL for canonicals/OG. Falls back to a relative path while no domain is configured. */
export function abs(path: string): string {
  return env.siteUrl ? `${env.siteUrl}${path}` : path;
}

/** Telegram Mini App deep link. startapp allows [A-Za-z0-9_-], max 64 chars. */
export function appLink(param: string): string {
  const p = `web_${param}`.replace(/[^A-Za-z0-9_-]/g, "_");
  return `https://t.me/${env.botUsername}?startapp=${p.length <= 64 ? p : "web_live"}`;
}

export function channelLink(): string {
  return `https://t.me/${env.channelUsername}`;
}
