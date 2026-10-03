import Redis from "ioredis";
import { env } from "./env";

export const redis = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

redis.on("error", (err) => {
  console.error(JSON.stringify({ level: "error", msg: "redis", err: String(err) }));
});

export function bullConnection() {
  return { url: env.redisUrl, maxRetriesPerRequest: null as null };
}
