import { prisma } from "@liveline/db";
import { clickDedupeKey, containsBetting, impressionDedupeKey, selectAd, type AdCandidate } from "@liveline/shared";
import { httpError } from "../httpError";
import { redis } from "../redis";

function split(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

export async function serveSlot(input: {
  userId: string;
  slot: string;
  matchKey?: string;
  seriesKey?: string;
  teamKeys?: string[];
  language?: string;
}) {
  const creatives = await prisma.creative.findMany({
    where: { active: true, slot: input.slot },
    include: { campaign: true },
  });
  const now = Date.now();
  const candidates: (AdCandidate & { creative: (typeof creatives)[number] })[] = [];
  for (const creative of creatives) {
    const seenKey = `ll:adcap:${input.userId}:${creative.id}:${new Date().toISOString().slice(0, 10)}`;
    const seen = Number((await redis.get(seenKey)) || 0);
    candidates.push({
      creative,
      id: creative.id,
      slot: creative.slot,
      weight: creative.weight,
      active: creative.active,
      campaignStatus: creative.campaign.status,
      startAt: creative.campaign.startAt?.getTime() ?? null,
      endAt: creative.campaign.endAt?.getTime() ?? null,
      matchKeys: split(creative.matchKeys),
      seriesKeys: split(creative.seriesKeys),
      teamKeys: split(creative.teamKeys),
      languages: split(creative.languages),
      frequencyCap: creative.frequencyCap,
      seen,
      headline: creative.headline,
      body: creative.body,
    });
  }
  const picked = selectAd(candidates, { now, ...input }, Math.random());
  if (!picked) return null;
  return {
    id: picked.creative.id,
    slot: picked.creative.slot,
    type: picked.creative.type,
    headline: picked.creative.headline,
    body: picked.creative.body,
    mediaUrl: picked.creative.mediaUrl,
    clickUrl: picked.creative.clickUrl,
    cta: picked.creative.cta,
    campaign: picked.creative.campaign.name,
  };
}

export async function recordAdEvent(userId: string, creativeId: string, type: "impression" | "click") {
  const creative = await prisma.creative.findUnique({ where: { id: creativeId } });
  if (!creative) throw httpError(404, "NOT_FOUND");
  const now = Date.now();
  const dedupeKey = type === "impression" ? impressionDedupeKey(userId, creativeId, now) : clickDedupeKey(userId, creativeId, now);
  try {
    await prisma.adEvent.create({ data: { userId, creativeId, type, dedupeKey } });
  } catch {
    return { recorded: false, deduped: true };
  }
  if (type === "impression") {
    const seenKey = `ll:adcap:${userId}:${creativeId}:${new Date().toISOString().slice(0, 10)}`;
    await redis.incr(seenKey);
    await redis.expire(seenKey, 60 * 60 * 48);
  }
  return { recorded: true, deduped: false };
}

export function assertCleanCopy(...parts: (string | undefined | null)[]) {
  const text = parts.filter(Boolean).join(" ");
  if (containsBetting(text)) {
    throw httpError(400, "BETTING_COPY", "Ads cannot promote betting, odds, sessions, or real-money gaming.");
  }
}

export async function reportRows(campaignId?: string) {
  const creatives = await prisma.creative.findMany({
    where: campaignId ? { campaignId } : {},
    include: { campaign: { include: { advertiser: true } }, events: true },
  });
  return creatives.map((creative) => ({
    campaign: creative.campaign.name,
    brand: creative.campaign.advertiser.brand,
    slot: creative.slot,
    headline: creative.headline,
    impressions: creative.events.filter((e) => e.type === "impression").length,
    clicks: creative.events.filter((e) => e.type === "click").length,
  }));
}

export function reportCsv(rows: Awaited<ReturnType<typeof reportRows>>): string {
  const header = "campaign,brand,slot,headline,impressions,clicks";
  return [header, ...rows.map((r) => [r.campaign, r.brand, r.slot, r.headline, r.impressions, r.clicks].map(cell).join(","))].join("\n");
}

function cell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
