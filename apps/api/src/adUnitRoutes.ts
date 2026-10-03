import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AD_PAGES, AD_PLACEMENTS } from "@liveline/shared";
import type { authenticate as AuthFn } from "./server";
import { httpError } from "./httpError";
import {
  adUnitCsv, adUnitInput, adUnitReport, appAdsFor, createAdUnit, deleteAdUnit, listAdUnits, mediaLimit, readAdMedia,
  saveAdMedia, setAdUnitEnabled, storageHealthy, storageMode, trackAdUnit, updateAdUnit,
} from "./services/adunits";

const memo = new Map<string, { at: number; body: Buffer; type: string }>();

/** Range-aware sender (iOS Safari needs 206 responses to play video). */
export async function sendAdMedia(req: FastifyRequest, reply: FastifyReply, file: string) {
  let hit = memo.get(file);
  if (!hit || Date.now() - hit.at > 10 * 60_000) {
    const got = await readAdMedia(file);
    if (!got) throw httpError(404, "NOT_FOUND");
    hit = { at: Date.now(), ...got };
    if (memo.size > 40) memo.clear();
    memo.set(file, hit);
  }
  const total = hit.body.length;
  reply.header("cache-control", "public, max-age=31536000, immutable").header("accept-ranges", "bytes").type(hit.type);
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2] || 0));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    if (start >= total || start > end) return reply.code(416).header("content-range", `bytes */${total}`).send();
    return reply.code(206).header("content-range", `bytes ${start}-${end}/${total}`).send(hit.body.subarray(start, end + 1));
  }
  return reply.send(hit.body);
}

export async function adUnitRoutes(app: FastifyInstance, authenticate: typeof AuthFn) {
  const admin = (req: FastifyRequest, reply: FastifyReply) => authenticate(req, reply, { admin: true });

  /* ---------- admin ---------- */
  app.get("/api/admin/adunits", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return { ...(await listAdUnits()), storageOk: await storageHealthy() };
  });
  app.post("/api/admin/adunits", async (req, reply) => {
    const me = await admin(req, reply);
    if (!me) return;
    return createAdUnit(adUnitInput.parse(req.body), me.telegramId);
  });
  app.put("/api/admin/adunits/:id", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return updateAdUnit((req.params as { id: string }).id, adUnitInput.parse(req.body));
  });
  app.post("/api/admin/adunits/:id/enabled", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const body = z.object({ enabled: z.boolean() }).parse(req.body);
    return setAdUnitEnabled((req.params as { id: string }).id, body.enabled);
  });
  app.delete("/api/admin/adunits/:id", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return deleteAdUnit((req.params as { id: string }).id);
  });
  app.post("/api/admin/adunits/media", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const file = await req.file({ limits: { fileSize: mediaLimit(".mp4") + 1 } });
    if (!file) throw httpError(400, "FILE", "Choose a file.");
    const buf = await file.toBuffer().catch(() => { throw httpError(413, "TOO_BIG", "Videos can be up to 20 MB, images up to 3 MB."); });
    return { ...(await saveAdMedia(file.filename, buf)), storage: storageMode() };
  });
  app.get("/api/admin/adunits/report", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const r = await adUnitReport(Number((req.query as { days?: string }).days || 30) || 30);
    return { days: r.days, rows: r.rows };
  });
  app.get("/api/admin/adunits/report.csv", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const days = Number((req.query as { days?: string }).days || 30) || 30;
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="liveline-ads-${days}d.csv"`);
    return adUnitCsv(days);
  });

  /* ---------- Mini App ---------- */
  app.get("/api/adunits", async (req, reply) => {
    const user = await authenticate(req, reply, { registered: false });
    if (!user) return;
    const page = String((req.query as { page?: string }).page || "home");
    if (!(AD_PAGES as readonly string[]).includes(page)) return { ads: {} };
    return { ads: await appAdsFor(page) };
  });
  app.post("/api/adunits/:id/event", async (req, reply) => {
    const user = await authenticate(req, reply, { registered: false });
    if (!user) return;
    const body = z.object({ type: z.enum(["impression", "click"]), placement: z.enum(AD_PLACEMENTS as unknown as [string, ...string[]]), page: z.enum(AD_PAGES) }).parse(req.body);
    return trackAdUnit({ id: (req.params as { id: string }).id, ...body, surface: "app", viewer: user.id });
  });

  /* ---------- media (uploads live in the private bucket; served through our own path) ---------- */
  app.get("/ads-media/:file", async (req, reply) => sendAdMedia(req, reply, (req.params as { file: string }).file));
}
