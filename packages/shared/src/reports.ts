import { shiftIstDay } from "./engage";
import { istDay } from "./rewards";

export type ReportPreset = "today" | "7d" | "30d" | "custom";

export type ReportWindow = {
  preset: ReportPreset;
  fromDay: string;
  toDay: string;
  days: string[];
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function reportWindow(input: {
  preset?: string;
  from?: string;
  to?: string;
  now?: Date;
}): ReportWindow {
  const today = istDay(input.now || new Date());
  const preset = normalizePreset(input.preset);
  let fromDay = today;
  let toDay = today;
  if (preset === "7d") fromDay = shiftIstDay(today, -6);
  if (preset === "30d") fromDay = shiftIstDay(today, -29);
  if (preset === "custom") {
    if (!input.from || !input.to || !DAY.test(input.from) || !DAY.test(input.to)) {
      throw new Error("CUSTOM_RANGE");
    }
    fromDay = input.from;
    toDay = input.to;
    if (fromDay > toDay) [fromDay, toDay] = [toDay, fromDay];
    if (listDays(fromDay, toDay).length > 366) fromDay = shiftIstDay(toDay, -365);
  }
  const days = listDays(fromDay, toDay);
  const start = dayStart(fromDay);
  const end = dayStart(shiftIstDay(toDay, 1));
  const prevEnd = start;
  const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
  return { preset, fromDay, toDay, days, start, end, prevStart, prevEnd };
}

export function listDays(fromDay: string, toDay: string): string[] {
  const days: string[] = [];
  let cursor = fromDay;
  for (let i = 0; i < 400 && cursor <= toDay; i += 1) {
    days.push(cursor);
    cursor = shiftIstDay(cursor, 1);
  }
  return days;
}

export function trendPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

export function retentionRate(returned: number, eligible: number): number | null {
  if (eligible <= 0) return null;
  return Math.round((returned / eligible) * 1000) / 10;
}

/** Bucket a Telegram start param into a referral source label. */
export function referralSource(startParam: string | null | undefined): string {
  const raw = (startParam || "").trim();
  if (!raw) return "Direct";
  if (/^ref_?\d+$/i.test(raw)) return "Referral";
  if (/^sq_/i.test(raw)) return "Squad";
  if (/^grp_/i.test(raw)) return "Group";
  if (/^match_/i.test(raw)) return "Match link";
  return raw.slice(0, 32);
}

function normalizePreset(value?: string): ReportPreset {
  if (value === "today" || value === "7d" || value === "30d" || value === "custom") return value;
  return "7d";
}

function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00+05:30`);
}
