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
assert((imp1.body.recorded === true && imp2.body.deduped === true) || imp1.body.deduped === true, "impression deduped");
const click = await call(`/api/ads/${slot.body.ad.id}/click`, admin, { method: "POST" });
assert(click.body.recorded === true || click.body.deduped === true, "click recorded or deduped");

const chat = await call(`/api/chat/${live.key}`, admin, { method: "POST", body: JSON.stringify({ body: "What a shot" }) });
assert(chat.status === 200, "watch party message");

const spin = await call("/api/rewards/spin", admin, { method: "POST" });
assert(spin.status === 200 || spin.body?.error === "NO_SPIN", "free spin or already used today");
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
const kit = await call("/api/avatar", admin, { method: "POST", body: JSON.stringify({ face: "smile", jersey: "india", cap: "cap", frame: "lime", role: "wk", number: 17 }) });
assert(kit.status === 200 && kit.body.look.icon === "🧤", "avatar kit saved");
const locked = await call("/api/avatar", admin, { method: "POST", body: JSON.stringify({ face: "lion", jersey: "lime", cap: "cap", frame: "lime", role: "bat", number: 7 }) });
assert(locked.status === 409, "locked avatar piece refused");

const banned = await call("/api/admin/campaigns", admin, {
  method: "POST",
  body: JSON.stringify({
    brand: "Odds House",
    category: "betting",
    name: "No odds",
    status: "active",
    creative: { type: "native", slot: "home_native", headline: "Odds", body: "Prices", cta: "Bet" },
  }),
});
assert(banned.status === 400, "betting sponsor refused");

const play = await call("/api/play", admin);
assert(play.status === 200 && play.body.chips?.chips?.length === 3, "earned chips");
const puzzle = play.body.puzzle.puzzles[0];
let solved = false;
for (const opt of puzzle.options) {
  const ans = await call("/api/puzzle", admin, { method: "POST", body: JSON.stringify({ key: puzzle.key, answer: opt.id }) });
  if (ans.status === 409) { solved = true; break; }
  if (ans.status === 200 && (ans.body.attempts || []).some((a) => a.key === puzzle.key && a.correct)) { solved = true; break; }
}
assert(solved, "puzzle answered");

const packs = [];
for (let i = 0; i < 3; i++) packs.push(await call("/api/album/pack", admin, { method: "POST" }));
assert(packs.some((p) => p.status === 409), "sticker packs cap at two a day");

const squad = await call("/api/squads", admin, { method: "POST", body: JSON.stringify({ title: "Night Watch" }) });
assert(squad.status === 200 && squad.body.referralCode, "squad created");
const boardSq = await call("/api/squads", admin);
assert((boardSq.body.yours || []).length > 0, "squad board");

const note = await call(`/api/matches/${live.key}/danmaku`, admin, { method: "POST", body: JSON.stringify({ body: "Shot!" }) });
assert(note.status === 200, "danmaku");
const odds = await call(`/api/matches/${live.key}/danmaku`, admin, { method: "POST", body: JSON.stringify({ body: "give me odds" }) });
assert(odds.status === 400, "danmaku blocks betting");

const vote = await call(`/api/matches/${live.key}/vote`, admin);
if (vote.body?.open && vote.body.players?.[0]) {
  const cast = await call(`/api/matches/${live.key}/vote`, admin, { method: "POST", body: JSON.stringify({ category: "potm", playerId: vote.body.players[0].id }) });
  assert(cast.status === 200, "fan vote");
} else {
  assert(vote.status === 200, "fan vote state");
}

const pin = await call("/api/live/pin", admin, { method: "POST", body: JSON.stringify({ chatId: "-1004458549838", matchKey: live.key }) });
assert(pin.status === 200 && pin.body.text.includes("LIVE"), "pinned live score");
const card = await call(`/api/live/card?matchKey=${live.key}`, admin);
assert(card.status === 200 && card.body.text, "inline score card text");

const upcomingTicket = home.body.matches.find((m) => m.status === "upcoming");
const ticket = await call("/api/tickets", admin, { method: "POST", body: JSON.stringify({ matchKey: upcomingTicket.key, teamKey: upcomingTicket.teams.a.key }) });
assert(ticket.status === 200 || ticket.body?.error === "TOO_EARLY" || ticket.body?.error === "CLOSED", "ticket gate");

const young = await call("/api/auth/age", admin, { method: "POST", body: JSON.stringify({ birthYear: 2016, parentConsent: true }) });
assert(young.status === 403, "under 13 refused");

const proId = 8860632140;
const pro = sign({ id: proId, first_name: "Lino", username: "Liveline_proadmin" });
const proMe = await call("/api/me", pro);
assert(proMe.status === 200 && proMe.body.user.admin === true, "second admin id is a full admin");

let roster = await call("/api/admin/admins", admin);
assert(roster.status === 200, "admin roster");
for (const row of roster.body.admins || []) {
  const keep = row.telegramId === String(adminId) || row.telegramId === String(proId);
  if (!keep) await call(`/api/admin/admins/${row.id}/remove`, admin, { method: "POST" });
}
roster = await call("/api/admin/admins", admin);
const defaults = roster.body.admins || [];
const first = defaults.find((row) => row.telegramId === String(adminId) && row.role === "full");
const second = defaults.find((row) => row.telegramId === String(proId) && row.role === "full");
assert(first && second, "both default ids are full admins");

const handle = `night${Date.now().toString().slice(-8)}`;
const added = await call("/api/admin/admins", admin, { method: "POST", body: JSON.stringify({ handle: `@${handle}`, role: "full" }) });
assert(added.status === 200 && added.body.bound === false, "panel adds a username admin");
const boundId = 88008821;
const bound = sign({ id: boundId, first_name: "Night", username: handle });
const boundMe = await call("/api/me", bound);
assert(boundMe.status === 200 && boundMe.body.user.admin === true, "username admin binds on first open");
const renamed = sign({ id: boundId, first_name: "Night", username: "renamed_later" });
const renamedMe = await call("/api/me", renamed);
assert(renamedMe.status === 200 && renamedMe.body.user.admin === true, "bound id keeps admin after a username change");
const impostor = sign({ id: 88008822, first_name: "Copy", username: handle });
const impostorMe = await call("/api/me", impostor);
assert(impostorMe.status === 200 && impostorMe.body.user.admin === false, "a taken username does not grant admin");
const removed = await call(`/api/admin/admins/${added.body.id}/remove`, admin, { method: "POST" });
assert(removed.status === 200, "panel removes an admin");
const strangerAdmin = await call("/api/admin/admins", stranger);
assert(strangerAdmin.status === 403 && strangerAdmin.body.error === "ADMIN_ONLY", "stranger cannot open the roster");

console.log("e2e passed");
