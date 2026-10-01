import { env } from "./env";
import { buildServer } from "./server";
import { onFeedEvents, startPoller } from "./feed";
import { handleFeed } from "./services/alerts";
import { startWorkers } from "./jobs";
import { ensureRewardTables } from "./services/rewards";

// A stray rejected promise (closed socket, flaky upstream) must not take the API down for everyone.
process.on("unhandledRejection", (reason) => {
  console.error(JSON.stringify({ level: "error", msg: "unhandledRejection", err: String((reason as Error)?.stack || reason) }));
});

async function main() {
  onFeedEvents(handleFeed);
  const app = await buildServer();
  await app.listen({ port: env.port, host: "0.0.0.0" });
  await ensureRewardTables().catch((err) => app.log.error({ err: String(err) }, "reward tables"));
  startPoller();
  if (env.embeddedWorker) {
    await startWorkers();
  }
  app.log.info({ port: env.port, mock: env.useMockProvider }, "liveline api up");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
