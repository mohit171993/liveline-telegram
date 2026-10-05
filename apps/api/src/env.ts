import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3001),
  botToken: process.env.TELEGRAM_BOT_TOKEN || "",
  adminRaw: process.env.ADMIN_TELEGRAM_IDS || "",
  adminAlertChat: process.env.ADMIN_ALERT_CHAT_ID || "",
  channelId: process.env.CHANNEL_ID || "",
  channelUsername: (process.env.CHANNEL_USERNAME || "").replace(/^@/, ""),
  // Channel auto-posting is OFF unless explicitly enabled.
  channelAutopost: bool("CHANNEL_AUTOPOST", false),
  publicApiUrl: (process.env.PUBLIC_API_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")).replace(/\/$/, ""),
  /** The api's public https origin from any service (bot/worker have no domain of their own). */
  apiOrigin: (process.env.PUBLIC_API_URL || (process.env.RAILWAY_SERVICE_LIVELINE_API_URL ? `https://${process.env.RAILWAY_SERVICE_LIVELINE_API_URL}` : "") || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")).replace(/\/$/, ""),
  botUsername: (process.env.BOT_USERNAME || "LiveLineProBot").replace(/^@/, ""),
  webappUrl: (process.env.WEBAPP_URL || "http://localhost:5173").replace(/\/$/, ""),
  authMaxAge: Number(process.env.AUTH_MAX_AGE_SECONDS || 86400),
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  useMockProvider: bool("USE_MOCK_PROVIDER", true),
  roanuzProject: process.env.ROANUZ_PROJECT_KEY || "",
  roanuzKey: process.env.ROANUZ_API_KEY || "",
  roanuzBase: (process.env.ROANUZ_BASE_URL || "https://api.sports.roanuz.com/v5").replace(/\/$/, ""),
  roanuzWs: process.env.ROANUZ_WS_URL || "http://socket.sports.roanuz.com/cricket",
  roanuzRps: Number(process.env.ROANUZ_RPS || 2),
  simTickMs: Number(process.env.SIM_TICK_MS || 8000),
  openaiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  aiDailyLimit: Number(process.env.AI_DAILY_LIMIT || 12),
  giftClientId: process.env.GIFTPORT_CLIENT_ID || "",
  giftSecretId: process.env.GIFTPORT_SECRET_ID || "",
  giftApiUrl: (process.env.GIFTPORT_API_URL || "https://giftport.in/api/giftcard").replace(/\/$/, ""),
  giftProxy: process.env.GIFTPORT_PROXY_URL || "",
  giftLowBalance: Number(process.env.GIFTPORT_LOW_BALANCE_INR || 1000),
  rewardsKey: process.env.REWARDS_ENCRYPTION_KEY || "",
  s3Endpoint: process.env.S3_ENDPOINT || "",
  s3Bucket: process.env.S3_BUCKET || "",
  s3Access: process.env.S3_ACCESS_KEY_ID || "",
  s3Secret: process.env.S3_SECRET_ACCESS_KEY || "",
  s3Region: process.env.S3_REGION || "auto",
  s3Public: process.env.S3_PUBLIC_URL || "",
  // Ads manager uploads (Railway bucket "liveline-ads"; private, served via /ads-media/*).
  adsS3Endpoint: process.env.ADS_S3_ENDPOINT || "",
  adsS3Bucket: process.env.ADS_S3_BUCKET || "",
  adsS3Access: process.env.ADS_S3_ACCESS_KEY_ID || "",
  adsS3Secret: process.env.ADS_S3_SECRET_ACCESS_KEY || "",
  adsS3Region: process.env.ADS_S3_REGION || "auto",
  adsS3PathStyle: process.env.ADS_S3_PATH_STYLE === "true",
  embeddedWorker: bool("RUN_EMBEDDED_WORKER", true),
  internalToken: process.env.INTERNAL_SERVICE_TOKEN || "",
  workerHealthPort: Number(process.env.WORKER_HEALTH_PORT || 3002),
  botHealthPort: Number(process.env.BOT_HEALTH_PORT || 3003),
  lockMs: 800,
};

export const isProd = env.nodeEnv === "production";

/**
 * Prize-free mode (Telegram Ads policy): when false (default) there are no vouchers, gift cards,
 * GiftPort orders or prize draws anywhere. Spins/predictions give points, badges, levels only.
 * Set REWARDS_VOUCHERS_ENABLED=true to bring the voucher layer back.
 */
export const vouchersEnabled = bool("REWARDS_VOUCHERS_ENABLED", false);
/** Model win-probability % (odds-like). Off by default; WIN_PROBABILITY_ENABLED=true to show it. */
export const winProbEnabled = bool("WIN_PROBABILITY_ENABLED", false);

export const useMockGiftport =
  bool("USE_MOCK_GIFTPORT", true) || !env.giftClientId || !env.giftSecretId;

export function telegramDryRun(): boolean {
  return !env.botToken || env.botToken.includes("MOCK");
}

/**
 * Telegram Mini App deep link. Never hand out the raw hosting URL in messages:
 * t.me/<bot>?startapp=<param> opens the Mini App inside Telegram.
 * startapp allows [A-Za-z0-9_-], up to 64 chars.
 */
export function miniAppLink(param?: string): string {
  const clean = (param || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return clean ? `https://t.me/${env.botUsername}?startapp=${clean}` : `https://t.me/${env.botUsername}?startapp`;
}

export function matchLink(matchKey: string): string {
  return miniAppLink(`match_${matchKey}`);
}

export function channelUrl(): string | null {
  if (!env.channelUsername) return null;
  return `https://t.me/${env.channelUsername}`;
}
