import { describe, expect, it } from "vitest";
import {
  OtpService, OTP_DEFAULTS, hashOtp, isValidNonce, maskWebPhone, newNonce, normalizeWebPhone, parseWebverifyParam,
  signLoginToken, signSession, verifyLoginToken, verifySession, WEBVERIFY_PREFIX, type OtpStore,
} from "./webauth";

const SECRET = "test-secret-0123456789abcdef";

function memStore(clock: () => number): OtpStore & { data: Map<string, { v: string; exp: number }> } {
  const data = new Map<string, { v: string; exp: number }>();
  const live = (k: string) => { const e = data.get(k); if (e && e.exp <= clock()) { data.delete(k); return undefined; } return e; };
  return {
    data,
    async get(k) { return live(k)?.v ?? null; },
    async set(k, v, ttl) { data.set(k, { v, exp: clock() + ttl * 1000 }); },
    async incr(k, ttl) { const e = live(k); const n = (e ? Number(e.v) : 0) + 1; data.set(k, { v: String(n), exp: e ? e.exp : clock() + ttl * 1000 }); return n; },
    async del(k) { data.delete(k); },
    async ttl(k) { const e = live(k); return e ? Math.ceil((e.exp - clock()) / 1000) : -2; },
  };
}

describe("web verify nonce", () => {
  it("fits Telegram's start parameter rules", () => {
    const n = newNonce();
    expect(isValidNonce(n)).toBe(true);
    const param = WEBVERIFY_PREFIX + n;
    expect(param.length).toBeLessThanOrEqual(64);
    expect(/^[A-Za-z0-9_-]+$/.test(param)).toBe(true);
    expect(parseWebverifyParam(param)).toBe(n);
    expect(parseWebverifyParam("webverify_short")).toBeNull();
    expect(parseWebverifyParam("ref_123")).toBeNull();
    expect(newNonce()).not.toBe(n);
  });
});

describe("login token", () => {
  it("round-trips and binds user + method", () => {
    const { token, jti } = signLoginToken("u1", "telegram", SECRET, { nonce: "n" });
    const p = verifyLoginToken(token, SECRET)!;
    expect(p.u).toBe("u1");
    expect(p.m).toBe("telegram");
    expect(p.j).toBe(jti);
    expect(p.n).toBe("n");
  });
  it("rejects tampering, wrong secret, expiry and cross-purpose use", () => {
    const now = Date.now();
    const { token } = signLoginToken("u1", "telegram", SECRET, { nowMs: now, ttlS: 60 });
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), u: "admin" })).toString("base64url");
    expect(verifyLoginToken(`${forged}.${sig}`, SECRET, now)).toBeNull();
    expect(verifyLoginToken(token, SECRET + "x", now)).toBeNull();
    expect(verifyLoginToken(token, SECRET, now + 61_000)).toBeNull();
    expect(verifyLoginToken("garbage", SECRET)).toBeNull();
    expect(verifyLoginToken(null, SECRET)).toBeNull();
    // A login token is not a session cookie and vice versa.
    expect(verifySession(token, SECRET, now)).toBeNull();
    expect(verifyLoginToken(signSession("u1", "sms", SECRET, now), SECRET, now)).toBeNull();
  });
  it("rejects short secrets", () => {
    expect(() => signLoginToken("u", "sms", "short")).toThrow();
  });
});

describe("session cookie", () => {
  it("lasts 90 days", () => {
    const now = Date.now();
    const c = signSession("u9", "sms", SECRET, now);
    expect(verifySession(c, SECRET, now + 89 * 86400_000)?.u).toBe("u9");
    expect(verifySession(c, SECRET, now + 91 * 86400_000)).toBeNull();
  });
});

describe("phone normalisation", () => {
  it("defaults to +91 and validates Indian mobiles", () => {
    expect(normalizeWebPhone("98765 43210")).toBe("919876543210");
    expect(normalizeWebPhone("+91 98765-43210")).toBe("919876543210");
    expect(normalizeWebPhone("09876543210")).toBe("919876543210");
    expect(normalizeWebPhone("919876543210")).toBe("919876543210");
    expect(normalizeWebPhone("12345 67890")).toBeNull();
    expect(normalizeWebPhone("+91 12345")).toBeNull();
    expect(normalizeWebPhone("+971501234567")).toBe("971501234567");
    expect(normalizeWebPhone("")).toBeNull();
    expect(maskWebPhone("919876543210")).toBe("+91 ••••••3210");
  });
});

describe("OTP service", () => {
  const phone = "919876543210";
  const setup = (limits = OTP_DEFAULTS) => {
    let t = 1_800_000_000_000;
    const clock = () => t;
    const store = memStore(clock);
    return { svc: new OtpService(store, SECRET, limits, clock), store, advance: (s: number) => { t += s * 1000; } };
  };

  it("issues a 6-digit code stored only as a hash with a 5 minute expiry", async () => {
    const { svc, store } = setup();
    const r = await svc.issue(phone, "1.1.1.1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.code).toMatch(/^\d{6}$/);
    expect(r.expiresIn).toBe(300);
    const stored = [...store.data.entries()].find(([k]) => k.startsWith("ll:otp:code:"))!;
    expect(stored[1].v).not.toContain(r.code);
    expect(stored[1].v).toContain(hashOtp(r.code, phone, SECRET));
    expect(stored[0]).not.toContain(phone);
  });

  it("verifies once, then the code is gone", async () => {
    const { svc } = setup();
    const r = await svc.issue(phone, "ip");
    if (!r.ok) throw new Error("issue failed");
    expect(await svc.verify(phone, r.code, "ip")).toEqual({ ok: true });
    expect((await svc.verify(phone, r.code, "ip")).ok).toBe(false);
  });

  it("expires after 5 minutes", async () => {
    const { svc, advance } = setup();
    const r = await svc.issue(phone, "ip");
    if (!r.ok) throw new Error("issue failed");
    advance(301);
    expect(await svc.verify(phone, r.code, "ip")).toEqual({ ok: false, error: "expired" });
  });

  it("caps wrong attempts and locks the code", async () => {
    const { svc } = setup();
    const r = await svc.issue(phone, "ip");
    if (!r.ok) throw new Error("issue failed");
    const wrong = r.code === "000000" ? "111111" : "000000";
    for (let i = 1; i < 5; i++) expect(await svc.verify(phone, wrong, "ip")).toEqual({ ok: false, error: "wrong", attemptsLeft: 5 - i });
    expect(await svc.verify(phone, wrong, "ip")).toEqual({ ok: false, error: "locked", attemptsLeft: 0 });
    // Even the right code no longer works after lock-out.
    expect((await svc.verify(phone, r.code, "ip")).ok).toBe(false);
  });

  it("rejects malformed codes without burning attempts", async () => {
    const { svc } = setup();
    expect(await svc.verify(phone, "12ab", "ip")).toEqual({ ok: false, error: "bad_code" });
  });

  it("enforces the resend cooldown, then allows a resend that replaces the old code", async () => {
    const { svc, advance } = setup();
    const a = await svc.issue(phone, "ip");
    const b = await svc.issue(phone, "ip");
    expect(b).toMatchObject({ ok: false, error: "cooldown" });
    advance(31);
    const c = await svc.issue(phone, "ip");
    expect(c.ok).toBe(true);
    if (!a.ok || !c.ok) return;
    if (a.code !== c.code) expect((await svc.verify(phone, a.code, "ip")).ok).toBe(false);
    expect((await svc.verify(phone, c.code, "ip")).ok).toBe(true);
  });

  it("rate-limits per phone", async () => {
    const { svc, advance } = setup();
    for (let i = 0; i < 5; i++) { expect((await svc.issue(phone, `ip${i}`)).ok).toBe(true); advance(31); }
    expect(await svc.issue(phone, "ip9")).toMatchObject({ ok: false, error: "phone_limit" });
  });

  it("rate-limits per IP across phones", async () => {
    const { svc } = setup();
    for (let i = 0; i < 10; i++) expect((await svc.issue(`9198765432${String(i).padStart(2, "0")}`, "9.9.9.9")).ok).toBe(true);
    expect(await svc.issue("919999999999", "9.9.9.9")).toMatchObject({ ok: false, error: "ip_limit" });
  });

  it("cancel() clears the code and cooldown after a failed SMS send", async () => {
    const { svc } = setup();
    await svc.issue(phone, "ip");
    await svc.cancel(phone);
    expect((await svc.issue(phone, "ip")).ok).toBe(true);
  });

  it("limits verify calls per IP", async () => {
    const { svc } = setup({ ...OTP_DEFAULTS, verifyPerIpHour: 2 });
    await svc.verify(phone, "000000", "ip");
    await svc.verify(phone, "000000", "ip");
    expect(await svc.verify(phone, "000000", "ip")).toEqual({ ok: false, error: "ip_limit" });
  });
});
