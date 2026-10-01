import { prisma } from "@liveline/db";
import {
  cryptoUnit,
  decideFulfilment,
  decryptString,
  drawPrize,
  encryptString,
  istDay,
  randomId,
  type PrizeDrawItem,
} from "@liveline/shared";
import { env } from "../env";
import { providerName, rewardsProvider } from "../giftport";
import { httpError } from "../httpError";
import { loadKey } from "./cryptoKey";
import { sendTelegramMessage } from "../telegram";
import { parseAdminList } from "@liveline/shared";

export async function grantScratch(userId: string, source: string, sourceRef?: string) {
  const open = await prisma.scratchCard.count({ where: { userId, opened: false } });
  if (open >= 10) return null;
  return prisma.scratchCard.create({ data: { userId, source, sourceRef } });
}

export async function rewardsHome(userId: string) {
  const day = istDay();
  const [user, tables, scratches, spins, giveaways, vouchers, daily] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.prizeTable.findMany({ where: { active: true }, include: { prizes: { where: { active: true }, orderBy: { weight: "desc" } } } }),
    prisma.scratchCard.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.spin.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.giveaway.findMany({ where: { status: { in: ["open", "drawn"] } }, orderBy: { endsAt: "asc" }, include: { entries: { where: { userId } } } }),
    prisma.voucherOrder.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.spin.findFirst({ where: { userId, dayKey: day, source: "daily" } }),
  ]);
  return {
    points: user.points,
    bonusSpins: user.bonusSpins,
    dailySpinAvailable: !daily,
    predictionBoost: user.predictionBoost,
    theme: user.theme,
    themes: user.unlockedThemes.split(",").filter(Boolean),
    wheels: tables.filter((t) => t.kind === "wheel").map(publicTable),
    scratches: scratches.map((card) => ({
      id: card.id,
      source: card.source,
      opened: card.opened,
      result: card.opened ? safeJson(card.result) : null,
    })),
    history: spins.map((spin) => ({ id: spin.id, source: spin.source, result: safeJson(spin.result), at: spin.createdAt })),
    giveaways: giveaways.map((g) => ({
      id: g.id,
      title: g.title,
      description: g.description,
      sponsorName: g.sponsorName,
      prizeLabel: g.prizeLabel,
      endsAt: g.endsAt,
      status: g.status,
      entered: g.entries.length > 0,
      winnerUserId: g.winnerUserId,
    })),
    vouchers: vouchers.map((v) => presentVoucher(v, true)),
    legal: "Free only. No purchase, no coins for sale, no cash, no withdrawal.",
  };
}

function publicTable(table: { id: string; name: string; sponsorName: string | null; prizes: { id: string; label: string; kind: string }[] }) {
  return {
    id: table.id,
    name: table.name,
    sponsorName: table.sponsorName,
    segments: table.prizes.map((p) => ({ id: p.id, label: p.label, kind: p.kind })),
  };
}

export async function spinWheel(userId: string) {
  const limited = await rate(`spin:${userId}`, 5, 60);
  if (!limited) throw httpError(429, "SLOW_DOWN");
  const day = istDay();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const table = await prisma.prizeTable.findFirst({
    where: { kind: "wheel", active: true },
    include: { prizes: true },
  });
  if (!table) throw httpError(404, "NO_WHEEL");
  const daily = await prisma.spin.findFirst({ where: { userId, dayKey: day, source: "daily" } });
  const source = daily ? "bonus" : "daily";
  if (source === "bonus" && user.bonusSpins <= 0) throw httpError(409, "NO_SPIN", "Your free spin is used. Bonus spins come from streaks and referrals.");
  const spunToday = await prisma.spin.count({ where: { dayKey: day } });
  const budgetLeft = table.budgetInr - table.spentInr;
  const items: PrizeDrawItem[] = table.prizes.map((p) => ({
    id: p.id,
    kind: p.kind,
    weight: p.weight,
    active: p.active,
    points: p.points,
    amountInr: p.amountInr,
    inventory: p.inventory,
    awarded: p.awarded,
    label: p.label,
  }));
  const prize = spunToday >= table.dailyCap ? null : drawPrize(items, cryptoUnit(), budgetLeft);
  const applied = await applyPrize(userId, prize, table.id);
  try {
    await prisma.spin.create({
      data: {
        userId,
        dayKey: day,
        source,
        dedupeKey: source === "daily" ? `daily:${userId}:${day}` : `bonus:${userId}:${randomId()}`,
        prizeId: prize?.id,
        result: JSON.stringify(applied),
      },
    });
  } catch {
    throw httpError(409, "NO_SPIN", "Spin already used.");
  }
  if (source === "bonus") await prisma.user.update({ where: { id: userId }, data: { bonusSpins: { decrement: 1 } } });
  await prisma.rewardAudit.create({
    data: { userId, action: "spin", detail: JSON.stringify({ source, prize: prize?.id || null, capped: spunToday >= table.dailyCap }) },
  });
  const segments = table.prizes.filter((p) => p.active);
  const index = Math.max(0, segments.findIndex((p) => p.id === prize?.id));
  return { index, segmentCount: segments.length, source, prize: applied };
}

async function applyPrize(
  userId: string,
  prize: PrizeDrawItem | null,
  tableId: string,
): Promise<{ label: string; kind: string; points: number }> {
  if (!prize) return { label: "House cap reached", kind: "none", points: 0 };
  await prisma.prize.update({ where: { id: prize.id }, data: { awarded: { increment: 1 } } });
  if (prize.kind === "points") {
    await prisma.user.update({ where: { id: userId }, data: { points: { increment: prize.points } } });
    return { label: prize.label, kind: "points", points: prize.points };
  }
  if (prize.kind === "boost") {
    await prisma.user.update({ where: { id: userId }, data: { predictionBoost: { increment: 1 } } });
    return { label: prize.label, kind: "boost", points: 0 };
  }
  if (prize.kind === "theme" && prize.id) {
    const row = await prisma.prize.findUnique({ where: { id: prize.id } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const themes = new Set(user.unlockedThemes.split(",").filter(Boolean));
    if (row?.themeKey) themes.add(row.themeKey);
    await prisma.user.update({ where: { id: userId }, data: { unlockedThemes: [...themes].join(","), theme: row?.themeKey || user.theme } });
    return { label: prize.label, kind: "theme", points: 0 };
  }
  if (prize.kind === "badge") {
    const row = await prisma.prize.findUnique({ where: { id: prize.id } });
    if (row?.badgeKey) await prisma.badge.create({ data: { userId, badgeKey: row.badgeKey } }).catch(() => undefined);
    return { label: prize.label, kind: "badge", points: 0 };
  }
  if (prize.kind === "voucher") {
    const row = await prisma.prize.findUnique({ where: { id: prize.id } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (row?.operatorCode && row.amountInr && user.phone) {
      await prisma.voucherOrder.create({
        data: {
          userId,
          orderId: `ll_${randomId()}`,
          operatorCode: row.operatorCode,
          brandName: row.label,
          amountInr: row.amountInr,
          mobile: user.phone,
          recipientName: [user.firstName, user.lastName].filter(Boolean).join(" ") || "LiveLine fan",
          status: "awaiting_details",
        },
      });
      if (tableId) {
        await prisma.prizeTable.update({ where: { id: tableId }, data: { spentInr: { increment: row.amountInr } } });
      }
    }
    return { label: prize.label, kind: "voucher", points: 0 };
  }
  return { label: prize.label, kind: prize.kind, points: 0 };
}

export async function openScratch(userId: string, cardId: string) {
  const card = await prisma.scratchCard.findFirst({ where: { id: cardId, userId } });
  if (!card) throw httpError(404, "NOT_FOUND");
  if (card.opened) return { result: safeJson(card.result) };
  const table = await prisma.prizeTable.findFirst({ where: { kind: "scratch", active: true }, include: { prizes: true } });
  const items: PrizeDrawItem[] = (table?.prizes || []).map((p) => ({
    id: p.id, kind: p.kind, weight: p.weight, active: p.active, points: p.points,
    amountInr: p.amountInr, inventory: p.inventory, awarded: p.awarded, label: p.label,
  }));
  const budgetLeft = table ? table.budgetInr - table.spentInr : 0;
  const prize = items.length ? drawPrize(items, cryptoUnit(), budgetLeft) : null;
  const applied = await applyPrize(userId, prize, table?.id || "");
  await prisma.scratchCard.update({
    where: { id: card.id },
    data: { opened: true, openedAt: new Date(), result: JSON.stringify(applied) },
  });
  await prisma.rewardAudit.create({ data: { userId, action: "scratch", detail: JSON.stringify(applied) } });
  return { result: applied };
}

export async function enterGiveaway(userId: string, giveawayId: string) {
  const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId } });
  if (!giveaway || giveaway.status !== "open" || giveaway.endsAt < new Date()) {
    throw httpError(409, "CLOSED", "This draw is closed.");
  }
  await prisma.giveawayEntry.upsert({
    where: { giveawayId_userId: { giveawayId, userId } },
    update: {},
    create: { giveawayId, userId },
  });
  return { ok: true };
}

export async function claimVoucher(userId: string, orderRowId: string, email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "BAD_EMAIL");
  const order = await prisma.voucherOrder.findFirst({ where: { id: orderRowId, userId } });
  if (!order) throw httpError(404, "NOT_FOUND");
  if (order.status === "success") return presentVoucher(order, true);
  const updated = await prisma.voucherOrder.update({
    where: { id: order.id },
    data: { recipientEmail: email, status: order.status === "awaiting_details" ? "ready" : order.status },
  });
  return presentVoucher(await fulfil(updated.id), true);
}

export async function fulfil(orderRowId: string) {
  const order = await prisma.voucherOrder.findUniqueOrThrow({ where: { id: orderRowId } });
  const provider = rewardsProvider();
  let balance: number | null = null;
  try {
    const snap = await provider.getBalance();
    balance = snap.ok ? snap.balance : null;
    await prisma.giftportBalance.create({
      data: { balance: String(snap.balance), currency: snap.currency, message: snap.message },
    });
    if (snap.ok && snap.balance < env.giftLowBalance) await lowBalanceAlert(snap.balance);
  } catch {
    balance = null;
  }
  const action = decideFulfilment({
    status: order.status,
    failureConfirmed: order.failureConfirmed,
    amountInr: order.amountInr,
    balance,
  });
  if (action === "done" || action === "need_details" || action === "noop_failed") return order;
  if (action === "block_balance") {
    return prisma.voucherOrder.update({
      where: { id: order.id },
      data: { status: "blocked_balance", providerMessage: "GiftPort balance is too low to issue this voucher." },
    });
  }
  if (action === "reconcile") {
    const status = await provider.checkOrderStatus(order.orderId);
    if (status.found && status.ok && status.redeemCode) return saveSuccess(order.id, status.redeemCode, status.cardNo, status.transactionId, status.message);
    if (!status.found || (!status.ok && status.found && !status.redeemCode && /fail|not found/i.test(status.message + (status.ok ? "" : "failure")))) {
      return prisma.voucherOrder.update({
        where: { id: order.id },
        data: { status: "failed", failureConfirmed: true, providerMessage: status.message },
      });
    }
    return prisma.voucherOrder.update({
      where: { id: order.id },
      data: { status: "uncertain", providerMessage: status.message },
    });
  }
  if (action === "retry_new_order") {
    const fresh = await prisma.voucherOrder.create({
      data: {
        userId: order.userId,
        orderId: `ll_${randomId()}`,
        operatorCode: order.operatorCode,
        brandName: order.brandName,
        amountInr: order.amountInr,
        mobile: order.mobile,
        recipientName: order.recipientName,
        recipientEmail: order.recipientEmail,
        status: "ready",
        attempt: order.attempt + 1,
      },
    });
    return fulfil(fresh.id);
  }
  const bought = await provider.issueVoucher({
    orderId: order.orderId,
    operatorCode: order.operatorCode,
    amount: order.amountInr,
    mobile: order.mobile,
    recipientName: order.recipientName,
    recipientEmail: order.recipientEmail,
  });
  await prisma.rewardAudit.create({
    data: { userId: order.userId, action: "giftport_buy", detail: JSON.stringify({ orderId: order.orderId, ok: bought.ok, uncertain: bought.uncertain, message: bought.message }) },
  });
  if (bought.uncertain) {
    return prisma.voucherOrder.update({
      where: { id: order.id },
      data: { status: "uncertain", providerMessage: bought.message, attempt: { increment: 1 } },
    });
  }
  if (!bought.ok || !bought.redeemCode) {
    return prisma.voucherOrder.update({
      where: { id: order.id },
      data: { status: "failed", failureConfirmed: true, providerMessage: bought.message, attempt: { increment: 1 } },
    });
  }
  return saveSuccess(order.id, bought.redeemCode, bought.cardNo, bought.transactionId, bought.message);
}

async function saveSuccess(id: string, redeemCode: string, cardNo?: string, transactionId?: string, message?: string) {
  const key = loadKey();
  return prisma.voucherOrder.update({
    where: { id },
    data: {
      status: "success",
      failureConfirmed: false,
      transactionId,
      redeemCodeEnc: encryptString(redeemCode, key),
      cardNoEnc: cardNo ? encryptString(cardNo, key) : null,
      providerMessage: message || "Transaction Successfully Accepted",
    },
  });
}

export function presentVoucher(order: {
  id: string;
  orderId: string;
  brandName: string;
  amountInr: number;
  status: string;
  providerMessage: string | null;
  redeemCodeEnc: string | null;
  cardNoEnc: string | null;
  createdAt: Date;
  recipientEmail: string;
}, reveal: boolean) {
  let redeemCode: string | null = null;
  let cardNo: string | null = null;
  if (reveal && order.redeemCodeEnc) {
    try {
      redeemCode = decryptString(order.redeemCodeEnc, loadKey());
      cardNo = order.cardNoEnc ? decryptString(order.cardNoEnc, loadKey()) : null;
    } catch {
      redeemCode = null;
    }
  }
  return {
    id: order.id,
    orderId: order.orderId,
    brandName: order.brandName,
    amountInr: order.amountInr,
    status: order.status,
    message: order.providerMessage,
    email: order.recipientEmail,
    redeemCode,
    cardNo,
    createdAt: order.createdAt,
  };
}

export async function syncCatalogue() {
  const items = await rewardsProvider().listCatalogue();
  for (const item of items) {
    await prisma.giftCatalogueItem.upsert({
      where: { operatorCode: item.operatorCode },
      update: {
        brandName: item.brandName,
        brandImage: item.brandImage,
        denominations: item.denominations.join(","),
        variable: item.variable,
        syncedAt: new Date(),
      },
      create: {
        operatorCode: item.operatorCode,
        brandName: item.brandName,
        brandImage: item.brandImage,
        denominations: item.denominations.join(","),
        variable: item.variable,
      },
    });
  }
  return prisma.giftCatalogueItem.findMany({ orderBy: { brandName: "asc" } });
}

export async function refreshBalance() {
  const snap = await rewardsProvider().getBalance();
  await prisma.giftportBalance.create({
    data: { balance: String(snap.balance), currency: snap.currency, message: snap.message },
  });
  if (snap.ok && snap.balance < env.giftLowBalance) await lowBalanceAlert(snap.balance);
  return { ...snap, provider: providerName() };
}

async function lowBalanceAlert(balance: number) {
  const day = istDay();
  const dedupe = `lowbal:${day}`;
  const exists = await prisma.outboundMessage.findFirst({ where: { kind: "low_balance", payload: { contains: dedupe } } });
  if (exists) return;
  const text = `⚠️ GiftPort balance is ₹${balance.toFixed(2)}. Voucher issuing is blocked below the prize amount. Top up before the next draw.`;
  const chats = new Set<string>([...parseAdminList(env.adminRaw).ids]);
  if (env.adminAlertChat) chats.add(env.adminAlertChat);
  for (const chatId of chats) await sendTelegramMessage(chatId, text).catch(() => undefined);
  await prisma.outboundMessage.create({ data: { chatId: "admins", kind: "low_balance", payload: dedupe } });
}

export async function drawGiveaway(giveawayId: string) {
  const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId }, include: { entries: true } });
  if (!giveaway) throw httpError(404, "NOT_FOUND");
  if (!giveaway.entries.length) throw httpError(409, "NO_ENTRIES");
  const winner = giveaway.entries[Math.floor(cryptoUnit() * giveaway.entries.length)];
  await prisma.giveaway.update({
    where: { id: giveawayId },
    data: { status: "drawn", drawnAt: new Date(), winnerUserId: winner.userId },
  });
  if (giveaway.operatorCode && giveaway.amountInr) {
    const user = await prisma.user.findUnique({ where: { id: winner.userId } });
    if (user?.phone) {
      await prisma.voucherOrder.create({
        data: {
          userId: user.id,
          orderId: `ll_${randomId()}`,
          operatorCode: giveaway.operatorCode,
          brandName: giveaway.prizeLabel,
          amountInr: giveaway.amountInr,
          mobile: user.phone,
          recipientName: user.firstName || "Winner",
          status: "awaiting_details",
        },
      });
    }
  }
  await prisma.rewardAudit.create({ data: { userId: winner.userId, action: "giveaway_draw", detail: giveawayId } });
  return { winnerUserId: winner.userId };
}

async function rate(key: string, limit: number, seconds: number) {
  const { redis } = await import("../redis");
  const n = await redis.incr(`ll:rate:${key}`);
  if (n === 1) await redis.expire(`ll:rate:${key}`, seconds);
  return n <= limit;
}

function safeJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
