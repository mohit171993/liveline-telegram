import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { httpError } from "./httpError";
import type { authenticate as AuthFn } from "./server";
import {
  addNote, addTag, attribution, audienceCount, bulkTag, cancelBroadcast, confirmBroadcast, createBroadcast, crmCsv, crmProfile,
  deleteSegment, filterOptions, funnel, getBroadcast, listBroadcasts, listCrmUsers, listSegments, parseFilter, removeTag,
  saveSegment, testBroadcast, toCsv, trackOpen, updateBroadcast,
} from "./services/crm";
import { automationState, previewRule, testRule, updateAutomation } from "./services/reminders";
import { alertSettings, setAlertSetting, setAdminAlertPref, ALERT_KEYS } from "./services/automation";
import { adminChatIds } from "./services/admins";
import { adminAlertStatus, alertAdmins } from "./services/users";
import crypto from "crypto";
import { redis } from "./redis";
import { env } from "./env";
import { createSponsor, deleteSponsor, getSponsorForUser, listSponsors, liveSponsors, publicSponsor, recordTap, sponsorGo, sponsorGoUrl, sponsorInput, sponsorReport, updateSponsor } from "./services/sponsors";
import { channelLog, channelSettings, channelStats, sendTestCard, updateChannelSettings } from "./services/channel";

function q(req: { query: unknown }) {
  const raw = req.query as Record<string, string>;
  if (raw.filter) {
    try { return parseFilter(JSON.parse(raw.filter)); } catch { /* fallthrough */ }
  }
  return parseFilter(raw);
}

export async function crmRoutes(app: FastifyInstance, authenticate: typeof AuthFn) {
  const admin = (req: Parameters<typeof AuthFn>[0], reply: Parameters<typeof AuthFn>[1]) => authenticate(req, reply, { admin: true });

  // Deep-link open tracking (any signed-in user, registered or not).
  app.post("/api/track/open", async (req, reply) => {
    const user = await authenticate(req, reply, { registered: false });
    if (!user) return;
    const body = z.object({ param: z.string().max(64) }).parse(req.body);
    return trackOpen(body.param, user.id);
  });

  app.get("/api/admin/crm/users", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const page = Number((req.query as { page?: string }).page || 0) || 0;
    return listCrmUsers(q(req), page, 50);
  });
  app.get("/api/admin/crm/options", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return filterOptions();
  });
  app.get("/api/admin/crm/users.csv", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename=${crmFileName()}`);
    const out = await crmCsv(q(req));
    reply.header("x-row-count", String(out.count));
    return reply.send(out.csv);
  });
  app.get("/api/admin/crm/users/:id", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return crmProfile((req.params as { id: string }).id);
  });
  app.post("/api/admin/crm/users/:id/tags", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    const body = z.object({ tag: z.string().min(1).max(40), remove: z.boolean().optional() }).parse(req.body);
    const id = (req.params as { id: string }).id;
    return body.remove ? removeTag(id, body.tag) : addTag(id, body.tag, me.telegramId);
  });
  app.post("/api/admin/crm/users/:id/notes", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    const body = z.object({ body: z.string().min(1).max(2000) }).parse(req.body);
    return addNote((req.params as { id: string }).id, body.body, { id: me.telegramId, name: me.username ? `@${me.username}` : me.firstName || me.telegramId });
  });
  app.post("/api/admin/crm/bulk-tag", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    const body = z.object({ tag: z.string().min(1).max(40), filter: z.unknown() }).parse(req.body);
    return bulkTag(parseFilter(body.filter), body.tag, me.telegramId);
  });

  // Telegram webviews can't save a fetch() blob reliably: mint a short-lived (10 min) random-token
  // link instead, opened with WebApp.downloadFile (or openLink / the browser). The token is the only
  // credential, so it allows a few GETs (Telegram may probe the URL before downloading) then dies.
  app.post("/api/admin/crm/export", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    const body = z.object({ kind: z.enum(["users", "attribution"]), filter: z.unknown().optional(), days: z.number().int().optional() }).parse(req.body);
    const token = crypto.randomBytes(24).toString("base64url");
    await redis.set(`ll:export:${token}`, JSON.stringify({ ...body, by: me.telegramId }), "EX", 600);
    const host = env.publicApiUrl || `https://${req.headers.host}`; // export links
    const fileName = body.kind === "users" ? crmFileName() : "liveline-attribution.csv";
    return { url: `${host.replace(/^http:\/\//, "https://")}/api/export/${token}/${fileName}`, fileName, expiresInSec: 600 };
  });
  const exportHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const token = (req.params as { token: string }).token;
    const key = `ll:export:${token}`;
    const raw = await redis.get(key);
    if (!raw) return reply.code(404).type("text/plain").send("This download link has expired. Tap Download CSV again in the Admin panel.");
    if (req.method === "GET") {
      const uses = await redis.incr(`${key}:n`);
      if (uses === 1) await redis.expire(`${key}:n`, 600);
      if (uses > 5) { await redis.del(key); return reply.code(404).type("text/plain").send("This download link was already used."); }
    }
    const body = JSON.parse(raw) as { kind: string; filter?: unknown; days?: number };
    let csv: string;
    let count = 0;
    if (body.kind === "users") ({ csv, count } = await crmCsv(parseFilter(body.filter)));
    else {
      const a = await attribution(body.days || 30);
      csv = toCsv(["source", "started", "verified", "verify_rate_%", "predicted", "predict_rate_%", "returned", "return_rate_%"],
        a.rows.map((r) => [r.source, r.started, r.verified, r.verifyRate, r.predicted, r.predictRate, r.returned, r.returnRate]));
      count = a.rows.length;
    }
    const fileName = body.kind === "users" ? crmFileName() : "liveline-attribution.csv";
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename=${fileName}`);
    reply.header("cache-control", "no-store");
    reply.header("x-row-count", String(count));
    return reply.send(csv);
  };
  app.get("/api/export/:token", exportHandler);
  app.get("/api/export/:token/:file", exportHandler);

  app.get("/api/admin/crm/segments", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return { segments: await listSegments() };
  });
  app.post("/api/admin/crm/segments", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    const body = z.object({ id: z.string().optional(), name: z.string().min(1).max(60), filter: z.unknown() }).parse(req.body);
    return saveSegment(body, me.telegramId);
  });
  app.post("/api/admin/crm/segments/:id/delete", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return deleteSegment((req.params as { id: string }).id);
  });

  app.get("/api/admin/crm/funnel", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const query = req.query as { days?: string; source?: string };
    return funnel(Number(query.days || 30) || 30, query.source || undefined);
  });
  app.get("/api/admin/crm/attribution", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const days = Number((req.query as { days?: string }).days || 30) || 30;
    const [a, sp] = await Promise.all([attribution(days), sponsorReport(days)]);
    return { ...a, sponsors: sp.rows };
  });
  app.get("/api/admin/crm/attribution.csv", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const a = await attribution(Number((req.query as { days?: string }).days || 30) || 30);
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", "attachment; filename=liveline-attribution.csv");
    return reply.send(toCsv(["source", "started", "verified", "verify_rate_%", "predicted", "predict_rate_%", "returned", "return_rate_%"],
      a.rows.map((r) => [r.source, r.started, r.verified, r.verifyRate, r.predicted, r.predictRate, r.returned, r.returnRate])));
  });

  // Broadcasts: draft → preview/test → explicit confirm → rate-limited delivery.
  app.post("/api/admin/crm/audience", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return audienceCount((req.body as { filter?: unknown })?.filter);
  });
  app.get("/api/admin/crm/broadcasts", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return { broadcasts: await listBroadcasts() };
  });
  const bcBody = z.object({
    text: z.string().min(1).max(3500),
    buttonText: z.string().max(40).optional().nullable().transform((v) => v || undefined),
    buttonParam: z.string().max(20).optional().nullable().transform((v) => v || undefined),
    filter: z.unknown().optional(),
    segmentName: z.string().max(60).optional().nullable().transform((v) => v || undefined),
    scheduledAt: z.string().optional().nullable(),
  });
  app.post("/api/admin/crm/broadcasts", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    return createBroadcast(bcBody.parse(req.body), me.telegramId);
  });
  app.get("/api/admin/crm/broadcasts/:id", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return getBroadcast((req.params as { id: string }).id);
  });
  app.post("/api/admin/crm/broadcasts/:id", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return updateBroadcast((req.params as { id: string }).id, bcBody.parse(req.body));
  });
  app.post("/api/admin/crm/broadcasts/:id/test", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    return testBroadcast((req.params as { id: string }).id, me.telegramId);
  });
  app.post("/api/admin/crm/broadcasts/:id/confirm", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    const body = z.object({ confirm: z.literal(true), expectTotal: z.number().int().optional() }).parse(req.body);
    if (!body.confirm) return;
    return confirmBroadcast((req.params as { id: string }).id, me.telegramId, body.expectTotal);
  });
  app.post("/api/admin/crm/broadcasts/:id/cancel", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return cancelBroadcast((req.params as { id: string }).id);
  });

  // Automations (reminder sequences).
  app.get("/api/admin/automation", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return automationState();
  });
  app.post("/api/admin/automation", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    const body = z.object({
      key: z.string().optional(),
      enabled: z.boolean().optional(),
      config: z.record(z.unknown()).optional(),
      global: z.record(z.unknown()).optional(),
      masterEnabled: z.boolean().optional(),
    }).parse(req.body);
    return updateAutomation(body as Parameters<typeof updateAutomation>[0], me.telegramId);
  });
  app.get("/api/admin/automation/:key/preview", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    return previewRule((req.params as { key: string }).key, Number((req.query as { step?: string }).step || 0) || 0, me);
  });
  app.post("/api/admin/automation/:key/test", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    const body = z.object({ step: z.number().int().min(0).max(2).default(0) }).parse(req.body || {});
    return testRule((req.params as { key: string }).key, body.step, me);
  });

  // Admin DM alerts (new start / new verified user).
  app.get("/api/admin/alerts", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const probe = (req.query as { probe?: string }).probe === "1";
    return { ...(await alertSettings()), admins: await adminAlertStatus(probe) };
  });
  app.post("/api/admin/alerts/admin", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    const body = z.object({ telegramId: z.string().regex(/^\d+$/), kind: z.enum(["start", "verified"]), enabled: z.boolean() }).parse(req.body);
    if (!(await adminChatIds()).includes(body.telegramId)) throw httpError(400, "NOT_ADMIN", "Not on the admin roster.");
    await setAdminAlertPref(body.telegramId, body.kind, body.enabled, me.telegramId);
    return { ...(await alertSettings()), admins: await adminAlertStatus(false) };
  });
  app.post("/api/admin/alerts", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    const body = z.object({ key: z.enum(ALERT_KEYS), enabled: z.boolean() }).parse(req.body);
    return setAlertSetting(body.key, body.enabled, me.telegramId);
  });
  app.post("/api/admin/alerts/test", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    const body = z.object({ kind: z.enum(["start", "verified"]), to: z.string().regex(/^(\d+|all)$/).optional() }).parse(req.body);
    // Sample uses the asking admin's own record. Default: only to the asker; "to" = one roster admin or "all".
    const roster = await adminChatIds();
    let chatIds = [me.telegramId];
    if (body.to === "all") chatIds = roster;
    else if (body.to) {
      if (!roster.includes(body.to)) throw httpError(400, "NOT_ADMIN", "Not on the admin roster.");
      chatIds = [body.to];
    }
    return alertAdmins(me.id, body.kind, { force: true, chatIds });
  });

  // Channel auto-post.
  app.get("/api/admin/channel", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const [settings, log, stats] = await Promise.all([channelSettings(), channelLog(30), channelStats()]);
    return { ...settings, log, stats };
  });
  app.post("/api/admin/channel", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    const body = z.object({ enabled: z.boolean().optional(), config: z.record(z.unknown()).optional() }).parse(req.body);
    return updateChannelSettings(body as Parameters<typeof updateChannelSettings>[0], me.telegramId);
  });
  app.post("/api/admin/channel/test", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    const body = z.object({ kind: z.enum(["start", "moment", "innings", "result", "today"]).default("start") }).parse(req.body || {});
    return sendTestCard(me.telegramId, body.kind);
  });

  /* ---------- Sponsor buttons ---------- */
  app.get("/api/admin/sponsors", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return listSponsors();
  });
  app.get("/api/admin/sponsors/report", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return sponsorReport(Number((req.query as { days?: string }).days || 30) || 30);
  });
  app.post("/api/admin/sponsors", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    return createSponsor(sponsorInput.parse(req.body), me.telegramId);
  });
  app.put("/api/admin/sponsors/:id", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return updateSponsor((req.params as { id: string }).id, sponsorInput.parse(req.body));
  });
  app.delete("/api/admin/sponsors/:id", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return deleteSponsor((req.params as { id: string }).id);
  });
  // One-tap sponsor link (bot web_app button opens this; we log the tap and 302 to the sponsor).
  app.get("/go/sp/:id", async (req, reply) => {
    const url = await sponsorGo((req.params as { id: string }).id, req.query as { t?: string; s?: string; g?: string });
    reply.header("cache-control", "no-store");
    if (!url) return reply.code(410).type("text/html; charset=utf-8").send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#0b1220;color:#e7eefc;display:grid;place-items:center;height:100vh;margin:0"><p>This offer has ended.</p></body>');
    return reply.redirect(url, 302);
  });
  // Public: live sponsors for this user (Home banner), one sponsor (in-app /sponsor/:id view), tap tracking.
  app.get("/api/sponsors", async (req, reply) => {
    const user = await authenticate(req, reply, { registered: false });
    if (!user) return;
    return { sponsors: (await liveSponsors(Boolean(user.phoneVerifiedAt))).map((sp) => ({ ...publicSponsor(sp), go: sponsorGoUrl(sp.id, user.telegramId, "home") })) };
  });
  app.get("/api/sponsors/:id", async (req, reply) => {
    const user = await authenticate(req, reply, { registered: false });
    if (!user) return;
    return getSponsorForUser((req.params as { id: string }).id, Boolean(user.phoneVerifiedAt));
  });
  app.post("/api/sponsors/:id/tap", async (req, reply) => {
    const user = await authenticate(req, reply, { registered: false });
    if (!user) return;
    const body = z.object({ surface: z.enum(["bot", "home"]).default("home") }).parse(req.body || {});
    return recordTap((req.params as { id: string }).id, user.id, body.surface);
  });

}

function crmFileName(): string {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return `livelinepro-crm-users-${d}.csv`;
}
