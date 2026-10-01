import crypto from "crypto";

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
}

export interface InitDataResult {
  ok: true;
  user: TelegramWebAppUser;
  authDate: number;
  startParam: string | null;
  queryId: string | null;
}

export interface InitDataError {
  ok: false;
  error: "missing_hash" | "bad_hash" | "stale" | "missing_user" | "bad_user";
}

const MAX_SKEW_SECONDS = 30;

export function signInitData(
  botToken: string,
  fields: Record<string, string>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (key === "hash") continue;
    params.set(key, value);
  }
  const dataCheck = dataCheckString(params);
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

export function validateInitData(
  initData: string,
  botToken: string,
  nowMs = Date.now(),
  maxAgeSeconds = 86400,
): InitDataResult | InitDataError {
  if (!initData || !botToken) return { ok: false, error: "missing_hash" };
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, error: "bad_hash" };
  }
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, error: "missing_hash" };

  const dataCheck = dataCheckString(params);
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  const a = Buffer.from(calc, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: "bad_hash" };
  }

  const authDate = Number(params.get("auth_date") || 0);
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, error: "stale" };
  const age = nowMs / 1000 - authDate;
  if (age > maxAgeSeconds || age < -MAX_SKEW_SECONDS) return { ok: false, error: "stale" };

  const rawUser = params.get("user");
  if (!rawUser) return { ok: false, error: "missing_user" };
  let user: TelegramWebAppUser;
  try {
    user = JSON.parse(rawUser) as TelegramWebAppUser;
  } catch {
    return { ok: false, error: "bad_user" };
  }
  if (!user || typeof user.id !== "number" || !Number.isFinite(user.id)) {
    return { ok: false, error: "bad_user" };
  }
  return {
    ok: true,
    user,
    authDate,
    startParam: params.get("start_param"),
    queryId: params.get("query_id"),
  };
}

function dataCheckString(params: URLSearchParams): string {
  const pairs: [string, string][] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    pairs.push([key, value]);
  }
  pairs.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return pairs.map(([key, value]) => `${key}=${value}`).join("\n");
}

/** Contact shared via Telegram must belong to the same account that tapped the button. */
export function assertContactBelongsToUser(
  contactUserId: number | undefined | null,
  telegramUserId: number,
): void {
  if (!contactUserId || Number(contactUserId) !== Number(telegramUserId)) {
    throw new Error("CONTACT_MISMATCH");
  }
}

export function normalizePhone(input: string): string {
  return input.replace(/[^\d]/g, "");
}

export function phoneHash(normalizedPhone: string, pepper: string): string {
  return crypto.createHmac("sha256", pepper).update(normalizedPhone).digest("hex");
}

export interface AdminList {
  ids: Set<string>;
  usernames: Set<string>;
}

export function parseAdminList(raw: string | undefined): AdminList {
  const ids = new Set<string>();
  const usernames = new Set<string>();
  for (const part of (raw || "").split(",")) {
    const token = part.trim().replace(/^@/, "");
    if (!token) continue;
    if (/^\d+$/.test(token)) ids.add(token);
    else usernames.add(token.toLowerCase());
  }
  return { ids, usernames };
}

export function isAdmin(
  list: AdminList,
  telegramId: string | number,
  username?: string | null,
): boolean {
  if (list.ids.has(String(telegramId))) return true;
  if (username && list.usernames.has(username.toLowerCase().replace(/^@/, ""))) return true;
  return false;
}

export type AdminRole = "owner" | "full";

export interface AdminGrantView {
  id: string;
  telegramId: string | null;
  usernameNorm: string | null;
  role: AdminRole;
  revoked: boolean;
}

/** Telegram usernames are 5–32 characters. Numeric ids stay as digits. */
export function normalizeAdminToken(raw: string): { kind: "id" | "username"; value: string } | null {
  const token = raw.trim().replace(/^@/, "");
  if (!token || /\s/.test(token)) return null;
  if (/^\d+$/.test(token)) return { kind: "id", value: token };
  if (!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(token)) return null;
  return { kind: "username", value: token.toLowerCase() };
}

/** Every id and username in ADMIN_TELEGRAM_IDS is a full admin. */
export function envAdminTokens(raw: string | undefined): { kind: "id" | "username"; value: string; role: AdminRole }[] {
  const out: { kind: "id" | "username"; value: string; role: AdminRole }[] = [];
  for (const part of (raw || "").split(",")) {
    const token = normalizeAdminToken(part);
    if (!token) continue;
    out.push({ ...token, role: "full" });
  }
  return out;
}

export function envTokenCovered(
  rows: { telegramId: string | null; usernameNorm: string | null }[],
  token: { kind: "id" | "username"; value: string },
): boolean {
  return rows.some((row) => (token.kind === "id" ? row.telegramId === token.value : row.usernameNorm === token.value));
}

/**
 * Access sticks to the numeric id after the first open.
 * A later username change still matches. A different account that picks up the old username does not.
 */
export function bindDecision(
  grants: AdminGrantView[],
  telegramId: string | number,
  username?: string | null,
): { action: "already" | "bind"; grantId: string } | { action: "deny" } | { action: "none" } {
  const id = String(telegramId);
  const active = grants.filter((grant) => !grant.revoked);
  const byId = active.find((grant) => grant.telegramId === id);
  if (byId) return { action: "already", grantId: byId.id };
  const norm = username ? username.trim().replace(/^@/, "").toLowerCase() : "";
  if (!norm) return { action: "none" };
  const byName = active.find((grant) => grant.usernameNorm === norm);
  if (!byName) return { action: "none" };
  if (!byName.telegramId) return { action: "bind", grantId: byName.id };
  return { action: "deny" };
}

export function revokeGuard(
  active: { id: string; role: AdminRole }[],
  targetId: string,
): "ok" | "LAST_OWNER" | "NOT_FOUND" {
  const target = active.find((row) => row.id === targetId);
  if (!target) return "NOT_FOUND";
  const owners = active.filter((row) => row.role === "owner").length;
  if (target.role === "owner" && owners <= 1) return "LAST_OWNER";
  return "ok";
}

export function roleChangeGuard(
  active: { id: string; role: AdminRole }[],
  targetId: string,
  next: AdminRole,
): "ok" | "LAST_OWNER" | "NOT_FOUND" | "SAME" {
  const target = active.find((row) => row.id === targetId);
  if (!target) return "NOT_FOUND";
  if (target.role === next) return "SAME";
  if (target.role === "owner" && next !== "owner") {
    const owners = active.filter((row) => row.role === "owner").length;
    if (owners <= 1) return "LAST_OWNER";
  }
  return "ok";
}
