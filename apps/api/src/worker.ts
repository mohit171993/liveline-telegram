import http from "http";
import { env } from "./env";
import { onFeedEvents, startPoller } from "./feed";
import { handleFeed } from "./services/alerts";
import { startWorkers } from "./jobs";
import { refreshBalance } from "./services/rewards";
import { channelTick } from "./services/channel";
import { runReminders } from "./services/reminders";
import { runBroadcasts } from "./services/crm";

function every(ms: number, name: string, fn: () => Promise<unknown>) {
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    fn().catch((err) => console.error(JSON.stringify({ level: "error", msg: name, err: String(err) }))).finally(() => { busy = false; });
  }, ms);
}

async function main() {
  onFeedEvents(handleFeed);
  startPoller();
  await startWorkers();
  every(30_000, "channel-tick", () => channelTick());
  every(15_000, "broadcasts", () => runBroadcasts());
  every(5 * 60_000, "reminders", () => runReminders());
  http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }).listen(process.env.RAILWAY_ENVIRONMENT ? Number(process.env.PORT || env.workerHealthPort) : env.workerHealthPort, "0.0.0.0");
  console.log(JSON.stringify({ level: "info", msg: "worker up", health: env.workerHealthPort }));
  void giftportSelfCheck();
}

/** One GiftPort /balance call at boot so the logs show whether this egress IP is whitelisted. */
async function giftportSelfCheck() {
  let egressIp = "unknown";
  try {
    const res = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(5000) });
    egressIp = String(((await res.json()) as { ip?: string }).ip || "unknown");
  } catch { /* best effort */ }
  try {
    const snap = await refreshBalance();
    console.log(JSON.stringify({ level: "info", msg: "giftport-balance", provider: snap.provider, ok: snap.ok, balance: snap.balance, currency: snap.currency, message: snap.message, egressIp }));
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", msg: "giftport-balance", ok: false, err: String(err), egressIp }));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
