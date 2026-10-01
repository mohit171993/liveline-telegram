import crypto from "crypto";

const base = process.env.API || "http://127.0.0.1:3001";
const token = process.env.TELEGRAM_BOT_TOKEN || "0000000000:MOCKLOCALTOKEN";
const internal = process.env.INTERNAL_SERVICE_TOKEN || "local-dev-internal-token";
const adminId = 8992664481;

function sign(user, startParam) {
  const params = new URLSearchParams();
  params.set("auth_date", String(Math.floor(Date.now() / 1000)));
  params.set("query_id", "AAEe2e");
  params.set("user", JSON.stringify(user));
  if (startParam) params.set("start_param", startParam);
  const pairs = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const check = pairs.map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secret).update(check).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

async function call(path, initData, opts = {}) {
  const res = await fetch(base + path, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(initData ? { authorization: `tma ${initData}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log("ok", msg);
}

const health = await call("/health");
assert(health.status === 200 && health.body.ok, "health");

const open = await call("/api/home");
assert(open.status === 401, "no initData is rejected");

const stranger = sign({ id: 424242, first_name: "Stranger" });
const blocked = await call("/api/home", stranger);
assert(blocked.status === 403 && blocked.body.error === "REGISTRATION_REQUIRED", "unregistered gets no scores");

const admin = sign({ id: adminId, first_name: "Fantzo", username: "fantzoSportsUpdates", language_code: "en", is_premium: true });
const home = await call("/api/home", admin);
assert(home.status === 200 && home.body.matches.some((m) => m.status === "live"), "registered admin sees a live match");
const live = home.body.matches.find((m) => m.status === "live");
const before = live.live.runs + "/" + live.live.wickets;

let pred = { status: 0, body: null };
for (let attempt = 0; attempt < 8; attempt++) {
  pred = await call("/api/predictions", admin, {
    method: "POST",
    body: JSON.stringify({ matchKey: live.key, kind: "BALL", pick: "4" }),
  });
  if (pred.status === 200) break;
  if (pred.body?.error === "ALREADY_LOCKED") {
    await fetch(base + "/internal/tick", { method: "POST", headers: { "x-internal-token": internal } });
  } else if (pred.body?.error !== "LOCKED") break;
  await new Promise((resolve) => setTimeout(resolve, 400));
}
assert(pred.status === 200, `ball prediction accepted (${pred.status} ${pred.body?.error || ""})`);

const tick = await fetch(base + "/internal/tick", { method: "POST", headers: { "x-internal-token": internal } });
assert(tick.status === 200, "simulator tick");
const afterHome = await call("/api/home", admin);
const after = afterHome.body.matches.find((m) => m.key === live.key);
assert(`${after.live.runs}/${after.live.wickets}` !== before || after.live.overs !== live.live.overs, "live score moved");

const slips = await call(`/api/predictions?matchKey=${live.key}`, admin);
const settled = (slips.body.mine || []).find((row) => row.id === pred.body.id);
assert(settled?.settledAt, "prediction settled from the feed");

const board = await call("/api/leaderboard?scope=season", admin);
assert((board.body.rows || []).length > 0, "leaderboard has rows");

const made = await call("/api/admin/campaigns", admin, {
  method: "POST",
  body: JSON.stringify({
    brand: "E2E Radio",
    name: "E2E slot " + Date.now(),
    status: "active",
    flatFee: 1000,
    creative: { type: "native", slot: "home_native", headline: "E2E Radio", body: "A quiet sponsor.", cta: "Listen", frequencyCap: 4 },
  }),
});
assert(made.status === 200, "campaign created");
const slot = await call("/api/ads/slot?slot=home_native", admin);
assert(slot.body.ad, "ad served into the slot");
const imp1 = await call(`/api/ads/${slot.body.ad.id}/impression`, admin, { method: "POST" });
const imp2 = await call(`/api/ads/${slot.body.ad.id}/impression`, admin, { method: "POST" });
assert(imp1.body.recorded === true && imp2.body.deduped === true, "impression deduped");
const click = await call(`/api/ads/${slot.body.ad.id}/click`, admin, { method: "POST" });
assert(click.body.recorded === true, "click recorded");

const chat = await call(`/api/chat/${live.key}`, admin, { method: "POST", body: JSON.stringify({ body: "What a shot" }) });
assert(chat.status === 200, "watch party message");

const spin = await call("/api/rewards/spin", admin, { method: "POST" });
assert(spin.status === 200, "free spin");
const spin2 = await call("/api/rewards/spin", admin, { method: "POST" });
assert(spin2.status === 200 || spin2.status === 409, "second spin uses a bonus or is refused");

const ai = await call("/api/ai/chat", admin, { method: "POST", body: JSON.stringify({ matchKey: live.key, message: "give me the session odds" }) });
assert(ai.status === 200 && /bet|सट्ट/i.test(ai.body.text), "buddy refuses betting");

const upcoming = home.body.matches.find((m) => m.status === "upcoming");
const rem = await call("/api/reminders", admin, {
  method: "POST",
  body: JSON.stringify({ matchKey: upcoming.key, minutesBefore: 30, alertTypes: ["start", "wicket"], startAt: upcoming.startAt }),
});
assert(rem.status === 200, "reminder saved");

const engage = await call("/api/engage", admin);
assert(engage.status === 200 && engage.body.rank?.name, "xp rank");
const cheer = await call(`/api/matches/${live.key}/cheer`, admin, { method: "POST", body: JSON.stringify({ emoji: "🔥" }) });
assert(cheer.status === 200, "cheer");
const fans = await call(`/api/matches/${live.key}/fans`, admin);
assert((fans.body.a + fans.body.b) > 0, "fan meter");

console.log("e2e passed");
