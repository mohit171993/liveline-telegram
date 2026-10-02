import type { FastifyInstance } from "fastify";
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
import { createSponsor, deleteSponsor, getSponsorForUser, listSponsors, liveSponsors, publicSponsor, recordTap, sponsorInput, sponsorReport, updateSponsor } from "./services/sponsors";
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
    reply.header("content-disposition", "attachment; filename=liveline-crm-users.csv");
    return reply.send(await crmCsv(q(req)));
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

  // Telegram webviews can't save a fetch() blob reliably; mint a 10-minute one-time link instead
  // and let WebApp.downloadFile (or the browser) fetch it.
  app.post("/api/admin/crm/export", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const body = z.object({ kind: z.enum(["users", "attribution"]), filter: z.unknown().optional(), days: z.number().int().optional() }).parse(req.body);
    const token = crypto.randomBytes(18).toString("base64url");
    await redis.set(`ll:export:${token}`, JSON.stringify(body), "EX", 600);
    const base = env.publicApiUrl || `${req.protocol}://${req.headers.host}`;
    return { url: `${base}/api/export/${token}`, fileName: body.kind === "users" ? "liveline-crm-users.csv" : "liveline-attribution.csv" };
  });
  app.get("/api/export/:token", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const raw = await redis.getdel(`ll:export:${token}`);
    if (!raw) return reply.code(404).send({ error: "EXPIRED" });
    const body = JSON.parse(raw) as { kind: string; filter?: unknown; days?: number };
    let csv: string;
    if (body.kind === "users") csv = await crmCsv(parseFilter(body.filter));
    else {
      const a = await attribution(body.days || 30);
      csv = toCsv(["source", "started", "verified", "verify_rate_%", "predicted", "predict_rate_%", "returned", "return_rate_%"],
        a.rows.map((r) => [r.source, r.started, r.verified, r.verifyRate, r.predicted, r.predictRate, r.returned, r.returnRate]));
    }
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename=${body.kind === "users" ? "liveline-crm-users.csv" : "liveline-attribution.csv"}`);
    return reply.send(csv);
  });

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
  // Public: live sponsors for this user (Home banner), one sponsor (in-app /sponsor/:id view), tap tracking.
  app.get("/api/sponsors", async (req, reply) => {
    const user = await authenticate(req, reply, { registered: false });
    if (!user) return;
    return { sponsors: (await liveSponsors(Boolean(user.phoneVerifiedAt))).map(publicSponsor) };
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
