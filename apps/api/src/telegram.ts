import { prisma } from "@liveline/db";
import { env, telegramDryRun } from "./env";

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const payload = JSON.stringify({ text, extra: extra || {} });
  if (telegramDryRun()) {
    await prisma.outboundMessage.create({ data: { chatId: String(chatId), kind: "message", payload } });
    return;
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
  if (!res.ok) {
    const body = await res.text();
    await prisma.outboundMessage.create({
      data: { chatId: String(chatId), kind: "message_error", payload: body.slice(0, 500) },
    });
  }
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
