import crypto from "crypto";

export function loadEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("REWARDS_ENCRYPTION_KEY is empty");
  if (/^[A-Za-z0-9+/]+=*$/.test(trimmed) && trimmed.length >= 43) {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 32) return decoded;
  }
  const utf = Buffer.from(trimmed, "utf8");
  if (utf.length === 32) return utf;
  throw new Error("REWARDS_ENCRYPTION_KEY must be 32 bytes or standard base64 of 32 bytes");
}

/** AES-256-GCM. Payload is versioned so we can rotate later. */
export function encryptString(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptString(payload: string, key: Buffer): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !ctB64) throw new Error("BAD_PAYLOAD");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64url")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}

export function randomId(prefix = ""): string {
  return prefix + crypto.randomBytes(12).toString("hex");
}

/** Uniform [0, 1) from CSPRNG. */
export function cryptoUnit(): number {
  const buf = crypto.randomBytes(6);
  let n = 0;
  for (const byte of buf) n = n * 256 + byte;
  return n / 2 ** 48;
}
