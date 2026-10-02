import { prisma } from "@liveline/db";

/** Small key/value store for admin-tunable automation (on/off + JSON config), backed by AutoRule. */
export async function getRule<T extends object>(key: string, defaults: { enabled: boolean; config: T }): Promise<{ enabled: boolean; config: T }> {
  const row = await prisma.autoRule.findUnique({ where: { key } }).catch(() => null);
  if (!row) return { enabled: defaults.enabled, config: { ...defaults.config } };
  let config: Partial<T> = {};
  try { config = JSON.parse(row.config || "{}") as Partial<T>; } catch { config = {}; }
  return { enabled: row.enabled, config: { ...defaults.config, ...config } };
}

export async function setRule(key: string, value: { enabled: boolean; config: object }, actor?: string) {
  const config = JSON.stringify(value.config).slice(0, 20_000);
  await prisma.autoRule.upsert({
    where: { key },
    update: { enabled: value.enabled, config, updatedBy: actor || null },
    create: { key, enabled: value.enabled, config, updatedBy: actor || null },
  });
}

/** Admin DM alerts: new /start (unverified) and new verified user. Both default ON. */
export const ALERT_KEYS = ["alert_new_start", "alert_verified"] as const;
export type AlertKey = (typeof ALERT_KEYS)[number];

export async function alertSettings(): Promise<Record<AlertKey, boolean>> {
  const [start, verified] = await Promise.all([
    getRule("alert_new_start", { enabled: true, config: {} }),
    getRule("alert_verified", { enabled: true, config: {} }),
  ]);
  return { alert_new_start: start.enabled, alert_verified: verified.enabled };
}

export async function setAlertSetting(key: AlertKey, enabled: boolean, actor?: string) {
  if (!(ALERT_KEYS as readonly string[]).includes(key)) throw new Error("BAD_KEY");
  await setRule(key, { enabled, config: {} }, actor);
  return alertSettings();
}

/** Per-admin alert preferences (default: every admin gets every alert type). */
export type AlertKind = "start" | "verified";
export type AdminAlertPrefs = Record<string, Partial<Record<AlertKind, boolean>>>;
export async function adminAlertPrefs(): Promise<AdminAlertPrefs> {
  return (await getRule<{ prefs: AdminAlertPrefs }>("alert_admin_prefs", { enabled: true, config: { prefs: {} } })).config.prefs || {};
}
export function wantsAlert(prefs: AdminAlertPrefs, chatId: string, kind: AlertKind) {
  return prefs[chatId]?.[kind] !== false;
}
export async function setAdminAlertPref(chatId: string, kind: AlertKind, enabled: boolean, actor?: string) {
  const prefs = await adminAlertPrefs();
  prefs[chatId] = { ...(prefs[chatId] || {}), [kind]: enabled };
  await setRule("alert_admin_prefs", { enabled: true, config: { prefs } }, actor);
  return prefs;
}

/** +9198•••••210: keeps the first 4 and last 3 digits only (country code stays readable). */
export function maskPhone(phone?: string | null): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "not shared";
  if (digits.length < 8) return "•••";
  return `+${digits.slice(0, 4)}${"•".repeat(digits.length - 7)}${digits.slice(-3)}`;
}
