import http from "http";
import { Bot, InlineKeyboard, Keyboard } from "grammy";
import { prisma } from "@liveline/db";
import { liveScoreCard, projectMatch, squadCode } from "@liveline/shared";
import { env, telegramDryRun, channelUrl, miniAppLink } from "./env";
import { readUniverse } from "./feed";
import { redis } from "./redis";
import { verifyPhone, touchFromInit, userIsAdmin } from "./services/users";
import { pinLive, upsertSquad } from "./services/play";
import { signInitData } from "@liveline/shared";

/** Per-chat menu button: the Mini App only after the phone is verified, plain commands before. */
async function setChatMenu(api: Bot["api"], chatId: number, verified: boolean) {
  if (telegramDryRun()) return;
  await api
    .setChatMenuButton({
      chat_id: chatId,
      menu_button: verified ? { type: "web_app", text: "Live scores", web_app: { url: env.webappUrl } } : { type: "commands" },
    })
    .catch(() => undefined);
}

function webApp(path = "") {
  return `${env.webappUrl}${path}`;
}

async function ensureUser(from: { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string; is_premium?: boolean }, startParam?: string) {
  const init = signInitData(env.botToken || "bootstrap", {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({
      id: from.id,
      first_name: from.first_name,
      last_name: from.last_name,
      username: from.username,
      language_code: from.language_code,
      is_premium: from.is_premium,
    }),
    ...(startParam ? { start_param: startParam } : {}),
  });
  const { validateInitData } = await import("@liveline/shared");
  const parsed = validateInitData(init, env.botToken || "bootstrap");
  if (!parsed.ok) return null;
  return touchFromInit(parsed);
}

/** Verification keyboard: stays visible (persistent, not one-time) until the phone is verified. */
function verifyKeyboard() {
  return new Keyboard().requestContact("Share phone to verify").resized().persistent().oneTime(false);
}

async function isVerified(telegramId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { telegramId: String(telegramId) }, select: { phoneVerifiedAt: true } });
  return Boolean(user?.phoneVerifiedAt);
}

export function createBot() {
  const bot = new Bot(env.botToken || "0:MOCK");

  // Gate: in a private chat, an unverified user gets the verify keyboard again on any
  // message, command (except /start, handled below) or button tap. Contacts pass through.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private" || !ctx.from || ctx.from.is_bot) return next();
    if (ctx.message?.contact) return next();
    const text = ctx.message?.text || "";
    if (/^\/start(@\w+)?(\s|$)/.test(text)) return next();
    if (!ctx.message && !ctx.callbackQuery) return next();
    if (await isVerified(ctx.from.id)) return next();
    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => undefined);
    await ctx.reply("Verify your phone to continue.", { reply_markup: verifyKeyboard() });
  });

  bot.command("start", async (ctx) => {
    const param = ctx.match?.trim();
    if (ctx.from) await ensureUser(ctx.from, param || undefined);
    const user = ctx.from ? await prisma.user.findUnique({ where: { telegramId: String(ctx.from.id) } }) : null;
    if (ctx.chat.type === "private") {
      if (!user || !user.phoneVerifiedAt) {
        // Unverified: verification first, nothing else. No Mini App entry points yet.
        await setChatMenu(ctx.api, ctx.chat.id, false);
        await ctx.reply("Welcome to LiveLine Pro. Verify your phone to get started.", {
          reply_markup: verifyKeyboard(),
        });
        return;
      }
      await setChatMenu(ctx.api, ctx.chat.id, true);
      await ctx.reply("Open LiveLine for the live line, predictions, and reminders.", {
        reply_markup: new InlineKeyboard().webApp("Open LiveLine", webApp("/")),
      });
      return;
    }
    const link = miniAppLink(`grp_${ctx.chat.id}`);
    await ctx.reply("Open LiveLine for the live line, predictions, and reminders.", {
      reply_markup: new InlineKeyboard().url("Open LiveLine", link),
    });
  });

  bot.on(":contact", async (ctx) => {
    if (!ctx.from || !ctx.message?.contact) return;
    try {
      await ensureUser(ctx.from);
      const user = await verifyPhone(String(ctx.from.id), Number(ctx.message.contact.user_id), ctx.message.contact.phone_number);
      await setChatMenu(ctx.api, ctx.chat.id, true);
      // Only now remove the verification keyboard.
      await ctx.reply(
        user.status === "ACTIVE" ? "You're in." : "You're in. Accept the terms in the app to finish.",
        { reply_markup: { remove_keyboard: true } },
      );
      await ctx.reply("Open LiveLine for the live line, predictions, and reminders.", {
        reply_markup: new InlineKeyboard().webApp("Open LiveLine", webApp("/")),
      });
    } catch (err) {
      await ctx.reply(err instanceof Error ? err.message : "Could not verify that contact.", {
        reply_markup: verifyKeyboard(),
      });
    }
  });

  bot.command("live", async (ctx) => {
    if (ctx.chat.type !== "private" && ctx.chat.id) {
      await prisma.groupChat.upsert({ where: { id: String(ctx.chat.id) }, update: { title: ctx.chat.title || "" }, create: { id: String(ctx.chat.id), title: ctx.chat.title || "" } });
    }
    const matches = await readUniverse();
    const live = matches.filter((m) => m.status === "live").map((m) => projectMatch(m, false));
    if (!live.length) return ctx.reply("No match is live right now.");
    const text = live.map((m) => {
      const line = m.live ? `${m.teams[m.live.batting].code} ${m.live.runs}/${m.live.wickets} (${m.live.overs})` : m.name;
      return `🔴 ${m.name}\n${line}\n${m.live?.need || ""}`;
    }).join("\n\n");
    await ctx.reply(text);
  });

  bot.command("score", async (ctx) => {
    const matches = await readUniverse();
    const query = ctx.match?.trim().toLowerCase();
    const match = matches.find((m) => (query && m.name.toLowerCase().includes(query)) || m.status === "live") || matches[0];
    if (!match) return ctx.reply("No matches on the feed.");
    const view = projectMatch(match, false);
    const body = view.live
      ? `${view.name}\n${view.teams[view.live.batting].code} ${view.live.runs}/${view.live.wickets} (${view.live.overs})\n${view.live.need || `CRR ${view.live.crr}`}`
      : `${view.name}\n${view.result || view.toss}`;
    await ctx.reply(body);
  });

  bot.command("pin", async (ctx) => {
    if (ctx.chat.type === "private") return ctx.reply("Add me to a group or channel, then send /pin. I will keep one pinned score and edit it.");
    const matches = await readUniverse();
    const query = ctx.match?.trim().toLowerCase();
    const match = matches.find((m) => (query && m.name.toLowerCase().includes(query)) || m.status === "live") || matches[0];
    if (!match) return ctx.reply("No match to pin.");
    const pinned = await pinLive(String(ctx.chat.id), match.key);
    await ctx.reply(`Pinned. I will edit that score about every ${5} seconds, inside Telegram's limit.\n\n${pinned.text}`);
  });

  bot.command("squad", async (ctx) => {
    if (ctx.chat.type === "private") return ctx.reply("Add me to the group or channel that should become a squad.");
    const kind = ctx.chat.type === "channel" ? "channel" : "group";
    const squad = await upsertSquad(String(ctx.chat.id), ctx.chat.title || "Squad", kind);
    const link = `https://t.me/LiveLineProBot?start=sq_${squad.referralCode || squadCode(String(ctx.chat.id))}`;
    await ctx.reply(`Squad ready. Points from members add up here. Share ${link}`);
  });

  bot.on("inline_query", async (ctx) => {
    const matches = await readUniverse();
    const q = ctx.inlineQuery.query.trim().toLowerCase();
    const picked = matches.filter((m) => !q || m.name.toLowerCase().includes(q)).slice(0, 6);
    await ctx.answerInlineQuery(
      picked.map((m) => {
        const view = projectMatch(m, false);
        const line = view.live ? `${view.teams[view.live.batting].code} ${view.live.runs}/${view.live.wickets} (${view.live.overs})` : view.result || view.toss;
        const text = liveScoreCard({ name: view.name, status: view.status, line, need: view.live?.need });
        return {
          type: "article" as const,
          id: m.key,
          title: view.name,
          description: line,
          input_message_content: { message_text: text },
        };
      }),
      { cache_time: 5 },
    );
  });

  bot.command("stats", async (ctx) => {
    if (!ctx.from || !(await userIsAdmin(ctx.from.id, ctx.from.username))) return ctx.reply("Admins only.");
    const users = await prisma.user.count({ where: { status: "ACTIVE" } });
    const dau = await prisma.session.findMany({
      where: { startedAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
      distinct: ["userId"],
      select: { userId: true },
    });
    await ctx.reply(`Users ${users}\nSessions 24h ${dau.length}`);
  });

  bot.command("ads", async (ctx) => {
    if (!ctx.from || !(await userIsAdmin(ctx.from.id, ctx.from.username))) return ctx.reply("Admins only.");
    await ctx.reply("Sponsor manager", { reply_markup: new InlineKeyboard().webApp("Open ad manager", webApp("/admin")) });
  });

  bot.command("broadcast", async (ctx) => {
    if (!ctx.from || !(await userIsAdmin(ctx.from.id, ctx.from.username))) return ctx.reply("Admins only.");
    const text = ctx.match?.trim();
    if (!text) return ctx.reply("Usage: /broadcast your message");
    await redis.set(`ll:botbcast:${ctx.from.id}`, text, "EX", 120);
    await ctx.reply(`Send this to every verified user?\n\n${text}`, {
      reply_markup: new InlineKeyboard().text("Confirm", "bcast:yes").text("Cancel", "bcast:no"),
    });
  });

  bot.callbackQuery("bcast:yes", async (ctx) => {
    if (!ctx.from || !(await userIsAdmin(ctx.from.id, ctx.from.username))) return;
    const text = await redis.get(`ll:botbcast:${ctx.from.id}`);
    if (!text) return ctx.answerCallbackQuery({ text: "Expired" });
    await redis.del(`ll:botbcast:${ctx.from.id}`);
    const users = await prisma.user.findMany({ where: { status: "ACTIVE" }, select: { telegramId: true } });
    for (const user of users) {
      await ctx.api.sendMessage(user.telegramId, text).catch(() => undefined);
    }
    await ctx.editMessageText(`Sent to ${users.length} users.`);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("bcast:no", async (ctx) => {
    if (ctx.from) await redis.del(`ll:botbcast:${ctx.from.id}`);
    await ctx.editMessageText("Cancelled.");
    await ctx.answerCallbackQuery();
  });

  bot.catch((err) => console.error(JSON.stringify({ level: "error", msg: "bot", err: String(err) })));
  return bot;
}

async function main() {
  const probe = http.createServer((_req, res) => {
    res.writeHead(200);
    res.end("ok");
  });
  const port = process.env.RAILWAY_ENVIRONMENT ? Number(process.env.PORT || env.botHealthPort) : env.botHealthPort;
  probe.listen(port, "0.0.0.0");
  if (telegramDryRun()) {
    console.log(JSON.stringify({ level: "info", msg: "bot dry-run (mock token)", channel: channelUrl() }));
    return;
  }
  const bot = createBot();
  // Default menu is plain commands; verified users get the Mini App per chat (setChatMenu).
  await bot.api.setChatMenuButton({ menu_button: { type: "commands" } });
  await bot.api.setMyCommands([
    { command: "start", description: "Open LiveLine" },
    { command: "live", description: "Matches in play" },
    { command: "score", description: "Score summary" },
    { command: "pin", description: "Pin a live score in this chat" },
    { command: "squad", description: "Turn this chat into a squad" },
    { command: "stats", description: "Admin stats" },
    { command: "ads", description: "Sponsor manager" },
    { command: "broadcast", description: "Message users" },
  ]);
  await bot.start();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
