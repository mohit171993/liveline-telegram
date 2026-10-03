import { prisma } from "@liveline/db";
import {
  formatIst,
  istDay,
  referralSource,
  reportWindow,
  retentionRate,
  trendPct,
  type ReportWindow,
} from "@liveline/shared";
import { env, telegramDryRun } from "../env";
import { httpError } from "../httpError";
import { getChatMemberCount } from "../telegram";

export type SectionId = "users" | "engagement" | "matches" | "ads" | "rewards" | "channel";

export type Kpi = { id: string; label: string; value: number; display: string; delta: number | null };
export type Chart = { id: string; title: string; kind: "line" | "bar"; points: { x: string; y: number }[] };
export type Table = { id: string; title: string; columns: [string, string]; rows: { label: string; value: string }[] };
export type Section = { title: string; kpis: Kpi[]; charts: Chart[]; tables: Table[] };

export type AnalyticsReport = {
  range: { preset: string; from: string; to: string };
  sections: Record<SectionId, Section>;
};

const SECTIONS: SectionId[] = ["users", "engagement", "matches", "ads", "rewards", "channel"];

export function parseSection(value: string | undefined): SectionId {
  if (SECTIONS.includes(value as SectionId)) return value as SectionId;
  throw new Error("SECTION");
}

export async function buildAnalytics(query: { preset?: string; from?: string; to?: string }): Promise<AnalyticsReport> {
  let window: ReportWindow;
  try {
    window = reportWindow(query);
  } catch {
    throw httpError(400, "CUSTOM_RANGE", "Pick a start and end date.");
  }
  await snapshotChannel().catch(() => undefined);
  const [current, previous, series, retention, splits, matches, ads, rewards, channel] = await Promise.all([
    pulse(window.start, window.end),
    pulse(window.prevStart, window.prevEnd),
    seriesFor(window),
    retentionFor(window),
    splitsFor(window),
    matchesFor(window),
    adsFor(window),
    rewardsFor(window),
    channelFor(window),
  ]);
  const subsNow = channel.latest;
  const subsPrev = channel.previous;
  const sections: Record<SectionId, Section> = {
    users: usersSection(current, previous, series, retention, splits),
    engagement: engagementSection(current, previous, series),
    matches: matches.section,
    ads: withAdTrends(ads, current, previous),
    rewards: rewardsSection(current, previous, rewards),
    channel: channelSection(current, previous, channel, subsNow, subsPrev),
  };
  reportTop(sections.engagement, splits.top);
  return {
    range: { preset: window.preset, from: window.fromDay, to: window.toDay },
    sections,
  };
}

export function sectionCsv(section: SectionId, report: AnalyticsReport): string {
  const block = report.sections[section];
  const lines = [`section,${section}`, `from,${report.range.from}`, `to,${report.range.to}`, ""];
  lines.push("metric,value,change_pct");
  for (const kpi of block.kpis) lines.push([cell(kpi.label), cell(kpi.display), kpi.delta == null ? "" : String(kpi.delta)].join(","));
  for (const chart of block.charts) {
    lines.push("", cell(chart.title), "label,value");
    for (const point of chart.points) lines.push([cell(point.x), String(point.y)].join(","));
  }
  for (const table of block.tables) {
    lines.push("", cell(table.title), table.columns.map(cell).join(","));
    for (const row of table.rows) lines.push([cell(row.label), cell(row.value)].join(","));
  }
  return lines.join("\n");
}

export function formatDailySummary(report: AnalyticsReport): string {
  const users = kpiMap(report.sections.users);
  const play = kpiMap(report.sections.engagement);
  const ads = kpiMap(report.sections.ads);
  const rewards = kpiMap(report.sections.rewards);
  const channel = kpiMap(report.sections.channel);
  const top = report.sections.matches.tables[0]?.rows[0];
  return [
    `📊 <b>LiveLine daily summary</b> · ${formatIst(new Date())} IST`,
    "",
    `<b>Users</b>`,
    `New: ${users.New || "0"}`,
    `Total ${users.Total || "0"} · Verified ${users.Verified || "0"} · Unverified ${users.Unverified || "0"}`,
    `DAU ${users.DAU || "0"} · WAU ${users.WAU || "0"} · MAU ${users.MAU || "0"}`,
    `Retention D1 ${users["D1"] || "—"} · D7 ${users["D7"] || "—"} · D30 ${users["D30"] || "—"}`,
    `Premium ${users.Premium || "0"} · Standard ${users.Standard || "0"}`,
    "",
    `<b>Engagement</b>`,
    `Opens ${play.Opens || "0"} · Avg session ${play["Avg session"] || "0s"}`,
    `Predictions ${play.Predictions || "0"} · Spins ${play.Spins || "0"} · Scratch ${play.Scratch || "0"}`,
    `Buddy ${play["Buddy chats"] || "0"} · Trivia ${play.Trivia || "0"} · Reminders ${play.Reminders || "0"}`,
    "",
    `<b>Matches</b>`,
    top ? `${top.label} · ${top.value}` : "No match views",
    "",
    `<b>Ads</b>`,
    `Impressions ${ads.Impressions || "0"} · Clicks ${ads.Clicks || "0"} · CTR ${ads.CTR || "0%"}`,
    "",
    `<b>Rewards</b>`,
    `Vouchers ${rewards.Issued || "0"} · Spend ${rewards.Spend || "₹0"} · Wallet ${rewards.Wallet || "—"}`,
    `Pending ${rewards.Pending || "0"} · Failed ${rewards.Failed || "0"}`,
    "",
    `<b>Channel</b>`,
    `Posts ${channel.Posts || "0"} · Views ${channel.Views || "0"} · Subscribers ${channel.Subscribers || "—"}`,
  ].join("\n");
}

type Pulse = {
  signups: number;
  total: number;
  verified: number;
  unverified: number;
  premium: number;
  standard: number;
  dau: number;
  wau: number;
  mau: number;
  opens: number;
  avgSeconds: number;
  predictions: number;
  spins: number;
  scratches: number;
  ai: number;
  trivia: number;
  reminders: number;
  impressions: number;
  clicks: number;
  issued: number;
  pending: number;
  failed: number;
  spend: number;
  posts: number;
  postViews: number;
};

async function pulse(start: Date, end: Date): Promise<Pulse> {
  const dauStart = new Date(end.getTime() - 86_400_000);
  const wauStart = new Date(end.getTime() - 7 * 86_400_000);
  const mauStart = new Date(end.getTime() - 30 * 86_400_000);
  const [
    signups, total, verified, premium,
    dau, wau, mau, opens, avgRow,
    predictions, spins, scratches, aiRows, trivia, reminders,
    impressions, clicks, orders, posts,
  ] = await Promise.all([
    prisma.user.count({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.user.count({ where: { createdAt: { lt: end } } }),
    prisma.user.count({ where: { createdAt: { lt: end }, phoneVerifiedAt: { not: null } } }),
    prisma.user.count({ where: { createdAt: { lt: end }, isPremium: true } }),
    distinctUsers(dauStart, end),
    distinctUsers(wauStart, end),
    distinctUsers(mauStart, end),
    prisma.session.count({ where: { startedAt: { gte: start, lt: end } } }),
    prisma.$queryRaw<{ avg: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM ("lastSeen" - "startedAt")))::float AS avg
      FROM "Session"
      WHERE "startedAt" >= ${start} AND "startedAt" < ${end}
    `,
    prisma.prediction.count({ where: { lockedAt: { gte: start, lt: end } } }),
    prisma.spin.count({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.scratchCard.count({ where: { openedAt: { gte: start, lt: end } } }),
    prisma.$queryRaw<{ n: number | null }[]>`
      SELECT COALESCE(SUM("count"), 0)::int AS n FROM "AiUsage"
      WHERE day >= ${istKey(start)} AND day < ${istKey(end)}
    `,
    prisma.playEntry.count({ where: { kind: "trivia", settledAt: { gte: start, lt: end } } }),
    prisma.reminder.count({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.adEvent.count({ where: { type: "impression", createdAt: { gte: start, lt: end } } }),
    prisma.adEvent.count({ where: { type: "click", createdAt: { gte: start, lt: end } } }),
    prisma.voucherOrder.groupBy({
      by: ["status"],
      where: { createdAt: { gte: start, lt: end } },
      _count: true,
      _sum: { amountInr: true },
    }),
    prisma.channelPost.aggregate({
      where: { postedAt: { gte: start, lt: end } },
      _count: true,
      _sum: { views: true },
    }),
  ]);
  const issued = orders.filter((row) => row.status === "success").reduce((sum, row) => sum + row._count, 0);
  const failed = orders.filter((row) => row.status === "failed").reduce((sum, row) => sum + row._count, 0);
  const pending = orders.filter((row) => row.status !== "success" && row.status !== "failed").reduce((sum, row) => sum + row._count, 0);
  const spend = orders.filter((row) => row.status === "success").reduce((sum, row) => sum + (row._sum.amountInr || 0), 0);
  return {
    signups, total, verified, unverified: Math.max(0, total - verified),
    premium, standard: Math.max(0, total - premium),
    dau, wau, mau, opens,
    avgSeconds: Number(avgRow[0]?.avg || 0),
    predictions, spins, scratches,
    ai: Number(aiRows[0]?.n || 0),
    trivia, reminders, impressions, clicks,
    issued, pending, failed, spend,
    posts: posts._count,
    postViews: posts._sum.views || 0,
  };
}

async function distinctUsers(start: Date, end: Date): Promise<number> {
  const rows = await prisma.session.findMany({
    where: { startedAt: { gte: start, lt: end } },
    distinct: ["userId"],
    select: { userId: true },
  });
  return rows.length;
}

type Series = {
  signups: { x: string; y: number }[];
  weeks: { x: string; y: number }[];
  months: { x: string; y: number }[];
  dau: { x: string; y: number }[];
  opens: { x: string; y: number }[];
  predictions: { x: string; y: number }[];
};

async function seriesFor(window: ReportWindow): Promise<Series> {
  const [signups, weeks, months, activity, predictions] = await Promise.all([
    prisma.$queryRaw<{ day: string; n: number }[]>`
      SELECT to_char((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS n
      FROM "User"
      WHERE "createdAt" >= ${window.start} AND "createdAt" < ${window.end}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw<{ week: string; n: number }[]>`
      SELECT to_char(date_trunc('week', (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')), 'YYYY-MM-DD') AS week,
             COUNT(*)::int AS n
      FROM "User"
      WHERE "createdAt" >= ${window.start} AND "createdAt" < ${window.end}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw<{ month: string; n: number }[]>`
      SELECT to_char(date_trunc('month', (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')), 'YYYY-MM') AS month,
             COUNT(*)::int AS n
      FROM "User"
      WHERE "createdAt" >= ${window.start} AND "createdAt" < ${window.end}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw<{ day: string; opens: number; dau: number }[]>`
      SELECT to_char((("startedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS opens,
             COUNT(DISTINCT "userId")::int AS dau
      FROM "Session"
      WHERE "startedAt" >= ${window.start} AND "startedAt" < ${window.end}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw<{ day: string; n: number }[]>`
      SELECT to_char((("lockedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS n
      FROM "Prediction"
      WHERE "lockedAt" >= ${window.start} AND "lockedAt" < ${window.end}
      GROUP BY 1 ORDER BY 1
    `,
  ]);
  return {
    signups: fill(window, signups.map((row) => ({ day: row.day, y: num(row.n) }))),
    weeks: weeks.map((row) => ({ x: row.week.slice(5), y: num(row.n) })),
    months: months.map((row) => ({ x: row.month, y: num(row.n) })),
    dau: fill(window, activity.map((row) => ({ day: row.day, y: num(row.dau) }))),
    opens: fill(window, activity.map((row) => ({ day: row.day, y: num(row.opens) }))),
    predictions: fill(window, predictions.map((row) => ({ day: row.day, y: num(row.n) }))),
  };
}

async function retentionFor(window: ReportWindow) {
  const rows = await prisma.$queryRaw<{
    d1_eligible: number; d1_back: number;
    d7_eligible: number; d7_back: number;
    d30_eligible: number; d30_back: number;
  }[]>`
    WITH cohort AS (
      SELECT id, (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date AS joined
      FROM "User"
      WHERE "createdAt" >= ${window.start} AND "createdAt" < ${window.end}
    )
    SELECT
      COUNT(*) FILTER (WHERE joined <= ${window.toDay}::date - 1)::int AS d1_eligible,
      COUNT(*) FILTER (WHERE joined <= ${window.toDay}::date - 1 AND EXISTS (
        SELECT 1 FROM "Session" s WHERE s."userId" = cohort.id
          AND (("startedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date = joined + 1
      ))::int AS d1_back,
      COUNT(*) FILTER (WHERE joined <= ${window.toDay}::date - 7)::int AS d7_eligible,
      COUNT(*) FILTER (WHERE joined <= ${window.toDay}::date - 7 AND EXISTS (
        SELECT 1 FROM "Session" s WHERE s."userId" = cohort.id
          AND (("startedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date = joined + 7
      ))::int AS d7_back,
      COUNT(*) FILTER (WHERE joined <= ${window.toDay}::date - 30)::int AS d30_eligible,
      COUNT(*) FILTER (WHERE joined <= ${window.toDay}::date - 30 AND EXISTS (
        SELECT 1 FROM "Session" s WHERE s."userId" = cohort.id
          AND (("startedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date = joined + 30
      ))::int AS d30_back
    FROM cohort
  `;
  const row = rows[0];
  return {
    d1: retentionRate(num(row?.d1_back), num(row?.d1_eligible)),
    d7: retentionRate(num(row?.d7_back), num(row?.d7_eligible)),
    d30: retentionRate(num(row?.d30_back), num(row?.d30_eligible)),
  };
}

async function splitsFor(window: ReportWindow) {
  const [languages, sources, top] = await Promise.all([
    prisma.$queryRaw<{ language: string; n: number }[]>`
      SELECT "languageCode" AS language, COUNT(*)::int AS n
      FROM "User"
      WHERE "createdAt" < ${window.end}
      GROUP BY 1 ORDER BY n DESC
    `,
    prisma.$queryRaw<{ source: string | null; n: number }[]>`
      SELECT COALESCE("startParam", '') AS source, COUNT(*)::int AS n
      FROM "User"
      WHERE "createdAt" >= ${window.start} AND "createdAt" < ${window.end}
      GROUP BY 1 ORDER BY n DESC
    `,
    prisma.$queryRaw<{ name: string; username: string | null; opens: number }[]>`
      SELECT COALESCE(NULLIF(u."firstName", ''), 'Fan') AS name, u.username, COUNT(s.id)::int AS opens
      FROM "Session" s
      JOIN "User" u ON u.id = s."userId"
      WHERE s."startedAt" >= ${window.start} AND s."startedAt" < ${window.end}
      GROUP BY u.id, u."firstName", u.username
      ORDER BY opens DESC
      LIMIT 8
    `,
  ]);
  const buckets = new Map<string, number>();
  for (const row of sources) {
    const label = referralSource(row.source);
    buckets.set(label, (buckets.get(label) || 0) + num(row.n));
  }
  return {
    languages: languages.map((row) => ({ label: (row.language || "en").toUpperCase(), value: String(num(row.n)) })),
    sources: [...buckets.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value: String(value) })),
    top: top.map((row) => ({ label: row.username ? `${row.name} @${row.username}` : row.name, value: `${num(row.opens)} opens` })),
    languageBars: languages.slice(0, 6).map((row) => ({ x: (row.language || "en").toUpperCase(), y: num(row.n) })),
  };
}

async function matchesFor(window: ReportWindow) {
  const [rows, days] = await Promise.all([
    prisma.$queryRaw<{ matchKey: string; views: number; peak: number }[]>`
      SELECT "matchKey", SUM(views)::int AS views, MAX(peak)::int AS peak
      FROM "MatchViewStat"
      WHERE day >= ${window.fromDay} AND day <= ${window.toDay}
      GROUP BY "matchKey"
      ORDER BY views DESC
      LIMIT 8
    `,
    prisma.$queryRaw<{ day: string; views: number; peak: number }[]>`
      SELECT day, SUM(views)::int AS views, MAX(peak)::int AS peak
      FROM "MatchViewStat"
      WHERE day >= ${window.fromDay} AND day <= ${window.toDay}
      GROUP BY day ORDER BY day
    `,
  ]);
  const section: Section = {
    title: "Matches",
    kpis: [
      kpi("views", "Views", rows.reduce((sum, row) => sum + num(row.views), 0), null, String(rows.reduce((sum, row) => sum + num(row.views), 0))),
      kpi("peak", "Peak viewers", rows.reduce((max, row) => Math.max(max, num(row.peak)), 0), null),
      kpi("matches", "Matches", rows.length, null),
    ],
    charts: [
      { id: "views", title: "Views", kind: "line", points: fill(window, days.map((row) => ({ day: row.day, y: num(row.views) }))) },
      { id: "peak", title: "Peak concurrent", kind: "bar", points: fill(window, days.map((row) => ({ day: row.day, y: num(row.peak) }))) },
    ],
    tables: [{
      id: "top",
      title: "Most viewed",
      columns: ["Match", "Views · peak"],
      rows: rows.map((row) => ({ label: matchLabel(row.matchKey), value: `${num(row.views)} · peak ${num(row.peak)}` })),
    }],
  };
  return { section };
}

async function adsFor(window: ReportWindow): Promise<Section> {
  const rows = await prisma.$queryRaw<{ day: string; campaign: string; slot: string; impressions: number; clicks: number }[]>`
    SELECT to_char((("e"."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS day,
           c.name AS campaign,
           cr.slot AS slot,
           COUNT(*) FILTER (WHERE e.type = 'impression')::int AS impressions,
           COUNT(*) FILTER (WHERE e.type = 'click')::int AS clicks
    FROM "AdEvent" e
    JOIN "Creative" cr ON cr.id = e."creativeId"
    JOIN "Campaign" c ON c.id = cr."campaignId"
    WHERE e."createdAt" >= ${window.start} AND e."createdAt" < ${window.end}
    GROUP BY 1, c.name, cr.slot
    ORDER BY 1
  `;
  const byDay = new Map<string, { impressions: number; clicks: number }>();
  const byCampaign = new Map<string, { impressions: number; clicks: number }>();
  const bySlot = new Map<string, { impressions: number; clicks: number }>();
  for (const row of rows) {
    addBucket(byDay, row.day, row);
    addBucket(byCampaign, row.campaign, row);
    addBucket(bySlot, row.slot, row);
  }
  const impressions = [...byDay.values()].reduce((sum, row) => sum + row.impressions, 0);
  const clicks = [...byDay.values()].reduce((sum, row) => sum + row.clicks, 0);
  return {
    title: "Sponsors",
    kpis: [
      kpi("impr", "Impressions", impressions, null),
      kpi("clicks", "Clicks", clicks, null),
      kpi("ctr", "CTR", impressions ? (clicks / impressions) * 100 : 0, null, ctr(clicks, impressions)),
    ],
    charts: [
      { id: "impr", title: "Impressions", kind: "line", points: fill(window, [...byDay.entries()].map(([day, row]) => ({ day, y: row.impressions }))) },
      { id: "clicks", title: "Clicks", kind: "bar", points: fill(window, [...byDay.entries()].map(([day, row]) => ({ day, y: row.clicks }))) },
    ],
    tables: [
      {
        id: "campaigns",
        title: "By campaign",
        columns: ["Campaign", "Impr · clicks · CTR"],
        rows: [...byCampaign.entries()].sort((a, b) => b[1].impressions - a[1].impressions).slice(0, 12).map(([label, row]) => ({
          label, value: `${row.impressions} · ${row.clicks} · ${ctr(row.clicks, row.impressions)}`,
        })),
      },
      {
        id: "slots",
        title: "By placement",
        columns: ["Placement", "Impr · clicks · CTR"],
        rows: [...bySlot.entries()].sort((a, b) => b[1].impressions - a[1].impressions).map(([label, row]) => ({
          label: label.replace(/_/g, " "), value: `${row.impressions} · ${row.clicks} · ${ctr(row.clicks, row.impressions)}`,
        })),
      },
    ],
  };
}

async function rewardsFor(window: ReportWindow) {
  const [balance, days] = await Promise.all([
    prisma.giftportBalance.findFirst({ orderBy: { checkedAt: "desc" } }),
    prisma.$queryRaw<{ day: string; n: number; spend: number }[]>`
      SELECT to_char((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS day,
             COUNT(*) FILTER (WHERE status = 'success')::int AS n,
             COALESCE(SUM("amountInr") FILTER (WHERE status = 'success'), 0)::int AS spend
      FROM "VoucherOrder"
      WHERE "createdAt" >= ${window.start} AND "createdAt" < ${window.end}
      GROUP BY 1 ORDER BY 1
    `,
  ]);
  return {
    balance: balance ? `${balance.currency} ${Number(balance.balance || 0).toLocaleString("en-IN")}` : "—",
    balanceValue: Number(balance?.balance || 0),
    issued: fill(window, days.map((row) => ({ day: row.day, y: num(row.n) }))),
    spend: fill(window, days.map((row) => ({ day: row.day, y: num(row.spend) }))),
  };
}

async function channelFor(window: ReportWindow) {
  const [days, posts, previous] = await Promise.all([
    prisma.channelDay.findMany({
      where: { day: { gte: window.fromDay, lte: window.toDay } },
      orderBy: { day: "asc" },
    }),
    prisma.$queryRaw<{ day: string; posts: number; views: number }[]>`
      SELECT to_char((("postedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS posts,
             COALESCE(SUM(views), 0)::int AS views
      FROM "ChannelPost"
      WHERE "postedAt" >= ${window.start} AND "postedAt" < ${window.end}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.channelDay.findFirst({
      where: { day: { gte: istKey(window.prevStart), lt: window.fromDay } },
      orderBy: { day: "desc" },
    }),
  ]);
  return {
    latest: days.at(-1)?.subscribers ?? null,
    previous: previous?.subscribers ?? null,
    subs: fill(window, days.map((row) => ({ day: row.day, y: row.subscribers }))),
    posts: fill(window, posts.map((row) => ({ day: row.day, y: num(row.posts) }))),
    views: fill(window, posts.map((row) => ({ day: row.day, y: num(row.views) }))),
  };
}

function usersSection(
  current: Pulse,
  previous: Pulse,
  series: Series,
  retention: { d1: number | null; d7: number | null; d30: number | null },
  splits: Awaited<ReturnType<typeof splitsFor>>,
): Section {
  return {
    title: "Users",
    kpis: [
      kpi("new", "New", current.signups, trendPct(current.signups, previous.signups)),
      kpi("total", "Total", current.total, trendPct(current.total, previous.total)),
      kpi("verified", "Verified", current.verified, trendPct(current.verified, previous.verified)),
      kpi("unverified", "Unverified", current.unverified, trendPct(current.unverified, previous.unverified)),
      kpi("dau", "DAU", current.dau, trendPct(current.dau, previous.dau)),
      kpi("wau", "WAU", current.wau, trendPct(current.wau, previous.wau)),
      kpi("mau", "MAU", current.mau, trendPct(current.mau, previous.mau)),
      kpi("d1", "D1", retention.d1 || 0, null, retention.d1 == null ? "—" : `${retention.d1}%`),
      kpi("d7", "D7", retention.d7 || 0, null, retention.d7 == null ? "—" : `${retention.d7}%`),
      kpi("d30", "D30", retention.d30 || 0, null, retention.d30 == null ? "—" : `${retention.d30}%`),
      kpi("premium", "Premium", current.premium, trendPct(current.premium, previous.premium)),
      kpi("standard", "Standard", current.standard, trendPct(current.standard, previous.standard)),
    ],
    charts: [
      { id: "signups", title: "New users per day", kind: "bar", points: series.signups },
      { id: "weeks", title: "New users per week", kind: "bar", points: series.weeks },
      { id: "months", title: "New users per month", kind: "bar", points: series.months },
      { id: "dau", title: "Daily active", kind: "line", points: series.dau },
      { id: "lang", title: "Language", kind: "bar", points: splits.languageBars },
    ],
    tables: [
      { id: "sources", title: "Referral sources", columns: ["Source", "Users"], rows: splits.sources },
      { id: "languages", title: "Language split", columns: ["Language", "Users"], rows: splits.languages },
    ],
  };
}

function engagementSection(current: Pulse, previous: Pulse, series: Series): Section {
  return {
    title: "Engagement",
    kpis: [
      kpi("opens", "Opens", current.opens, trendPct(current.opens, previous.opens)),
      kpi("avg", "Avg session", current.avgSeconds, trendPct(current.avgSeconds, previous.avgSeconds), formatDuration(current.avgSeconds)),
      kpi("pred", "Predictions", current.predictions, trendPct(current.predictions, previous.predictions)),
      kpi("spins", "Spins", current.spins, trendPct(current.spins, previous.spins)),
      kpi("scratch", "Scratch", current.scratches, trendPct(current.scratches, previous.scratches)),
      kpi("ai", "Buddy chats", current.ai, trendPct(current.ai, previous.ai)),
      kpi("trivia", "Trivia", current.trivia, trendPct(current.trivia, previous.trivia)),
      kpi("rem", "Reminders", current.reminders, trendPct(current.reminders, previous.reminders)),
    ],
    charts: [
      { id: "opens", title: "Mini App opens", kind: "line", points: series.opens },
      { id: "pred", title: "Predictions", kind: "bar", points: series.predictions },
    ],
    tables: [],
  };
}

function rewardsSection(current: Pulse, previous: Pulse, extra: Awaited<ReturnType<typeof rewardsFor>>): Section {
  return {
    title: "Rewards",
    kpis: [
      kpi("issued", "Issued", current.issued, trendPct(current.issued, previous.issued)),
      kpi("spend", "Spend", current.spend, trendPct(current.spend, previous.spend), inr(current.spend)),
      kpi("wallet", "Wallet", extra.balanceValue, null, extra.balance),
      kpi("pending", "Pending", current.pending, trendPct(current.pending, previous.pending)),
      kpi("failed", "Failed", current.failed, trendPct(current.failed, previous.failed)),
    ],
    charts: [
      { id: "issued", title: "Vouchers issued", kind: "bar", points: extra.issued },
      { id: "spend", title: "GiftPort spend", kind: "line", points: extra.spend },
    ],
    tables: [],
  };
}

function channelSection(
  current: Pulse,
  previous: Pulse,
  extra: Awaited<ReturnType<typeof channelFor>>,
  subsNow: number | null,
  subsPrev: number | null,
): Section {
  const growth = subsNow == null ? null : subsNow - (subsPrev ?? subsNow);
  return {
    title: "Channel",
    kpis: [
      kpi("posts", "Posts", current.posts, trendPct(current.posts, previous.posts)),
      kpi("views", "Views", current.postViews, trendPct(current.postViews, previous.postViews)),
      kpi("subs", "Subscribers", subsNow || 0, subsNow == null || subsPrev == null ? null : trendPct(subsNow, subsPrev), subsNow == null ? "—" : subsNow.toLocaleString("en-IN")),
      kpi("growth", "Growth", growth || 0, null, growth == null ? "—" : `${growth >= 0 ? "+" : ""}${growth.toLocaleString("en-IN")}`),
    ],
    charts: [
      { id: "subs", title: "Subscribers", kind: "line", points: extra.subs },
      { id: "posts", title: "Posts", kind: "bar", points: extra.posts },
      { id: "views", title: "Post views", kind: "line", points: extra.views },
    ],
    tables: [],
  };
}

export async function recordMatchView(matchKey: string, userId: string) {
  const day = istDay();
  await prisma.matchViewStat.upsert({
    where: { matchKey_day: { matchKey, day } },
    update: { views: { increment: 1 } },
    create: { matchKey, day, views: 1, peak: 1 },
  });
  const now = new Date();
  await prisma.session.updateMany({
    where: { userId, lastSeen: { gte: new Date(now.getTime() - 30 * 60_000) } },
    data: { matchKey, lastSeen: now },
  });
  const watching = await prisma.session.findMany({
    where: { matchKey, lastSeen: { gte: new Date(now.getTime() - 90_000) } },
    distinct: ["userId"],
    select: { userId: true },
  });
  const current = Math.max(1, watching.length);
  await prisma.$executeRaw`
    UPDATE "MatchViewStat" SET peak = GREATEST(peak, ${current})
    WHERE "matchKey" = ${matchKey} AND day = ${day}
  `;
}

export async function snapshotChannel(): Promise<number | null> {
  if (!env.channelId || telegramDryRun()) return null;
  const day = istDay();
  const existing = await prisma.channelDay.findUnique({ where: { day } });
  if (existing && Date.now() - existing.checkedAt.getTime() < 15 * 60_000) return existing.subscribers;
  const count = await getChatMemberCount(env.channelId);
  if (count == null) return existing?.subscribers ?? null;
  await prisma.channelDay.upsert({
    where: { day },
    update: { subscribers: count, checkedAt: new Date() },
    create: { day, subscribers: count },
  });
  return count;
}

export async function rememberChannelPost(input: {
  chatId: string;
  messageId: number;
  matchKey?: string;
  kind?: string;
  text?: string;
  views?: number;
  postedAt?: Date;
}) {
  await prisma.channelPost.upsert({
    where: { chatId_messageId: { chatId: input.chatId, messageId: input.messageId } },
    update: { views: input.views ?? undefined },
    create: {
      chatId: input.chatId,
      messageId: input.messageId,
      matchKey: input.matchKey || "",
      kind: input.kind || "",
      text: (input.text || "").slice(0, 180),
      views: input.views || 0,
      postedAt: input.postedAt,
    },
  });
}

function reportTop(section: Section, top: { label: string; value: string }[]) {
  section.tables.push({ id: "top", title: "Top active users", columns: ["User", "Opens"], rows: top });
}

function withAdTrends(section: Section, current: Pulse, previous: Pulse): Section {
  const ctrNow = current.impressions ? (current.clicks / current.impressions) * 100 : 0;
  const ctrPrev = previous.impressions ? (previous.clicks / previous.impressions) * 100 : 0;
  for (const row of section.kpis) {
    if (row.id === "impr") row.delta = trendPct(current.impressions, previous.impressions);
    if (row.id === "clicks") row.delta = trendPct(current.clicks, previous.clicks);
    if (row.id === "ctr") row.delta = trendPct(ctrNow, ctrPrev);
  }
  return section;
}

function kpi(id: string, label: string, value: number, delta: number | null, display = ""): Kpi {
  return { id, label, value, delta, display: display || Math.round(value).toLocaleString("en-IN") };
}

function fill(window: ReportWindow, rows: { day: string; y: number }[]): { x: string; y: number }[] {
  const map = new Map(rows.map((row) => [row.day, row.y]));
  return window.days.map((day) => ({ x: day.slice(5), y: map.get(day) || 0 }));
}

function addBucket(map: Map<string, { impressions: number; clicks: number }>, key: string, row: { impressions: number; clicks: number }) {
  const current = map.get(key) || { impressions: 0, clicks: 0 };
  current.impressions += num(row.impressions);
  current.clicks += num(row.clicks);
  map.set(key, current);
}

function ctr(clicks: number, impressions: number): string {
  if (!impressions) return "0%";
  return `${((clicks / impressions) * 100).toFixed(1)}%`;
}

function inr(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes <= 0) return `${rest}s`;
  return `${minutes}m ${rest}s`;
}

function matchLabel(key: string): string {
  return key.replace(/^demo_/, "").replace(/_/g, " ").toUpperCase();
}

function istKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function num(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function cell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function kpiMap(section: Section): Record<string, string> {
  return Object.fromEntries(section.kpis.map((row) => [row.label, row.display]));
}

