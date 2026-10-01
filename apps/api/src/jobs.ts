import { Queue, Worker } from "bullmq";
import { env } from "./env";
import { bullConnection } from "./redis";
import { dailySummary, fireReminder, maybeStreakNudges, requeueReminders } from "./services/alerts";
import { refreshBalance } from "./services/rewards";

export async function startWorkers() {
  const connection = bullConnection();
  new Worker("ll-reminders", async (job) => fireReminder(String(job.data.id)), { connection });
  new Worker("ll-summary", async () => dailySummary(), { connection });
  new Worker("ll-balance", async () => {
    await refreshBalance().catch(() => undefined);
    await maybeStreakNudges().catch(() => undefined);
  }, { connection });

  const summary = new Queue("ll-summary", { connection });
  const balance = new Queue("ll-balance", { connection });
  await summary.add("daily", {}, { repeat: { pattern: "30 3 * * *" }, jobId: "daily-summary" }).catch(() => undefined);
  await balance.add("check", {}, { repeat: { every: 60 * 60 * 1000 }, jobId: "gift-balance" }).catch(() => undefined);
  await requeueReminders().catch((err) => {
    console.error(JSON.stringify({ level: "warn", msg: "requeue", err: String(err) }));
  });
  console.log(JSON.stringify({ level: "info", msg: "workers started", port: env.workerHealthPort }));
}
