/**
 * Pluggable SMS delivery for the website OTP. Configured by env:
 *   SMS_PROVIDER         pearlsms | msg91 | fast2sms | mock (mock = local dev only, never in production)
 *   SMS_API_KEY          provider auth key
 *   SMS_SENDER_ID        DLT-approved 6-letter header (e.g. LLPRO)
 *   SMS_DLT_TEMPLATE_ID  approved OTP template id (msg91: the MSG91 template id mapped to the DLT template;
 *                        fast2sms: the DLT Manager message id)
 *   SMS_DLT_ENTITY_ID    DLT Principal Entity ID (sent where the provider accepts it)
 * PearlSMS (generic DLT HTTP gateway) additionally uses:
 *   SMS_API_URL          request URL template with placeholders {apikey} {sender} {mobile} (91XXXXXXXXXX)
 *                        {mobile10} {message} {otp} {templateid} {entityid} — values are URL-encoded
 *   SMS_API_METHOD       GET (default) or POST (sends the URL's query string as a form body)
 *   SMS_MESSAGE_TEXT     exact DLT-approved text; {otp} (or {#var#}) is replaced by the code
 *   SMS_SUCCESS_MATCH    optional regex the response body must match to count as sent
 * Until SMS_PROVIDER (and that provider's required values) are set, the SMS option shows "Coming soon".
 */
export interface SmsProvider {
  readonly name: string;
  /** phone: E.164 digits without "+", e.g. 919876543210. Throws on failure. */
  sendOtp(phone: string, code: string): Promise<void>;
}

export interface SmsConfig {
  provider: string; apiKey: string; senderId: string; templateId: string; entityId: string;
  apiUrl: string; apiMethod: string; messageText: string; successMatch: string;
}

/** SPPLFW's DLT-approved OTP template (PearlSMS). Must match the registered text exactly. */
export const PEARL_DEFAULT_TEXT = "Your OTP is {#var#}. Use this to verify your mobile number on SPPLFW. Valid for 5 minutes.";

export function smsConfigFromEnv(e: NodeJS.ProcessEnv = process.env): SmsConfig {
  return {
    provider: (e.SMS_PROVIDER || "").trim().toLowerCase(),
    apiKey: (e.SMS_API_KEY || "").trim(),
    senderId: (e.SMS_SENDER_ID || "").trim(),
    templateId: (e.SMS_DLT_TEMPLATE_ID || "").trim(),
    entityId: (e.SMS_DLT_ENTITY_ID || "").trim(),
    apiUrl: (e.SMS_API_URL || "").trim(),
    apiMethod: (e.SMS_API_METHOD || "GET").trim().toUpperCase(),
    messageText: e.SMS_MESSAGE_TEXT || "",
    successMatch: (e.SMS_SUCCESS_MATCH || "").trim(),
  };
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
  if (!res.ok) throw new Error(`sms http ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

/** MSG91 Flow API v5 (template must contain the variable ##OTP##). */
class Msg91 implements SmsProvider {
  readonly name = "msg91";
  constructor(private c: SmsConfig) {}
  async sendOtp(phone: string, code: string) {
    const data = await post("https://control.msg91.com/api/v5/flow", { authkey: this.c.apiKey, accept: "application/json" }, {
      template_id: this.c.templateId,
      short_url: "0",
      ...(this.c.senderId ? { sender: this.c.senderId } : {}),
      ...(this.c.entityId ? { DLT_TE_ID: this.c.templateId, pe_id: this.c.entityId } : {}),
      recipients: [{ mobiles: phone, OTP: code, otp: code, var1: code }],
    });
    if (data?.type && data.type !== "success") throw new Error(`msg91: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

/** Fast2SMS DLT route (Indian numbers; template has one {#var#} for the code). */
class Fast2Sms implements SmsProvider {
  readonly name = "fast2sms";
  constructor(private c: SmsConfig) {}
  async sendOtp(phone: string, code: string) {
    if (!phone.startsWith("91") || phone.length !== 12) throw new Error("fast2sms: Indian numbers only");
    const data = await post("https://www.fast2sms.com/dev/bulkV2", { authorization: this.c.apiKey }, {
      route: "dlt", sender_id: this.c.senderId, message: this.c.templateId, variables_values: code, numbers: phone.slice(2), flash: 0,
      ...(this.c.entityId ? { entity_id: this.c.entityId } : {}),
    });
    if (data?.return !== true) throw new Error(`fast2sms: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

/**
 * PearlSMS (sms.pearlsms.com) — skeleton driven entirely by SMS_API_URL so the exact parameter
 * names can be dropped in without a code change once the account's API format is confirmed.
 */
export class PearlSms implements SmsProvider {
  readonly name = "pearlsms";
  constructor(private c: SmsConfig) {}
  buildRequest(phone: string, code: string): { url: string; init: RequestInit } {
    const text = (this.c.messageText || PEARL_DEFAULT_TEXT).replace("{#var#}", code).replace("{otp}", code);
    const vals: Record<string, string> = {
      apikey: this.c.apiKey, sender: this.c.senderId || "SPPLFW", mobile: phone, mobile10: phone.slice(-10),
      message: text, otp: code, templateid: this.c.templateId, entityid: this.c.entityId,
    };
    const url = this.c.apiUrl.replace(/\{(apikey|sender|mobile10|mobile|message|otp|templateid|entityid)\}/g, (_m, k: string) => encodeURIComponent(vals[k] ?? ""));
    if (this.c.apiMethod === "POST") {
      const u = new URL(url);
      const body = u.searchParams.toString();
      u.search = "";
      return { url: u.toString(), init: { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body } };
    }
    return { url, init: { method: "GET" } };
  }
  /** Provider response with any trace of the key removed (safe to log). */
  private redact(v: string): string { return this.c.apiKey ? v.split(this.c.apiKey).join("<key>") : v; }

  async sendOtp(phone: string, code: string) {
    const { url, init } = this.buildRequest(phone, code);
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      // https first; plain http only when the TLS/connection itself failed (no request reached
      // the gateway, so no duplicate SMS). Timeouts are not retried.
      const e = err as { name?: string; cause?: { code?: string } };
      if (!url.startsWith("https://") || e.name === "TimeoutError" || e.name === "AbortError") throw err;
      res = await fetch(url.replace(/^https:/, "http:"), { ...init, signal: AbortSignal.timeout(10_000) });
    }
    const body = this.redact((await res.text()).slice(0, 500));
    console.log(JSON.stringify({ level: "info", msg: "sms-provider-response", provider: this.name, status: res.status, to: `…${phone.slice(-4)}`, body: body.split(code).join("<otp>") }));
    // Never log the URL (it carries the API key) or the code.
    if (!res.ok) throw new Error(`pearlsms http ${res.status}: ${body.slice(0, 200)}`);
    if (this.c.successMatch && !new RegExp(this.c.successMatch, "i").test(body)) throw new Error(`pearlsms rejected: ${body.slice(0, 200)}`);
    // Without SMS_SUCCESS_MATCH any 2xx counts as sent (the response is logged above to calibrate it).
  }
}

/** Local development only: logs that a code was issued (never the code in production). */
class MockSms implements SmsProvider {
  readonly name = "mock";
  readonly sent: { phone: string; code: string }[] = [];
  async sendOtp(phone: string, code: string) {
    this.sent.push({ phone, code });
    console.log(JSON.stringify({ level: "info", msg: "sms-mock", phone: `…${phone.slice(-4)}`, code }));
  }
}

const REQUIRED: Record<string, (keyof SmsConfig)[]> = {
  pearlsms: ["apiKey", "apiUrl"],
  msg91: ["apiKey", "templateId"],
  fast2sms: ["apiKey", "senderId", "templateId"],
  mock: [],
};

/** The configured provider, or null (→ "Coming soon"). */
export function createSmsProvider(c: SmsConfig, nodeEnv = process.env.NODE_ENV): SmsProvider | null {
  if (!c.provider) return null;
  const need = REQUIRED[c.provider];
  if (!need) { console.error(JSON.stringify({ level: "error", msg: "sms-provider-unknown", provider: c.provider })); return null; }
  const missing = need.filter((k) => !c[k]);
  if (missing.length) { console.error(JSON.stringify({ level: "error", msg: "sms-provider-incomplete", provider: c.provider, missing })); return null; }
  if (c.provider === "mock") return nodeEnv === "production" ? null : new MockSms();
  if (c.provider === "pearlsms") {
    if (!c.apiUrl.includes("{apikey}") || (!c.apiUrl.includes("{otp}") && !c.apiUrl.includes("{message}"))) { console.error(JSON.stringify({ level: "error", msg: "sms-provider-incomplete", provider: c.provider, missing: ["SMS_API_URL {message}|{otp} placeholder"] })); return null; }
    return new PearlSms(c);
  }
  return c.provider === "msg91" ? new Msg91(c) : new Fast2Sms(c);
}
