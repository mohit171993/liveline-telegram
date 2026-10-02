import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { prisma } from "@liveline/db";
import { validateInitData, type InitDataResult } from "@liveline/shared";
import { env, isProd } from "./env";
import { redis } from "./redis";
import { registerRoutes } from "./routes";
import { webAuthRoutes } from "./webAuthRoutes";
import { touchFromInit, touchSession, userIsAdmin, verifyPhone } from "./services/users";
import { httpError } from "./httpError";
import type { User } from "@prisma/client";

export type Authed = User;

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: isProd ? "info" : "info",
      messageKey: "msg",
    },
    trustProxy: true,
  });
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (!body || body === "") {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      error.statusCode = 400;
      done(error, undefined);
    }
  });
  await app.register(cors, { origin: true });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } });
  await app.register(websocket);

  app.setErrorHandler((error, request, reply) => {
    const err = error as { statusCode?: number; code?: string; message?: string };
    const status = err.statusCode || 500;
    const code = err.code || "ERROR";
    if (status >= 500) request.log.error(error);
    reply.code(status).send({ error: code, message: err.message || "error" });
  });

  app.get("/health", async (_req, reply) => {
    const body = await health();
    reply.code(body.ok ? 200 : 503).send(body);
  });
  app.get("/ready", async (_req, reply) => {
    const body = await health();
    reply.code(body.ok ? 200 : 503).send(body);
  });

  app.get("/api/live/stream", async (req, reply) => {
    const user = await authenticate(req, reply, { registered: true });
    if (!user) return;
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const sub = redis.duplicate();
    sub.on("error", () => undefined);
    await sub.subscribe("ll:live").catch(() => undefined);
    sub.on("message", (_channel, message) => {
      reply.raw.write(`data: ${message}\n\n`);
    });
    const beat = setInterval(() => reply.raw.write(": ping\n\n"), 15000);
    req.raw.on("close", () => {
      clearInterval(beat);
      sub.quit().catch(() => sub.disconnect());
    });
  });

  app.get("/ws", { websocket: true }, (socket) => {
    let user: User | null = null;
    const subs = new Set<string>();
    const timer = setTimeout(() => {
      if (!user) socket.close(4001, "auth");
    }, 5000);
    socket.on("message", async (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === "auth") {
          const result = validateInitData(String(msg.initData || ""), env.botToken, Date.now(), env.authMaxAge);
          if (!result.ok) {
            socket.send(JSON.stringify({ type: "error", error: result.error }));
            socket.close();
            return;
          }
          const row = await touchFromInit(result);
          if (row.status === "BLOCKED" || row.status !== "ACTIVE") {
            socket.send(JSON.stringify({ type: "error", error: row.status === "BLOCKED" ? "BLOCKED" : "REGISTRATION_REQUIRED" }));
            socket.close();
            return;
          }
          if (row.ageStatus !== "adult" && row.ageStatus !== "consent") {
            socket.send(JSON.stringify({ type: "error", error: "AGE_GATE" }));
            socket.close();
            return;
          }
          user = row;
          clearTimeout(timer);
          await touchSession(row.id);
          socket.send(JSON.stringify({ type: "ready" }));
          return;
        }
        if (!user) {
          socket.send(JSON.stringify({ type: "error", error: "AUTH" }));
          return;
        }
        if (msg.type === "join" && msg.matchKey) {
          subs.add(String(msg.matchKey));
          socket.send(JSON.stringify({ type: "joined", matchKey: msg.matchKey }));
        }
      } catch {
        socket.send(JSON.stringify({ type: "error", error: "BAD_MESSAGE" }));
      }
    });
    // A socket can close before the Redis subscriber is ready (fast navigation). Never let that
    // reject unhandled: in production it crashed the whole API and blanked every screen.
    const sub = redis.duplicate();
    let closed = false;
    sub.on("error", () => undefined);
    sub.subscribe("ll:live").catch(() => undefined);
    sub.on("message", (channel, message) => {
      if (closed || channel !== "ll:live") return;
      try {
        const payload = JSON.parse(message) as { key?: string };
        if (!payload.key || payload.key === "*" || subs.has(payload.key)) socket.send(message);
      } catch {
        /* ignore a bad payload or a closing socket */
      }
    });
    socket.on("error", () => undefined);
    socket.on("close", () => {
      closed = true;
      clearTimeout(timer);
      sub.quit().catch(() => sub.disconnect());
    });
  });

  app.post("/internal/contact", async (req, reply) => {
    if (isProd || !env.internalToken) return reply.code(404).send({ error: "NOT_FOUND" });
    const header = req.headers["x-internal-token"];
    if (header !== env.internalToken) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const body = req.body as { telegramId?: string; contactUserId?: number; phone?: string };
    const user = await verifyPhone(String(body.telegramId), Number(body.contactUserId), String(body.phone || ""));
    return { ok: true, status: user.status };
  });

  app.post("/internal/tick", async (req, reply) => {
    if (isProd || !env.internalToken) return reply.code(404).send({ error: "NOT_FOUND" });
    if (req.headers["x-internal-token"] !== env.internalToken) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const { forceTick } = await import("./feed");
    const matches = await forceTick();
    return { ok: true, live: matches.find((m) => m.status === "live")?.live || null };
  });

  app.post("/internal/moment", async (req, reply) => {
    if (isProd || !env.internalToken) return reply.code(404).send({ error: "NOT_FOUND" });
    if (req.headers["x-internal-token"] !== env.internalToken) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const body = req.body as { matchKey?: string; moment?: string };
    const { publishMoment } = await import("./feed");
    await publishMoment(String(body.matchKey || "demo_ind_aus"), String(body.moment || "SIX"));
    return { ok: true };
  });

  app.post("/internal/break", async (req, reply) => {
    if (isProd || !env.internalToken) return reply.code(404).send({ error: "NOT_FOUND" });
    if (req.headers["x-internal-token"] !== env.internalToken) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const body = req.body as { matchKey?: string };
    const { forceBreak } = await import("./feed");
    const until = await forceBreak(String(body.matchKey || "demo_ind_aus"));
    return { ok: true, until };
  });

  await registerRoutes(app, authenticate);
  await webAuthRoutes(app);
  return app;
}

async function health() {
  let db = false;
  let cache = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch { /* reported below */ }
  try {
    cache = (await redis.ping()) === "PONG";
  } catch { /* reported below */ }
  return {
    ok: db && cache,
    db,
    redis: cache,
    provider: env.useMockProvider ? "mock" : "roanuz",
    uptime: process.uptime(),
  };
}

export async function authenticate(
  req: { headers: Record<string, string | string[] | undefined>; query?: unknown },
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  opts: { registered?: boolean; admin?: boolean } = { registered: true },
): Promise<User | null> {
  const header = String(req.headers.authorization || "");
  const fromHeader = header.toLowerCase().startsWith("tma ") ? header.slice(4).trim() : "";
  const fromQuery = typeof (req.query as { initData?: string } | undefined)?.initData === "string"
    ? (req.query as { initData: string }).initData
    : "";
  const initData = fromHeader || String(req.headers["x-telegram-init-data"] || fromQuery || "");
  if (!env.botToken) {
    await reply.code(500).send({ error: "NO_BOT_TOKEN", message: "TELEGRAM_BOT_TOKEN is not set." });
    return null;
  }
  const result: InitDataResult | { ok: false; error: string } = validateInitData(initData, env.botToken, Date.now(), env.authMaxAge);
  if (!result.ok) {
    await reply.code(401).send({ error: result.error, message: "Open LiveLine inside Telegram." });
    return null;
  }
  const user = await touchFromInit(result);
  if (user.status === "BLOCKED") {
    await reply.code(403).send({ error: "BLOCKED", message: "This account is blocked." });
    return null;
  }
  if (opts.admin) {
    if (!(await userIsAdmin(user.telegramId, user.username))) {
      await reply.code(403).send({ error: "ADMIN_ONLY" });
      return null;
    }
    // Listed admins run the panel from signed Telegram initData even before they share a
    // phone; the player app (predictions, rewards) still needs verification.
    return user;
  }
  if (opts.registered !== false && user.status !== "ACTIVE") {
    await reply.code(403).send({
      error: "REGISTRATION_REQUIRED",
      needsPhone: !user.phoneVerifiedAt,
      needsTerms: !user.termsAcceptedAt,
    });
    return null;
  }
  if (opts.registered !== false && user.ageStatus !== "adult" && user.ageStatus !== "consent") {
    await reply.code(403).send({ error: "AGE_GATE", message: "Confirm you are 18, or a parent must consent." });
    return null;
  }
  if (opts.registered !== false) await touchSession(user.id);
  return user;
}

export function notFound(): never {
  throw httpError(404, "NOT_FOUND");
}
