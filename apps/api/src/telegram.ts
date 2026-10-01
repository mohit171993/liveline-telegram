import { prisma } from "@liveline/db";
import { env, telegramDryRun } from "./env";

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  extra?: Record<string, unknown>,
): Promise<number | null> {
  const payload = JSON.stringify({ text, extra: extra || {} });
  if (telegramDryRun()) {
    await prisma.outboundMessage.create({ data: { chatId: String(chatId), kind: "message", payload } });
    return null;
  }
  const res = await fetch(`https://api.telegram.org/bot${env.botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(extra || {}),
    }),
  });
  const data = await res.json().catch(() => null) as { ok?: boolean; result?: { message_id?: number }; description?: string } | null;
  if (!res.ok || !data?.ok) {
    await prisma.outboundMessage.create({
      data: { chatId: String(chatId), kind: "message_error", payload: JSON.stringify(data || {}).slice(0, 500) },
    });
    return null;
  }
  return data.result?.message_id ?? null;
}

export async function getChatMemberCount(chatId: string): Promise<number | null> {
  if (telegramDryRun() || !chatId) return null;
  const res = await fetch(`https://api.telegram.org/bot${env.botToken}/getChatMemberCount`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId }),
  });
  const data = await res.json().catch(() => null) as { ok?: boolean; result?: number } | null;
  return data?.ok && typeof data.result === "number" ? data.result : null;
}

export async function editTelegramMessage(chatId: string | number, messageId: number, text: string): Promise<void> {
  if (telegramDryRun()) {
    await prisma.outboundMessage.create({
      data: { chatId: String(chatId), kind: "edit", payload: JSON.stringify({ messageId, text }) },
    });
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${env.botToken}/editMessageText`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true }),
  });
  if (res.status === 429) return;
}

export async function sendTelegramPhoto(chatId: string | number, png: Buffer, caption: string): Promise<void> {
  if (telegramDryRun()) {
    await prisma.outboundMessage.create({
      data: { chatId: String(chatId), kind: "photo", payload: JSON.stringify({ caption, bytes: png.length }) },
    });
    return;
  }
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("caption", caption);
  form.set("photo", new Blob([new Uint8Array(png)], { type: "image/png" }), "liveline.png");
  await fetch(`https://api.telegram.org/bot${env.botToken}/sendPhoto`, { method: "POST", body: form });
}

export interface TgResult {
  ok: boolean;
  messageId: number | null;
  /** Telegram error_code (403 = user blocked the bot / chat gone, 429 = flood). */
  code?: number;
  retryAfter?: number;
  description?: string;
}

/** Low-level Bot API call that reports why a send failed (blocked, flood wait, bad request). */
export async function tgCall(method: string, body: Record<string, unknown> | FormData): Promise<TgResult> {
  if (telegramDryRun()) {
    const payload = body instanceof FormData ? JSON.stringify({ caption: body.get("caption"), chat: body.get("chat_id") }) : JSON.stringify(body).slice(0, 2000);
    const chatId = body instanceof FormData ? String(body.get("chat_id")) : String(body.chat_id ?? "");
    await prisma.outboundMessage.create({ data: { chatId, kind: method, payload } });
    return { ok: true, messageId: null };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.botToken}/${method}`, body instanceof FormData
      ? { method: "POST", body, signal: AbortSignal.timeout(20_000) }
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const data = await res.json().catch(() => null) as {
      ok?: boolean; result?: { message_id?: number }; error_code?: number; description?: string; parameters?: { retry_after?: number };
    } | null;
    if (data?.ok) return { ok: true, messageId: data.result?.message_id ?? null };
    return {
      ok: false,
      messageId: null,
      code: data?.error_code ?? res.status,
      retryAfter: data?.parameters?.retry_after,
      description: String(data?.description || res.statusText).slice(0, 300),
    };
  } catch (err) {
    return { ok: false, messageId: null, code: 0, description: String(err).slice(0, 300) };
  }
}

export function sendPhotoCard(chatId: string | number, png: Buffer, caption: string, replyMarkup?: unknown): Promise<TgResult> {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("caption", caption);
  form.set("parse_mode", "HTML");
  if (replyMarkup) form.set("reply_markup", JSON.stringify(replyMarkup));
  form.set("photo", new Blob([new Uint8Array(png)], { type: "image/png" }), "liveline.png");
  return tgCall("sendPhoto", form);
}

/** True when Telegram says this chat will never accept our messages (blocked, deactivated, not found). */
export function isBlocked(result: TgResult): boolean {
  if (result.ok) return false;
  if (result.code === 403) return true;
  return result.code === 400 && /chat not found|user is deactivated|bot can't initiate/i.test(result.description || "");
}
