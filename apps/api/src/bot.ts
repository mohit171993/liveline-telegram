import http from "http";
import path from "path";
import { Bot, InlineKeyboard, InputFile, Keyboard } from "grammy";
import { prisma } from "@liveline/db";
import { liveScoreCard, projectMatch, squadCode } from "@liveline/shared";
import { env, telegramDryRun, channelUrl, miniAppLink } from "./env";
import { readUniverse } from "./feed";
import { redis } from "./redis";
import { verifyPhone, touchFromInit, userIsAdmin } from "./services/users";
import { pinLive, upsertSquad } from "./services/play";
import { rememberChannelPost } from "./services/reports";
import { adminChatIds } from "./services/admins";
import { confirmBroadcast, createBroadcast, findUserBrief, cancelBroadcast } from "./services/crm";
import { maskPhone } from "./services/automation";
import { sendVerifyCard, VERIFY_CAPTION } from "./verifyCard";
import { formatIst } from "@liveline/shared";
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
  return new Keyboard().requestContact("✅ Share phone to verify").success().resized().persistent().oneTime(false);
}

function openLiveLine(url: string, kind: "web" | "url") {
  const keyboard = new InlineKeyboard();
  if (kind === "web") keyboard.webApp("🏏 Open LiveLine", url);
  else keyboard.url("🏏 Open LiveLine", url);
  return keyboard.primary();
}

// ---------- Welcome card ----------
const WELCOME_IMAGE = path.resolve(__dirname, "../assets/welcome.jpg");
const WELCOME_FILE_KEY = "ll:bot:welcome-file:v1";

export const WELCOME_CAPTION = [
  "<b>🏏 Welcome to LiveLine Pro</b>",
  "<i>The live line, without the noise.</i>",
  "",
  "⚡ <b>Live line</b>, ball by ball",
  "🎯 <b>Free predictions</b> and a live leaderboard",
  "🎡 <b>Free daily spin</b> and rewards",
  "🤖 <b>Lino</b>, your AI match buddy",
  "",
  "<b>18+ · Free to play · No betting</b>",
].join("\n");

const HOW_IT_WORKS = [
  "<b>ℹ️ How LiveLine Pro works</b>",
  "",
  "1️⃣ Tap <b>✅ Share phone to verify</b> below. One tap, Telegram sends it.",
  "2️⃣ Accept the terms in the app (18+).",
  "3️⃣ Follow live matches ball by ball, predict for free, climb the leaderboard.",
  "4️⃣ Spin the free daily wheel for points and perks. Ask Lino anything about the match.",
  "",
  "No deposits, no betting, no cash. Points are free and have no money value.",
].join("\n");

function escHtml(value: string): string {
  return value.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));
}

function channelLink() {
  return channelUrl() || "https://t.me/LiveLine_Pro";
}

function inviteLink(telegramId: number) {
  const ref = `https://t.me/${env.botUsername}?start=ref_${telegramId}`;
  const text = "Join me on LiveLine Pro: live cricket line, free predictions and a free daily spin. 18+, no betting.";
  return `https://t.me/share/url?url=${encodeURIComponent(ref)}&text=${encodeURIComponent(text)}`;
}

/**
 * Unverified welcome banner: ONE big green "✅ Verify now" button. It opens the Mini App's
 * verify screen, where a single tap accepts terms/18+ and calls WebApp.requestContact()
 * (the signed contact is checked server-side, and the bot also gets the contact message).
 */
function guestKeyboard() {
  return new InlineKeyboard().webApp("✅ Verify now", webApp("/verify")).success();
}

/** Verify card caption + the links that used to sit on the welcome banner. */
function verifyCardCaption() {
  return `${VERIFY_CAPTION}\n\n📢 <a href="${escHtml(channelLink())}">Join @LiveLine_Pro</a>  ·  ℹ️ /help how it works`;
}

/** Verified home grid: 2 columns, every button opens the Mini App deep link. */
function homeKeyboard(telegramId: number, admin = false) {
  const kb = homeGrid(telegramId);
  if (admin) kb.row().webApp("🛠 Admin panel", webApp("/admin")).danger();
  return kb;
}

function homeGrid(telegramId: number) {
  return new InlineKeyboard()
    .url("🏏 Live Scores", miniAppLink("live")).primary()
    .url("🎯 Predict", miniAppLink("predict")).success()
    .row()
    .url("🎡 Free Spin", miniAppLink("spin")).success()
    .url("🏆 Leaderboard", miniAppLink("board"))
    .row()
    .url("🔔 Reminders", miniAppLink("alerts"))
    .url("🤖 Ask Lino", miniAppLink("lino"))
    .row()
    .url("📢 Channel", channelLink())
    .url("👥 Invite friends", inviteLink(telegramId)).primary();
}

/** Send the welcome card; upload once, then reuse Telegram's file_id. */
async function sendWelcome(api: Bot["api"], chatId: number, replyMarkup: InlineKeyboard) {
  const cached = await redis.get(WELCOME_FILE_KEY).catch(() => null);
  try {
    const msg = await api.sendPhoto(chatId, cached || new InputFile(WELCOME_IMAGE), {
      caption: WELCOME_CAPTION,
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
    const fileId = msg.photo?.[msg.photo.length - 1]?.file_id;
    if (!cached && fileId) await redis.set(WELCOME_FILE_KEY, fileId).catch(() => undefined);
  } catch (err) {
    if (cached) await redis.del(WELCOME_FILE_KEY).catch(() => undefined);
    console.error(JSON.stringify({ level: "warn", msg: "welcome-photo", err: String(err) }));
    await api.sendMessage(chatId, WELCOME_CAPTION, { parse_mode: "HTML", reply_markup: replyMarkup });
  }
}

async function isVerified(telegramId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { telegramId: String(telegramId) }, select: { phoneVerifiedAt: true } });
  return Boolean(user?.phoneVerifiedAt);
}

export function createBot() {
  const bot = new Bot(env.botToken || "0:MOCK");

  // Reachability: a user who blocks the bot is skipped by reminders/broadcasts; talking to us again clears it.
  bot.on("my_chat_member", async (ctx) => {
    if (ctx.chat?.type !== "private" || !ctx.from) return;
    const status = ctx.myChatMember.new_chat_member.status;
    await prisma.user.updateMany({
      where: { telegramId: String(ctx.from.id) },
      data: { botBlockedAt: status === "kicked" ? new Date() : null },
    }).catch(() => undefined);
  });
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type === "private" && ctx.from && (ctx.message || ctx.callbackQuery)) {
      await prisma.user.updateMany({ where: { telegramId: String(ctx.from.id), botBlockedAt: { not: null } }, data: { botBlockedAt: null } }).catch(() => undefined);
    }
    return next();
  });

  // Gate: in a private chat, an unverified user gets the verify keyboard again on any
  // message, command (except /start, handled below) or button tap. Contacts pass through.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private" || !ctx.from || ctx.from.is_bot) return next();
    if (ctx.message?.contact) return next();
    if (ctx.callbackQuery?.data === "howto") return next();
    if (/^\/help(@\w+)?(\s|$)/.test(ctx.message?.text || "")) return next();
    const text = ctx.message?.text || "";
    if (/^\/start(@\w+)?(\s|$)/.test(text)) return next();
    // /admin answers listed admins even before phone verification; /stop and /resume always work.
    if (/^\/(admin|stop|resume)(@\w+)?(\s|$)/.test(text)) return next();
    if (ctx.callbackQuery?.data?.startsWith("adm:")) return next();
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
        await sendWelcome(ctx.api, ctx.chat.id, guestKeyboard());
        // Big, highlighted verify prompt: branded image card + bold/blockquote caption,
        // carrying the persistent green "Share phone to verify" reply keyboard.
        const sent = await sendVerifyCard(ctx.chat.id, verifyCardCaption(), verifyKeyboard());
        if (!sent.ok) {
          await ctx.reply(verifyCardCaption(), { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: verifyKeyboard() });
        }
        return;
      }
      await setChatMenu(ctx.api, ctx.chat.id, true);
      const isAdmin = await userIsAdmin(ctx.from!.id, ctx.from!.username);
      await sendWelcome(ctx.api, ctx.chat.id, homeKeyboard(ctx.from!.id, isAdmin));
      if (user.optOut) await ctx.reply("🔕 Reminders are off. Send /resume to turn them back on.");
      return;
    }
    const link = miniAppLink(`grp_${ctx.chat.id}`);
    await ctx.reply("Open LiveLine for the live line, predictions, and reminders.", {
      reply_markup: openLiveLine(link, "url"),
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
      await sendWelcome(ctx.api, ctx.chat.id, homeKeyboard(ctx.from.id, await userIsAdmin(ctx.from.id, ctx.from.username)));
    } catch (err) {
      await ctx.reply(err instanceof Error ? err.message : "Could not verify that contact.", {
        reply_markup: verifyKeyboard(),
      });
    }
  });

  bot.callbackQuery("howto", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => undefined);
    const verified = ctx.from ? await isVerified(ctx.from.id) : false;
    await ctx.reply(HOW_IT_WORKS, {
      parse_mode: "HTML",
      ...(verified || ctx.chat?.type !== "private" ? {} : { reply_markup: verifyKeyboard() }),
    });
  });

  bot.command("help", async (ctx) => {
    const verified = ctx.from ? await isVerified(ctx.from.id) : false;
    await ctx.reply(HOW_IT_WORKS, {
      parse_mode: "HTML",
      reply_markup: verified || ctx.chat.type !== "private" ? homeKeyboard(ctx.from?.id || 0) : verifyKeyboard(),
    });
  });

  const shortcut = (command: string, label: string, param: string, text: string) =>
    bot.command(command, async (ctx) => {
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: new InlineKeyboard().url(label, miniAppLink(param)).primary() });
    });
  shortcut("predict", "🎯 Predict", "predict", "🎯 <b>Free predictions</b>. Call the next ball, the over and the result.");
  shortcut("spin", "🎡 Free Spin", "spin", "🎡 <b>Your free daily spin</b> is waiting. Points and perks, no cash.");
  shortcut("leaderboard", "🏆 Leaderboard", "board", "🏆 <b>Leaderboard</b>. See where you rank today.");
  shortcut("reminders", "🔔 Reminders", "alerts", "🔔 <b>Reminders</b>. Get pinged for toss, wickets and results.");

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

  bot.on(["channel_post", "edited_channel_post"], async (ctx) => {
    const post = ctx.channelPost || ctx.editedChannelPost;
    if (!post) return;
    const views = "views" in post ? Number(post.views || 0) : 0;
    const text = "text" in post ? post.text || "" : "";
    await rememberChannelPost({
      chatId: String(post.chat.id),
      messageId: post.message_id,
      kind: "channel",
      text,
      views,
      postedAt: new Date(post.date * 1000),
    }).catch(() => undefined);
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
    await ctx.reply("Sponsor manager", { reply_markup: new InlineKeyboard().webApp("🏏 Open ad manager", webApp("/admin")).primary() });
  });

  bot.command("stop", async (ctx) => {
    if (ctx.chat.type !== "private" || !ctx.from) return;
    await prisma.user.updateMany({ where: { telegramId: String(ctx.from.id) }, data: { optOut: true } });
    await ctx.reply("🔕 Done. No more reminders or announcements from us.\nYou can still use the app any time. Send /resume to turn reminders back on.");
  });

  bot.command("resume", async (ctx) => {
    if (ctx.chat.type !== "private" || !ctx.from) return;
    await prisma.user.updateMany({ where: { telegramId: String(ctx.from.id) }, data: { optOut: false } });
    await ctx.reply("🔔 Reminders are back on. Max 2 a day, never at night. Send /stop any time.");
  });

  // /admin: listed admins only (silent for everyone else). Shortcuts:
  //   /admin find @handle | <telegram id>
  //   /admin broadcast <text>   → draft to all verified users, sends only after ✅ Confirm
  bot.command("admin", async (ctx) => {
    if (ctx.chat.type !== "private" || !ctx.from) return;
    if (!(await userIsAdmin(ctx.from.id, ctx.from.username))) return;
    const arg = (ctx.match || "").trim();
    const [sub, ...rest] = arg.split(/\s+/);
    const tail = arg.slice(sub.length).trim();
    if (sub === "find" && rest.length) {
      const hit = await findUserBrief(tail);
      if (!hit) return ctx.reply(`No user matches <code>${escHtml(tail)}</code>.`, { parse_mode: "HTML" });
      const u = hit.user;
      const lines = [
        `👤 <b>${escHtml([u.firstName, u.lastName].filter(Boolean).join(" ") || "—")}</b>${u.username ? ` @${escHtml(u.username)}` : ""}`,
        `ID: <code>${u.telegramId}</code> · ${u.phoneVerifiedAt ? "✅ verified" : "⏳ not verified"} · ${u.status}`,
        `Phone: ${escHtml(maskPhone(u.phone))} · Lang: ${u.languageCode}${u.isPremium ? " · ⭐ Premium" : ""}`,
        `Source: ${escHtml(u.startParam || "direct")}`,
        `Points: ${u.points} · Predictions: ${u._count.predictions} · Spins: ${u._count.spins}`,
        `Joined: ${formatIst(u.createdAt)} IST`,
        `Last seen: ${u.lastSeenAt ? `${formatIst(u.lastSeenAt)} IST` : "—"}`,
        u.optOut ? "🔕 Opted out of reminders" : "",
        u.botBlockedAt ? "⛔ Has blocked the bot" : "",
        hit.tags.length ? `Tags: ${hit.tags.map(escHtml).join(", ")}` : "",
      ].filter(Boolean);
      return ctx.reply(lines.join("\n"), {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().webApp("📇 Open CRM profile", webApp(`/admin/crm/user/${u.id}`)).primary(),
      });
    }
    if (sub === "broadcast" && rest.length) {
      try {
        const draft = await createBroadcast({ text: tail, filter: { verified: "yes" } }, String(ctx.from.id));
        return ctx.reply(
          `📣 <b>Broadcast draft</b> to <b>${draft.total}</b> verified, reachable users (opted-out and blocked users are skipped):\n\n${draft.html}\n\nNothing is sent until you tap ✅ Confirm.`,
          {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard()
              .text(`✅ Confirm & send to ${draft.total}`, `adm:bc:yes:${draft.id}`).success()
              .row()
              .text("✖️ Cancel", `adm:bc:no:${draft.id}`).danger(),
          },
        );
      } catch (err) {
        return ctx.reply(`Could not create the draft: ${escHtml(err instanceof Error ? err.message : String(err))}`, { parse_mode: "HTML" });
      }
    }
    await ctx.reply(
      [
        "🛠 <b>LiveLine Pro admin</b>",
        "",
        "Shortcuts:",
        "• <code>/admin find @handle</code> or <code>/admin find 123456789</code>",
        "• <code>/admin broadcast Your message</code> (draft → you confirm)",
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .webApp("🛠 Open Admin panel", webApp("/admin")).primary()
          .row()
          .webApp("📇 CRM users", webApp("/admin/crm"))
          .webApp("📣 Broadcasts", webApp("/admin/broadcasts"))
          .row()
          .webApp("⚙️ Automations", webApp("/admin/automation"))
          .webApp("📢 Channel", webApp("/admin/channel")),
      },
    );
  });

  bot.callbackQuery(/^adm:bc:(yes|no):(.+)$/, async (ctx) => {
    if (!ctx.from || !(await userIsAdmin(ctx.from.id, ctx.from.username))) return ctx.answerCallbackQuery();
    const [, action, id] = ctx.match as RegExpMatchArray;
    try {
      if (action === "no") {
        await cancelBroadcast(id);
        await ctx.editMessageText("✖️ Broadcast cancelled. Nothing was sent.");
      } else {
        const b = await confirmBroadcast(id, String(ctx.from.id));
        await ctx.editMessageText(`✅ Confirmed. Sending to ${b.total} users at a safe rate. Track delivery and opens in Admin → Broadcasts.`);
      }
      await ctx.answerCallbackQuery();
    } catch (err) {
      await ctx.answerCallbackQuery({ text: err instanceof Error ? err.message.slice(0, 180) : "Failed", show_alert: true });
    }
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
  await bot.api.setMyDescription(
    "🏏 LiveLine Pro: the live cricket line, without the noise.\n\n" +
      "⚡ Live line, ball by ball\n🎯 Free predictions and a live leaderboard\n🎡 Free daily spin and rewards\n🤖 Lino, your AI match buddy\n\n" +
      "18+ · Free to play · No betting. Tap Start to verify and jump in.",
  ).catch((err) => console.error(JSON.stringify({ level: "warn", msg: "setMyDescription", err: String(err) })));
  await bot.api.setMyShortDescription(
    "🏏 Live cricket line, free predictions, a free daily spin and Lino the AI buddy. 18+ · No betting.",
  ).catch((err) => console.error(JSON.stringify({ level: "warn", msg: "setMyShortDescription", err: String(err) })));
  await bot.api.setMyCommands([
    { command: "start", description: "🏠 Home" },
    { command: "live", description: "🔴 Matches in play" },
    { command: "predict", description: "🎯 Free predictions" },
    { command: "spin", description: "🎡 Free daily spin" },
    { command: "leaderboard", description: "🏆 Leaderboard" },
    { command: "reminders", description: "🔔 Match reminders" },
    { command: "help", description: "ℹ️ How it works" },
  ]);
  await bot.api.setMyCommands(
    [
      { command: "live", description: "🔴 Matches in play" },
      { command: "score", description: "📊 Score summary" },
      { command: "pin", description: "📌 Pin a live score here" },
      { command: "squad", description: "👥 Turn this chat into a squad" },
      { command: "help", description: "ℹ️ How it works" },
    ],
    { scope: { type: "all_group_chats" } },
  ).catch(() => undefined);
  // Admins see /admin in their own command menu (chat scope); nobody else does.
  const userCommands = [
    { command: "start", description: "🏠 Home" },
    { command: "live", description: "🔴 Matches in play" },
    { command: "predict", description: "🎯 Free predictions" },
    { command: "spin", description: "🎡 Free daily spin" },
    { command: "leaderboard", description: "🏆 Leaderboard" },
    { command: "reminders", description: "🔔 Match reminders" },
    { command: "help", description: "ℹ️ How it works" },
  ];
  for (const chatId of await adminChatIds().catch(() => [] as string[])) {
    await bot.api.setMyCommands([...userCommands, { command: "admin", description: "🛠 Admin panel & CRM" }], { scope: { type: "chat", chat_id: Number(chatId) } }).catch(() => undefined);
  }
  await bot.start();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
