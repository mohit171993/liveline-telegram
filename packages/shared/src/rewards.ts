export interface PrizeDrawItem {
  id: string;
  kind: string;
  weight: number;
  active: boolean;
  points: number;
  amountInr?: number | null;
  inventory?: number | null;
  awarded: number;
  label: string;
}

export function pickWeighted<T extends { weight: number }>(items: T[], rnd: number): T {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (total <= 0) return items[items.length - 1];
  let cursor = Math.min(0.999999, Math.max(0, rnd)) * total;
  for (const item of items) {
    cursor -= Math.max(0, item.weight);
    if (cursor < 0) return item;
  }
  return items[items.length - 1];
}

export function drawPrize(
  prizes: PrizeDrawItem[],
  rnd: number,
  budgetLeftInr: number,
): PrizeDrawItem | null {
  const available = prizes.filter((prize) => {
    if (!prize.active || prize.weight <= 0) return false;
    if (prize.inventory != null && prize.awarded >= prize.inventory) return false;
    if (prize.kind === "voucher" && (prize.amountInr || 0) > budgetLeftInr) return false;
    return true;
  });
  if (!available.length) return null;
  return pickWeighted(available, rnd);
}

export type FulfilAction =
  | "done"
  | "need_details"
  | "buy"
  | "reconcile"
  | "block_balance"
  | "retry_new_order"
  | "noop_failed";

/**
 * GiftPort idempotency:
 * - never call /buy twice for the same uncertainty
 * - never mint a new order_id until a failure is confirmed
 * - a confirmed failure may be retried as a brand new order
 */
export function decideFulfilment(input: {
  status: string;
  failureConfirmed: boolean;
  amountInr: number;
  balance: number | null;
}): FulfilAction {
  if (input.status === "success") return "done";
  if (input.status === "awaiting_details") return "need_details";
  if (input.status === "uncertain") return "reconcile";
  if (input.status === "failed") {
    return input.failureConfirmed ? "retry_new_order" : "reconcile";
  }
  if (input.status === "ready" || input.status === "blocked_balance") {
    if (input.balance == null) return "block_balance";
    if (input.balance < input.amountInr) return "block_balance";
    return "buy";
  }
  return "noop_failed";
}

export function istDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatIst(date = new Date()): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
