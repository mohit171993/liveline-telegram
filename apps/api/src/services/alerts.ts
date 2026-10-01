import { Queue } from "bullmq";
import { prisma } from "@liveline/db";
import { formatIst, istDay, parseAdminList, projectMatch, type AdvanceResult } from "@liveline/shared";
import { env, channelUrl } from "../env";
import { bullConnection } from "../redis";
import { redis } from "../redis";
import { sendTelegramMessage } from "../telegram";
import { httpError } from "../httpError";
import { settleFeed } from "./game";
import { maybeStreakNudges, nudgePredictionWindow, settleOversGuess } from "./engage";
import { alertVoteOpen, settleLeagueWeek, syncLivePins } from "./play";

const ALERTS = ["start", "wicket", "fifty", "hundred", "innings", "result", "prediction"] as const;

let reminderQueue: Queue | null = null;

export function queues() {
  if (!reminderQueue) reminderQueue = new Queue("ll-reminders", { connection: bullConnection() });
  return { reminders: reminderQueue };
}

export async function handleFeed(events: AdvanceResult[]) {
  await settleFeed(events);
  for (const event of events) {
    await settleOversGuess(event.match).catch(() => undefined);
    const over = event.events.find((name) => name.startsWith("over:"));
    if (over) await nudgePredictionWindow(event.match, over).catch(() => undefined);
    await dispatch(event);
    await channelPost(event);
    const legal = event.match.innings[event.match.current]?.legalBalls || 0;
    await syncLivePins(event.match.key).catch(() => undefined);
    await alertVoteOpen(event.match.key, event.match.status, legal, event.match.maxOvers, event.match.name).catch(() => undefined);
  }
  await settleLeagueWeek().catch(() => undefined);
}

export { maybeStreakNudges };

function kinds(event: AdvanceResult): string[] {
  const out: string[] = [];
  for (const name of event.events) {
    if (name.startsWith("start:")) out.push("start");
    if (name.startsWith("wicket:")) out.push("wicket");
    if (name.startsWith("fifty:")) out.push("fifty");
    if (name.startsWith("hundred:")) out.push("hundred");
    if (name.startsWith("innings_break:")) out.push("innings");
    if (name.startsWith("result:")) out.push("result");
    if (name.startsWith("over:")) out.push("prediction");
  }
  if (event.moment === "WICKET") out.push("wicket");
  return [...new Set(out)];
}

async function dispatch(event: AdvanceResult) {
  const wanted = kinds(event);
  if (!wanted.length) return;
  const match = event.match;
  const reminders = await prisma.reminder.findMany({
    where: {
      status: "active",
      OR: [
        { matchKey: match.key },
        { seriesKey: match.seriesKey },
        { teamKey: { in: [match.teams.a.key, match.teams.b.key] } },
      ],
    },
    include: { user: true },
  });
  const view = projectMatch(match, false);
  for (const reminder of reminders) {
    const types = safeList(reminder.alertTypes);
    const hit = wanted.filter((kind) => types.includes(kind));
    if (!hit.length) continue;
    for (const kind of hit) {
      const dedupeKey = `${reminder.userId}:${match.key}:${kind}:${event.ball?.i ?? event.events.join("|")}`;
      const title = `${match.teams.a.code} vs ${match.teams.b.code}`;
      const body = alertBody(kind, view, match.result);
      try {
        await prisma.notification.create({
          data: { userId: reminder.userId, kind, title, body, matchKey: match.key, dedupeKey },
        });
      } catch {
        continue;
      }
      await sendTelegramMessage(reminder.user.telegramId, `🔔 <b>${title}</b>\n${body}`).catch(() => undefined);
    }
  }
}

function alertBody(kind: string, view: ReturnType<typeof projectMatch>, result?: string): string {
  if (kind === "result") return result || "Match finished";
  if (!view.live) return view.result || kind;
  if (kind === "wicket") return `Wicket. ${view.teams[view.live.batting].code} ${view.live.runs}/${view.live.wickets} (${view.live.overs})`;
  if (kind === "fifty" || kind === "hundred") return `${kind === "hundred" ? "Hundred" : "Fifty"}. ${view.live.striker?.name || ""} ${view.live.striker?.runs || ""}`;
  if (kind === "prediction") return `Prediction window is open. ${view.live.need || `CRR ${view.live.crr}`}`;
  if (kind === "innings") return "Innings break.";
  return `${view.teams.a.code} ${view.scoreline.a} · ${view.teams.b.code} ${view.scoreline.b}`;
}

async function channelPost(event: AdvanceResult) {
  if (!env.channelId) return;
  const interesting = event.moment === "WICKET" || event.events.some((e) => e.startsWith("over:") || e.startsWith("result:") || e.startsWith("start:"));
  if (!interesting) return;
  const token = `${event.match.key}:${event.ball?.i ?? event.events[0] ?? event.moment}`;
  const ok = await redis.set(`ll:chan:${token}`, "1", "EX", 3600, "NX");
  if (!ok) return;
  const view = projectMatch(event.match, false);
  const line = view.live
    ? `${view.teams[view.live.batting].flag} <b>${view.teams[view.live.batting].code} ${view.live.runs}/${view.live.wickets}</b> (${view.live.overs})\n${view.live.need || `CRR ${view.live.crr}`}`
    : `<b>${view.name}</b>\n${view.result || "Upcoming"}`;
  const link = channelUrl() ? `\n${env.webappUrl}` : "";
  await sendTelegramMessage(env.channelId, `🏏 ${view.name}\n${line}${link}`).catch(() => undefined);
}

export async function listReminders(userId: string) {
  const [reminders, history] = await Promise.all([
    prisma.reminder.findMany({ where: { userId, status: "active" }, orderBy: { createdAt: "desc" } }),
    prisma.notification.findMany({ where: { userId }, orderBy: { sentAt: "desc" }, take: 40 }),
  ]);
  return { reminders, history, types: ALERTS };
}

export async function createReminder(userId: string, input: {
  matchKey?: string;
  teamKey?: string;
  seriesKey?: string;
  minutesBefore?: number;
  alertTypes: string[];
  startAt?: number;
}) {
  const types = input.alertTypes.filter((t) => (ALERTS as readonly string[]).includes(t));
  if (!types.length) throw httpError(400, "NO_TYPES");
  if (!input.matchKey && !input.teamKey && !input.seriesKey) throw httpError(400, "NO_TARGET");
  const fireAt = input.minutesBefore && input.startAt ? new Date(input.startAt - input.minutesBefore * 60_000) : null;
  const reminder = await prisma.reminder.create({
    data: {
      userId,
      matchKey: input.matchKey,
      teamKey: input.teamKey,
      seriesKey: input.seriesKey,
      minutesBefore: input.minutesBefore,
      alertTypes: JSON.stringify(types),
      fireAt,
    },
  });
  if (fireAt && fireAt.getTime() > Date.now()) {
    const delay = fireAt.getTime() - Date.now();
    await queues().reminders.add("fire", { id: reminder.id }, { delay, jobId: reminder.id, removeOnComplete: true });
  }
  return reminder;
}

export async function updateReminder(userId: string, id: string, patch: { alertTypes?: string[]; minutesBefore?: number; startAt?: number }) {
  const existing = await prisma.reminder.findFirst({ where: { id, userId } });
  if (!existing) throw httpError(404, "NOT_FOUND");
  const fireAt = patch.minutesBefore && patch.startAt ? new Date(patch.startAt - patch.minutesBefore * 60_000) : existing.fireAt;
  const reminder = await prisma.reminder.update({
    where: { id },
    data: {
      alertTypes: patch.alertTypes ? JSON.stringify(patch.alertTypes) : existing.alertTypes,
      minutesBefore: patch.minutesBefore ?? existing.minutesBefore,
      fireAt,
    },
  });
  if (fireAt && fireAt.getTime() > Date.now()) {
    const job = await queues().reminders.getJob(id);
    await job?.remove();
    await queues().reminders.add("fire", { id }, { delay: fireAt.getTime() - Date.now(), jobId: id, removeOnComplete: true });
  }
  return reminder;
}

export async function deleteReminder(userId: string, id: string) {
  const existing = await prisma.reminder.findFirst({ where: { id, userId } });
  if (!existing) throw httpError(404, "NOT_FOUND");
  await prisma.reminder.update({ where: { id }, data: { status: "deleted" } });
  const job = await queues().reminders.getJob(id).catch(() => null);
  await job?.remove().catch(() => undefined);
  return { ok: true };
}

export async function fireReminder(id: string) {
  const reminder = await prisma.reminder.findUnique({ where: { id }, include: { user: true } });
  if (!reminder || reminder.status !== "active") return;
  const dedupeKey = `rem:${reminder.id}:${reminder.fireAt?.toISOString() || "once"}`;
  const body = `Your reminder is due${reminder.matchKey ? ` for ${reminder.matchKey}` : ""}. Open LiveLine.`;
  try {
    await prisma.notification.create({
      data: { userId: reminder.userId, kind: "reminder", title: "Match reminder", body, matchKey: reminder.matchKey, dedupeKey },
    });
  } catch {
    return;
  }
  await sendTelegramMessage(reminder.user.telegramId, `⏰ <b>LiveLine reminder</b>\n${body}\n${env.webappUrl}`);
  if (reminder.minutesBefore) await prisma.reminder.update({ where: { id }, data: { status: "fired" } });
}

export async function requeueReminders() {
  const rows = await prisma.reminder.findMany({
    where: { status: "active", fireAt: { gt: new Date() } },
  });
  for (const row of rows) {
    if (!row.fireAt) continue;
    const job = await queues().reminders.getJob(row.id).catch(() => null);
    if (job) continue;
    await queues().reminders.add("fire", { id: row.id }, { delay: row.fireAt.getTime() - Date.now(), jobId: row.id, removeOnComplete: true });
  }
}

export async function dailySummary() {
  const day = istDay();
  const start = new Date(`${day}T00:00:00+05:30`);
  const [newUsers, activeSessions, impressions, clicks, top] = await Promise.all([
    prisma.user.count({ where: { status: "ACTIVE", createdAt: { gte: start } } }),
    prisma.session.findMany({ where: { startedAt: { gte: start } }, distinct: ["userId"], select: { userId: true } }),
    prisma.adEvent.count({ where: { type: "impression", createdAt: { gte: start } } }),
    prisma.adEvent.count({ where: { type: "click", createdAt: { gte: start } } }),
    prisma.matchViewStat.findMany({ where: { day }, orderBy: { views: "desc" }, take: 3 }),
  ]);
  const text = [
    `📊 <b>LiveLine daily summary</b> · ${formatIst(new Date())} IST`,
    `New users: ${newUsers}`,
    `DAU: ${activeSessions.length}`,
    `Top matches: ${top.map((t) => `${t.matchKey} (${t.views})`).join(", ") || "—"}`,
    `Ad impressions: ${impressions}`,
    `Ad clicks: ${clicks}`,
  ].join("\n");
  const chats = new Set<string>([...parseAdminList(env.adminRaw).ids]);
  if (env.adminAlertChat) chats.add(env.adminAlertChat);
  for (const chat of chats) await sendTelegramMessage(chat, text).catch(() => undefined);
}

function safeList(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export { ALERTS };
