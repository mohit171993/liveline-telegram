import { env } from "./env";
import { buildServer } from "./server";
import { onFeedEvents, startPoller } from "./feed";
import { handleFeed } from "./services/alerts";
import { startWorkers } from "./jobs";

async function main() {
  onFeedEvents(handleFeed);
  const app = await buildServer();
  await app.listen({ port: env.port, host: "0.0.0.0" });
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
