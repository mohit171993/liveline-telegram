import { loadEncryptionKey } from "@liveline/shared";
import { env, isProd } from "../env";

let cached: Buffer | null = null;

export function loadKey(): Buffer {
  if (cached) return cached;
  const raw = env.rewardsKey || (!isProd ? "liveline-pro-local-dev-key-32b!!" : "");
  cached = loadEncryptionKey(raw);
  return cached;
}
