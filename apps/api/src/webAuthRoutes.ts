import type { FastifyInstance } from "fastify";
import { smsVerified, WebAuthError } from "./services/webverify";

/**
 * Server-to-server endpoint for the website verify gate (apps/site). The body is a payload
 * HMAC-signed with WEB_AUTH_SECRET that expires in 60 s, so the shared secret never travels.
 */
export async function webAuthRoutes(app: FastifyInstance) {
  app.post("/internal/web-auth/sms-verified", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = (req.body || {}) as { t?: string };
    try {
      const out = await smsVerified(String(body.t || ""));
      return reply.send({ ok: true, userId: out.userId, created: out.created });
    } catch (err) {
      if (err instanceof WebAuthError) return reply.code(err.statusCode).send({ ok: false, error: err.code, message: err.message });
      throw err;
    }
  });
}
