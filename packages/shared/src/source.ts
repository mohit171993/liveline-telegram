/**
 * Human labels for start/startapp payloads (the raw payload is always stored as-is).
 * First matching rule wins; add new campaigns here.
 */
export const SOURCE_RULES: { match: RegExp; label: string }[] = [
  { match: /^chatgpt/i, label: "ChatGPT" },
  { match: /^live_channel$/i, label: "LiveLine channel" },
  { match: /^(tgads|ads?)[_-]/i, label: "Telegram Ads" },
  { match: /^match_/i, label: "Match link" },
  { match: /^web_verify$|^webverify_/i, label: "Website (Telegram)" },
  { match: /^web_sms$/i, label: "Website (SMS)" },
  { match: /^web_/i, label: "Website" },
  { match: /^ref_?\d+$/i, label: "Referral" },
  { match: /^grp_/i, label: "Group" },
  { match: /^sq_/i, label: "Squad" },
  { match: /^[br]_/i, label: "Message link" },
  { match: /^live_/i, label: "Campaign" },
];

/** Just the label: "ChatGPT", "Direct", or the raw payload when no rule matches. */
export function sourceName(startParam?: string | null): string {
  const raw = (startParam || "").trim();
  if (!raw) return "Direct";
  return SOURCE_RULES.find((r) => r.match.test(raw))?.label || raw;
}

/** Label plus raw payload: "ChatGPT (chatgpt_liveline_01)", "Direct", or the raw payload. */
export function sourceDisplay(startParam?: string | null): string {
  const raw = (startParam || "").trim();
  const name = sourceName(raw);
  return !raw || name === raw ? name : `${name} (${raw})`;
}

/** Stable filter key for a source: "chatgpt", "liveline-channel", "direct", or a slug of the raw payload. */
export function sourceKey(startParam?: string | null): string {
  return sourceName(startParam).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "direct";
}
