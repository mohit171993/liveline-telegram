import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@liveline/db";
import { findPlayer, istDay, SPORT_MODULES } from "@liveline/shared";
import { env, channelUrl } from "./env";
import { redis } from "./redis";
import { getMatch, listSummaries, readUniverse } from "./feed";
import { httpError } from "./httpError";
import type { authenticate as AuthFn } from "./server";
import { acceptTerms, listUsers, publicUser, setBlocked, setLanguage, usersCsv } from "./services/users";
import { leaderboard, placePrediction, predictionState } from "./services/game";
import { assertCleanCopy, recordAdEvent, reportCsv, reportRows, serveSlot } from "./services/ads";
import { createReminder, deleteReminder, listReminders, updateReminder } from "./services/alerts";
import { askBuddy } from "./services/ai";
import { createPoll, listChat, moderate, postChat, react, votePoll } from "./services/chat";
import { claimVoucher, drawGiveaway, enterGiveaway, openScratch, presentVoucher, refreshBalance, rewardsHome, spinWheel, syncCatalogue } from "./services/rewards";
import { scoreCardSvg, svgToPng } from "./cards";
import { sendTelegramMessage, sendTelegramPhoto } from "./telegram";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const uploads = path.resolve(process.cwd(), "uploads");

export async function registerRoutes(app: FastifyInstance, authenticate: typeof AuthFn) {
  app.get("/api/me", async (req, reply) => {
    const user = await authenticate(req, reply, { registered: false });
    if (!user) return;
    return { user: publicUser(user), channelUrl: channelUrl(), sports: SPORT_MODULES };
  });

  app.post("/api/auth/terms", async (req, reply) => {
    const user = await authenticate(req, reply, { registered: false });
    if (!user) return;
    const body = z.object({ accepted: z.literal(true) }).parse(req.body);
    if (!body.accepted) throw httpError(400, "TERMS");
    return { user: publicUser(await acceptTerms(user.id)) };
  });

  app.post("/api/auth/language", async (req, reply) => {
    const user = await authenticate(req, reply, { registered: false });
    if (!user) return;
    const body = z.object({ language: z.enum(["en", "hi"]) }).parse(req.body);
    return { user: publicUser(await setLanguage(user.id, body.language)) };
  });

  app.get("/api/home", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const [matches, favorites] = await Promise.all([
      listSummaries(),
      prisma.favorite.findMany({ where: { userId: user.id } }),
    ]);
    const series = [...new Map(matches.map((m) => [m.seriesKey, m.seriesName])).entries()].map(([key, name]) => ({ key, name }));
    return { matches, favorites, series, serverTime: Date.now() };
  });

  app.post("/api/favorites", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const body = z.object({ kind: z.enum(["team", "series"]), refKey: z.string().min(1), label: z.string().default("") }).parse(req.body);
    const row = await prisma.favorite.upsert({
      where: { userId_kind_refKey: { userId: user.id, kind: body.kind, refKey: body.refKey } },
      update: { label: body.label },
      create: { userId: user.id, ...body },
    });
    return row;
  });

  app.delete("/api/favorites", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const body = z.object({ kind: z.enum(["team", "series"]), refKey: z.string() }).parse(req.body);
    await prisma.favorite.deleteMany({ where: { userId: user.id, kind: body.kind, refKey: body.refKey } });
    return { ok: true };
  });

  app.get("/api/matches/:key", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const key = (req.params as { key: string }).key;
    const found = await getMatch(key);
    if (!found) throw httpError(404, "NOT_FOUND");
    const day = istDay();
    await prisma.matchViewStat.upsert({
      where: { matchKey_day: { matchKey: key, day } },
      update: { views: { increment: 1 } },
      create: { matchKey: key, day, views: 1 },
    });
    await touchQuiet(user.id, key);
    return found.view;
  });

  app.get("/api/players/:id", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const id = (req.params as { id: string }).id;
    const found = findPlayer(await readUniverse(), id);
    if (!found) throw httpError(404, "NOT_FOUND");
    return found;
  });

  app.get("/api/predictions", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const matchKey = String((req.query as { matchKey?: string }).matchKey || "");
    if (!matchKey) throw httpError(400, "MATCH");
    return predictionState(user.id, matchKey);
  });

  app.post("/api/predictions", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const body = z.object({
      matchKey: z.string(),
      kind: z.enum(["BALL", "OVER", "MATCH"]),
      pick: z.string(),
    }).parse(req.body);
    return placePrediction(user.id, body.matchKey, body.kind, body.pick);
  });

  app.get("/api/leaderboard", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const q = req.query as { scope?: string; matchKey?: string; groupId?: string };
    const rows = await leaderboard(q.scope || "daily", { matchKey: q.matchKey, groupId: q.groupId, userId: user.id });
    const badges = await prisma.badge.findMany({ where: { userId: user.id } });
    return { rows, badges, you: { points: user.points, streak: user.streak } };
  });

  app.post("/api/ai/chat", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const body = z.object({ matchKey: z.string(), message: z.string().min(1).max(500) }).parse(req.body);
    const found = await getMatch(body.matchKey);
    if (!found) throw httpError(404, "NOT_FOUND");
    return askBuddy(user.id, user.languageCode, body.message, found.view);
  });

  app.get("/api/chat/:matchKey", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    return listChat((req.params as { matchKey: string }).matchKey);
  });

  app.post("/api/chat/:matchKey", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const body = z.object({ body: z.string() }).parse(req.body);
    return postChat(user.id, (req.params as { matchKey: string }).matchKey, body.body);
  });

  app.post("/api/chat/:matchKey/react", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const body = z.object({ emoji: z.string() }).parse(req.body);
    return react(user.id, (req.params as { matchKey: string }).matchKey, body.emoji);
  });

  app.post("/api/chat/:matchKey/poll", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const body = z.object({ question: z.string().min(3), options: z.array(z.string()).min(2).max(4) }).parse(req.body);
    return createPoll(user.id, (req.params as { matchKey: string }).matchKey, body.question, body.options);
  });

  app.post("/api/polls/:id/vote", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const body = z.object({ option: z.number().int() }).parse(req.body);
    return votePoll(user.id, (req.params as { id: string }).id, body.option);
  });

  app.post("/api/chat/:matchKey/moderate", async (req, reply) => {
    const user = await authenticate(req, reply, { admin: true });
    if (!user) return;
    const body = z.object({ userId: z.string(), action: z.enum(["mute", "ban", "clear"]), minutes: z.number().optional() }).parse(req.body);
    return moderate(body.userId, (req.params as { matchKey: string }).matchKey, body.action, body.minutes);
  });

  app.get("/api/reminders", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    return listReminders(user.id);
  });

  app.post("/api/reminders", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const body = z.object({
      matchKey: z.string().optional(),
      teamKey: z.string().optional(),
      seriesKey: z.string().optional(),
      minutesBefore: z.number().int().optional(),
      alertTypes: z.array(z.string()).min(1),
      startAt: z.number().optional(),
    }).parse(req.body);
    return createReminder(user.id, body);
  });

  app.patch("/api/reminders/:id", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const body = z.object({
      alertTypes: z.array(z.string()).optional(),
      minutesBefore: z.number().int().optional(),
      startAt: z.number().optional(),
    }).parse(req.body);
    return updateReminder(user.id, (req.params as { id: string }).id, body);
  });

  app.delete("/api/reminders/:id", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    return deleteReminder(user.id, (req.params as { id: string }).id);
  });

  app.get("/api/ads/slot", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const q = req.query as { slot?: string; matchKey?: string; seriesKey?: string; teams?: string };
    if (!q.slot) throw httpError(400, "SLOT");
    const ad = await serveSlot({
      userId: user.id,
      slot: q.slot,
      matchKey: q.matchKey,
      seriesKey: q.seriesKey,
      teamKeys: q.teams ? q.teams.split(",") : [],
      language: user.languageCode,
    });
    return { ad };
  });

  app.post("/api/ads/:id/impression", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    return recordAdEvent(user.id, (req.params as { id: string }).id, "impression");
  });

  app.post("/api/ads/:id/click", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    return recordAdEvent(user.id, (req.params as { id: string }).id, "click");
  });

  app.post("/api/advertise/lead", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const body = z.object({
      name: z.string().min(2),
      brand: z.string().min(2),
      contact: z.string().min(4),
      budget: z.string().optional(),
      message: z.string().min(4),
    }).parse(req.body);
    assertCleanCopy(body.brand, body.message);
    const lead = await prisma.sponsorLead.create({ data: { userId: user.id, ...body, budget: body.budget || "" } });
    const { parseAdminList } = await import("@liveline/shared");
    for (const id of parseAdminList(env.adminRaw).ids) {
      await sendTelegramMessage(id, `📣 Ad lead\n${body.brand}\n${body.name} · ${body.contact}\n${body.message}`).catch(() => undefined);
    }
    return { ok: true, id: lead.id };
  });

  app.post("/api/share/card", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const body = z.object({ matchKey: z.string(), kind: z.enum(["score", "prediction"]).default("score") }).parse(req.body);
    const found = await getMatch(body.matchKey);
    if (!found) throw httpError(404, "NOT_FOUND");
    const svg = scoreCardSvg(found.view, body.kind);
    const png = await svgToPng(svg);
    if (!png) {
      reply.header("content-type", "image/svg+xml");
      return reply.send(svg);
    }
    reply.header("content-type", "image/png");
    return reply.send(png);
  });

  app.post("/api/share/send", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const body = z.object({ matchKey: z.string(), kind: z.enum(["score", "prediction"]).default("score") }).parse(req.body);
    const found = await getMatch(body.matchKey);
    if (!found) throw httpError(404, "NOT_FOUND");
    const svg = scoreCardSvg(found.view, body.kind);
    const png = await svgToPng(svg);
    const caption = `${found.view.name}\n${found.view.live ? found.view.live.need || found.view.live.overs : found.view.result || ""}`;
    if (png) await sendTelegramPhoto(user.telegramId, png, caption);
    else await sendTelegramMessage(user.telegramId, `🏏 ${caption}\n${env.webappUrl}`);
    return { ok: true };
  });

  app.get("/api/rewards", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    return rewardsHome(user.id);
  });
  app.post("/api/rewards/spin", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    return spinWheel(user.id);
  });
  app.post("/api/rewards/scratch/:id", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    return openScratch(user.id, (req.params as { id: string }).id);
  });
  app.post("/api/rewards/giveaways/:id/enter", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    return enterGiveaway(user.id, (req.params as { id: string }).id);
  });
  app.post("/api/rewards/vouchers/:id/claim", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const body = z.object({ email: z.string() }).parse(req.body);
    return claimVoucher(user.id, (req.params as { id: string }).id, body.email);
  });
  app.post("/api/theme", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const body = z.object({ theme: z.string() }).parse(req.body);
    const unlocked = user.unlockedThemes.split(",");
    if (!unlocked.includes(body.theme)) throw httpError(403, "LOCKED_THEME");
    return publicUser(await prisma.user.update({ where: { id: user.id }, data: { theme: body.theme } }));
  });

  app.get("/media/:file", async (req, reply) => {
    const file = path.basename((req.params as { file: string }).file);
    const full = path.join(uploads, file);
    if (!fs.existsSync(full)) throw httpError(404, "NOT_FOUND");
    const ext = path.extname(file).toLowerCase();
    reply.type(ext === ".png" ? "image/png" : ext === ".mp4" ? "video/mp4" : "image/jpeg");
    return reply.send(fs.readFileSync(full));
  });

  await adminRoutes(app, authenticate);
}

async function adminRoutes(app: FastifyInstance, authenticate: typeof AuthFn) {
  app.get("/api/admin/overview", async (req, reply) => {
    const user = await authenticate(req, reply, { admin: true });
    if (!user) return;
    const day = istDay();
    const start = new Date(`${day}T00:00:00+05:30`);
    const [users, active, impressions, clicks, sessions, top, balance, leads] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: "ACTIVE" } }),
      prisma.adEvent.count({ where: { type: "impression" } }),
      prisma.adEvent.count({ where: { type: "click" } }),
      prisma.session.findMany({ where: { startedAt: { gte: start } }, distinct: ["userId"], select: { userId: true } }),
      prisma.matchViewStat.findMany({ where: { day }, orderBy: { views: "desc" }, take: 5 }),
      prisma.giftportBalance.findFirst({ orderBy: { checkedAt: "desc" } }),
      prisma.sponsorLead.count(),
    ]);
    let liveBalance = balance;
    try {
      const fresh = await refreshBalance();
      liveBalance = { balance: String(fresh.balance), currency: fresh.currency, message: fresh.message, id: "live", checkedAt: new Date() };
    } catch { /* keep last snapshot */ }
    return {
      users,
      active,
      dau: sessions.length,
      newToday: await prisma.user.count({ where: { createdAt: { gte: start }, status: "ACTIVE" } }),
      impressions,
      clicks,
      top,
      giftport: liveBalance,
      leads,
    };
  });

  app.get("/api/admin/users", async (req, reply) => {
    const user = await authenticate(req, reply, { admin: true });
    if (!user) return;
    const q = req.query as { q?: string; status?: string };
    const rows = await listUsers(q);
    return { users: rows.map(adminUser) };
  });

  app.get("/api/admin/users.csv", async (req, reply) => {
    const user = await authenticate(req, reply, { admin: true });
    if (!user) return;
    const rows = await listUsers(req.query as { q?: string; status?: string });
    reply.header("content-type", "text/csv");
    reply.header("content-disposition", "attachment; filename=users.csv");
    return reply.send(usersCsv(rows));
  });

  app.post("/api/admin/users/:id/block", async (req, reply) => {
    const admin = await authenticate(req, reply, { admin: true });
    if (!admin) return;
    const body = z.object({ blocked: z.boolean(), reason: z.string().optional() }).parse(req.body);
    return adminUser(await setBlocked((req.params as { id: string }).id, body.blocked, body.reason));
  });

  app.get("/api/admin/advertisers", async (req, reply) => {
    if (!(await authenticate(req, reply, { admin: true }))) return;
    return { advertisers: await prisma.advertiser.findMany({ include: { campaigns: true }, orderBy: { createdAt: "desc" } }) };
  });

  app.post("/api/admin/advertisers", async (req, reply) => {
    if (!(await authenticate(req, reply, { admin: true }))) return;
    const body = z.object({ name: z.string(), brand: z.string(), contact: z.string().optional(), notes: z.string().optional() }).parse(req.body);
    return prisma.advertiser.create({ data: body });
  });

  app.get("/api/admin/campaigns", async (req, reply) => {
    if (!(await authenticate(req, reply, { admin: true }))) return;
    return {
      campaigns: await prisma.campaign.findMany({
        include: { advertiser: true, creatives: true },
        orderBy: { createdAt: "desc" },
      }),
    };
  });

  app.post("/api/admin/campaigns", async (req, reply) => {
    if (!(await authenticate(req, reply, { admin: true }))) return;
    const body = z.object({
      advertiserId: z.string().optional(),
      brand: z.string().optional(),
      name: z.string().min(2),
      status: z.enum(["draft", "active", "paused", "ended"]).default("active"),
      startAt: z.string().optional(),
      endAt: z.string().optional(),
      budget: z.number().int().default(0),
      flatFee: z.number().int().default(0),
      creative: z.object({
        type: z.string().default("native"),
        slot: z.string().default("home_native"),
        headline: z.string().min(2),
        body: z.string().default(""),
        mediaUrl: z.string().optional(),
        clickUrl: z.string().optional(),
        cta: z.string().default("Learn more"),
        frequencyCap: z.number().int().default(4),
        matchKeys: z.string().default(""),
        seriesKeys: z.string().default(""),
        teamKeys: z.string().default(""),
        languages: z.string().default(""),
      }),
    }).parse(req.body);
    assertCleanCopy(body.name, body.creative.headline, body.creative.body);
    let advertiserId = body.advertiserId;
    if (!advertiserId) {
      const advertiser = await prisma.advertiser.create({
        data: { name: body.brand || body.name, brand: body.brand || body.name },
      });
      advertiserId = advertiser.id;
    }
    const campaign = await prisma.campaign.create({
      data: {
        advertiserId,
        name: body.name,
        status: body.status,
        startAt: body.startAt ? new Date(body.startAt) : new Date(),
        endAt: body.endAt ? new Date(body.endAt) : null,
        budget: body.budget,
        flatFee: body.flatFee,
        creatives: { create: body.creative },
      },
      include: { creatives: true, advertiser: true },
    });
    return campaign;
  });

  app.patch("/api/admin/campaigns/:id", async (req, reply) => {
    if (!(await authenticate(req, reply, { admin: true }))) return;
    const body = z.object({ status: z.enum(["draft", "active", "paused", "ended"]).optional(), name: z.string().optional() }).parse(req.body);
    return prisma.campaign.update({ where: { id: (req.params as { id: string }).id }, data: body });
  });

  app.post("/api/admin/media", async (req, reply) => {
    if (!(await authenticate(req, reply, { admin: true }))) return;
    const file = await req.file();
    if (!file) throw httpError(400, "FILE");
    const ext = path.extname(file.filename || "").toLowerCase() || ".bin";
    if (![".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4"].includes(ext)) throw httpError(400, "TYPE");
    const buf = await file.toBuffer();
    const name = `${randomBytes(8).toString("hex")}${ext}`;
    if (env.s3Bucket && env.s3Endpoint) {
      const client = new S3Client({
        region: env.s3Region,
        endpoint: env.s3Endpoint,
        credentials: { accessKeyId: env.s3Access, secretAccessKey: env.s3Secret },
        forcePathStyle: true,
      });
      await client.send(new PutObjectCommand({ Bucket: env.s3Bucket, Key: name, Body: buf, ContentType: file.mimetype }));
      return { url: `${env.s3Public || env.s3Endpoint}/${env.s3Bucket}/${name}` };
    }
    fs.mkdirSync(uploads, { recursive: true });
    fs.writeFileSync(path.join(uploads, name), buf);
    return { url: `/media/${name}` };
  });

  app.get("/api/admin/reports", async (req, reply) => {
    if (!(await authenticate(req, reply, { admin: true }))) return;
    const campaignId = (req.query as { campaignId?: string }).campaignId;
    return { rows: await reportRows(campaignId) };
  });

  app.get("/api/admin/reports.csv", async (req, reply) => {
    if (!(await authenticate(req, reply, { admin: true }))) return;
    const rows = await reportRows((req.query as { campaignId?: string }).campaignId);
    reply.header("content-type", "text/csv");
    return reply.send(reportCsv(rows));
  });

  app.post("/api/admin/reports/share", async (req, reply) => {
    const user = await authenticate(req, reply, { admin: true });
    if (!user) return;
    const body = z.object({ campaignId: z.string().optional() }).parse(req.body || {});
    const token = randomBytes(16).toString("hex");
    await prisma.shareReport.create({ data: { token, campaignId: body.campaignId, createdBy: user.id } });
    return { url: `${env.webappUrl}/report/${token}`, token };
  });

  app.get("/api/reports/:token", async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const token = (req.params as { token: string }).token;
    const report = await prisma.shareReport.findUnique({ where: { token } });
    if (!report) throw httpError(404, "NOT_FOUND");
    return { rows: await reportRows(report.campaignId || undefined), sharedAt: report.createdAt };
  });

  app.get("/api/admin/rewards", async (req, reply) => {
    if (!(await authenticate(req, reply, { admin: true }))) return;
    const [tables, giveaways, audits] = await Promise.all([
      prisma.prizeTable.findMany({ include: { prizes: true } }),
      prisma.giveaway.findMany({ include: { entries: true } }),
      prisma.rewardAudit.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
    ]);
    return { tables, giveaways, audits };
  });

  app.post("/api/admin/prize-tables", async (req, reply) => {
    if (!(await authenticate(req, reply, { admin: true }))) return;
    const body = z.object({
      name: z.string(),
      kind: z.enum(["wheel", "scratch"]),
      sponsorName: z.string().optional(),
      dailyCap: z.number().int().default(5000),
      budgetInr: z.number().int().default(0),
      prizes: z.array(z.object({
        label: z.string(),
        kind: z.string(),
        weight: z.number().int(),
        points: z.number().int().default(0),
        themeKey: z.string().optional(),
        badgeKey: z.string().optional(),
        operatorCode: z.string().optional(),
        amountInr: z.number().int().optional(),
        inventory: z.number().int().optional(),
      })),
    }).parse(req.body);
    return prisma.prizeTable.create({ data: { ...body, prizes: { create: body.prizes } }, include: { prizes: true } });
  });

  app.patch("/api/admin/prizes/:id", async (req, reply) => {
    if (!(await authenticate(req, reply, { admin: true }))) return;
    const body = z.object({
      weight: z.number().int().optional(),
      inventory: z.number().int().nullable().optional(),
      active: z.boolean().optional(),
      label: z.string().optional(),
    }).parse(req.body);
    return prisma.prize.update({ where: { id: (req.params as { id: string }).id }, data: body });
  });

  app.get("/api/admin/giftport/catalogue", async (req, reply) => {
    if (!(await authenticate(req, reply, { admin: true }))) return;
    return { items: await prisma.giftCatalogueItem.findMany({ orderBy: { brandName: "asc" } }) };
  });

  app.post("/api/admin/giftport/sync", async (req, reply) => {
    if (!(await authenticate(req, reply, { admin: true }))) return;
    return { items: await syncCatalogue() };
  });

  app.get("/api/admin/fulfilment", async (req, reply) => {
    if (!(await authenticate(req, reply, { admin: true }))) return;
    const orders = await prisma.voucherOrder.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { user: true } });
    return { orders: orders.map((o) => ({ ...presentVoucher(o, true), user: o.user.telegramId, attempt: o.attempt })) };
  });

  app.post("/api/admin/fulfilment/:id/retry", async (req, reply) => {
    if (!(await authenticate(req, reply, { admin: true }))) return;
    const { fulfil } = await import("./services/rewards");
    const order = await fulfil((req.params as { id: string }).id);
    return presentVoucher(order, true);
  });

  app.post("/api/admin/giveaways/:id/draw", async (req, reply) => {
    if (!(await authenticate(req, reply, { admin: true }))) return;
    return drawGiveaway((req.params as { id: string }).id);
  });

  app.post("/api/admin/broadcast", async (req, reply) => {
    const admin = await authenticate(req, reply, { admin: true });
    if (!admin) return;
    const body = z.object({ text: z.string().min(1).max(1000), confirmToken: z.string().optional() }).parse(req.body);
    const key = `ll:bcast:${admin.id}`;
    if (!body.confirmToken) {
      const token = randomBytes(8).toString("hex");
      await redis.set(key, JSON.stringify({ token, text: body.text }), "EX", 120);
      return { confirmToken: token, preview: body.text, recipients: await prisma.user.count({ where: { status: "ACTIVE" } }) };
    }
    const saved = await redis.get(key);
    if (!saved) throw httpError(409, "CONFIRM_EXPIRED");
    const parsed = JSON.parse(saved) as { token: string; text: string };
    if (parsed.token !== body.confirmToken || parsed.text !== body.text) throw httpError(409, "CONFIRM_MISMATCH");
    await redis.del(key);
    const users = await prisma.user.findMany({ where: { status: "ACTIVE" }, select: { telegramId: true } });
    let sent = 0;
    for (const row of users) {
      await sendTelegramMessage(row.telegramId, body.text).catch(() => undefined);
      sent += 1;
    }
    return { ok: true, sent };
  });
}

function adminUser(user: {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string;
  phone: string | null;
  isPremium: boolean;
  startParam: string | null;
  status: string;
  points: number;
  createdAt: Date;
}) {
  return {
    id: user.id,
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    language: user.languageCode,
    phone: user.phone,
    isPremium: user.isPremium,
    startParam: user.startParam,
    status: user.status,
    points: user.points,
    joinedAt: user.createdAt,
  };
}

async function touchQuiet(userId: string, matchKey: string) {
  await prisma.session.updateMany({
    where: { userId, lastSeen: { gte: new Date(Date.now() - 30 * 60_000) } },
    data: { matchKey },
  });
}
