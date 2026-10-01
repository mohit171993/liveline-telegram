import http from "http";
import { env } from "./env";
import { onFeedEvents, startPoller } from "./feed";
import { handleFeed } from "./services/alerts";
import { startWorkers } from "./jobs";

async function main() {
  onFeedEvents(handleFeed);
  startPoller();
  await startWorkers();
  http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }).listen(process.env.RAILWAY_ENVIRONMENT ? Number(process.env.PORT || env.workerHealthPort) : env.workerHealthPort, "0.0.0.0");
  console.log(JSON.stringify({ level: "info", msg: "worker up", health: env.workerHealthPort }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
