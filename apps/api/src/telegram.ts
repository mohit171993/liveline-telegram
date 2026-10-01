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
