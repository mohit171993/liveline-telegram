import path from "path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { istDay, loadEncryptionKey, phoneHash } from "@liveline/shared";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const prisma = new PrismaClient();

async function main() {
  const adminId = (process.env.ADMIN_TELEGRAM_IDS || "8992664481").split(",")[0].trim();
  const pepper = loadEncryptionKey(process.env.REWARDS_ENCRYPTION_KEY || "liveline-pro-local-dev-key-32b!!").toString("base64");
  const hash = (phone: string) => phoneHash(phone, pepper);

  const admin = await prisma.user.upsert({
    where: { telegramId: adminId },
    update: {
      status: "ACTIVE",
      xp: 140,
      seasonXp: 140,
      dailyStreak: 4,
      streakFreeze: 1,
      fanTeamKey: "ind",
      lastActiveDay: istDay(),
    },
    create: {
      telegramId: adminId,
      username: "fantzoSportsUpdates",
      firstName: "Fantzo",
      lastName: "Sports",
      languageCode: "en",
      isPremium: true,
      phone: "919800011223",
      phoneHash: hash("919800011223"),
      phoneVerifiedAt: new Date(),
      termsAcceptedAt: new Date(),
      status: "ACTIVE",
      points: 180,
      xp: 140,
      seasonXp: 140,
      dailyStreak: 4,
      streakFreeze: 1,
      fanTeamKey: "ind",
      lastActiveDay: istDay(),
      streak: 2,
      bestStreak: 4,
      bonusSpins: 1,
      theme: "floodlight",
      unlockedThemes: "floodlight,monsoon",
    },
  });

  const rivals = [
    ["9100000001", "nightwatch", "Asha", 240],
    ["9100000002", "coverdrive", "Imran", 190],
    ["9100000003", "yorker", "Meera", 160],
    ["9100000004", "slipcordon", "Kabir", 120],
    ["9100000005", "midwicket", "Sara", 90],
  ] as const;

  for (const [telegramId, username, firstName, points] of rivals) {
    const user = await prisma.user.upsert({
      where: { telegramId },
      update: { points },
      create: {
        telegramId,
        username,
        firstName,
        languageCode: "hi",
        phone: `91${telegramId.slice(-10)}`,
        phoneHash: hash(`91${telegramId.slice(-10)}`),
        phoneVerifiedAt: new Date(),
        termsAcceptedAt: new Date(),
        status: "ACTIVE",
        points,
        isDemo: true,
        streak: 1,
      },
    });
    await prisma.prediction.upsert({
      where: { userId_matchKey_kind_targetKey: { userId: user.id, matchKey: "demo_ind_aus", kind: "BALL", targetKey: `seed-${telegramId}` } },
      update: { points },
      create: {
        userId: user.id,
        matchKey: "demo_ind_aus",
        kind: "BALL",
        targetKey: `seed-${telegramId}`,
        pick: "4",
        settledAt: new Date(),
        correct: true,
        points,
        detail: "Seeded board row",
      },
    });
  }

  await prisma.prediction.upsert({
    where: { userId_matchKey_kind_targetKey: { userId: admin.id, matchKey: "demo_ind_aus", kind: "BALL", targetKey: "seed-admin" } },
    update: { points: 80 },
    create: {
      userId: admin.id,
      matchKey: "demo_ind_aus",
      kind: "BALL",
      targetKey: "seed-admin",
      pick: "6",
      settledAt: new Date(),
      correct: true,
      points: 80,
      detail: "Seeded",
    },
  });

  await prisma.badge.upsert({
    where: { userId_badgeKey: { userId: admin.id, badgeKey: "first_call" } },
    update: {},
    create: { userId: admin.id, badgeKey: "first_call" },
  });

  const brand = await prisma.advertiser.upsert({
    where: { id: "seed_harbour" },
    update: {},
    create: { id: "seed_harbour", name: "Harbour Audio", brand: "Harbour Audio", contact: "hello@harbour.example" },
  });

  const existing = await prisma.campaign.findFirst({ where: { name: "Harbour night line" } });
  if (!existing) {
    await prisma.campaign.create({
      data: {
        advertiserId: brand.id,
        name: "Harbour night line",
        status: "active",
        startAt: new Date(Date.now() - 86400000),
        endAt: new Date(Date.now() + 86400000 * 30),
        budget: 50000,
        flatFee: 15000,
        creatives: {
          create: [
            {
              type: "native",
              slot: "home_native",
              headline: "Harbour Audio",
              body: "The night match sounds better on a proper speaker.",
              cta: "See the set",
              clickUrl: "https://example.com/harbour",
              frequencyCap: 6,
            },
            {
              type: "native",
              slot: "prediction_slot",
              headline: "Spin by Harbour",
              body: "Free points. No buy-in.",
              cta: "Sponsored",
              frequencyCap: 8,
            },
            {
              type: "powered_by",
              slot: "powered_by",
              headline: "Powered by Harbour Audio",
              body: "Match sponsor",
              cta: "Sponsor",
              frequencyCap: 12,
            },
          ],
        },
      },
    });
  }

  const harbour = await prisma.campaign.findFirst({ where: { name: "Harbour night line" } });
  if (harbour) {
    const slots = [
      ["celebration", "Six, brought to you live"],
      ["fan_meter", "The louder stand"],
      ["minigame", "Break quiz"],
      ["mission", "Tonight's missions"],
      ["season_pass", "Free season track"],
      ["cheer", "Cheer with Harbour"],
      ["nudge", "Harbour on the night line"],
    ] as const;
    for (const [slot, headline] of slots) {
      const have = await prisma.creative.findFirst({ where: { campaignId: harbour.id, slot } });
      if (have) continue;
      await prisma.creative.create({
        data: {
          campaignId: harbour.id,
          type: "native",
          slot,
          headline,
          body: "Harbour Audio. Points only, no buy-in.",
          cta: "Sponsored",
          frequencyCap: 12,
        },
      });
    }
  }

  const wheel = await prisma.prizeTable.upsert({
    where: { id: "seed_wheel" },
    update: {},
    create: {
      id: "seed_wheel",
      name: "Night wheel",
      kind: "wheel",
      sponsorName: "Harbour Audio",
      dailyCap: 5000,
      budgetInr: 20000,
      prizes: {
        create: [
          { label: "10 pts", kind: "points", weight: 30, points: 10 },
          { label: "25 pts", kind: "points", weight: 22, points: 25 },
          { label: "50 pts", kind: "points", weight: 12, points: 50 },
          { label: "Boost", kind: "boost", weight: 10 },
          { label: "Monsoon", kind: "theme", weight: 8, themeKey: "monsoon" },
          { label: "Nightwatch", kind: "badge", weight: 6, badgeKey: "nightwatch" },
          { label: "Try again", kind: "none", weight: 10 },
          { label: "₹100 Amazon Pay", kind: "voucher", weight: 2, operatorCode: "AMZN", amountInr: 100, inventory: 20 },
        ],
      },
    },
  });

  await prisma.prizeTable.upsert({
    where: { id: "seed_scratch" },
    update: {},
    create: {
      id: "seed_scratch",
      name: "Scratch",
      kind: "scratch",
      sponsorName: "Harbour Audio",
      dailyCap: 5000,
      budgetInr: 10000,
      prizes: {
        create: [
          { label: "15 pts", kind: "points", weight: 50, points: 15 },
          { label: "40 pts", kind: "points", weight: 20, points: 40 },
          { label: "Boost", kind: "boost", weight: 10 },
          { label: "Nothing", kind: "none", weight: 20 },
        ],
      },
    },
  });

  await prisma.giveaway.upsert({
    where: { id: "seed_give" },
    update: {},
    create: {
      id: "seed_give",
      title: "Harbour week draw",
      description: "Free entry. One winner. No fee.",
      sponsorName: "Harbour Audio",
      prizeLabel: "₹500 Amazon Pay voucher",
      operatorCode: "AMZN",
      amountInr: 500,
      startsAt: new Date(Date.now() - 3600_000),
      endsAt: new Date(Date.now() + 86400000 * 6),
      status: "open",
    },
  });

  await prisma.giftCatalogueItem.upsert({
    where: { operatorCode: "AMZN" },
    update: {},
    create: {
      operatorCode: "AMZN",
      brandName: "Amazon Pay Gift Card",
      denominations: "100,250,500,1000",
      variable: true,
    },
  });

  await prisma.giftportBalance.create({
    data: { balance: "25000", currency: "INR", message: "mock" },
  });

  await prisma.scratchCard.create({ data: { userId: admin.id, source: "seed" } }).catch(() => undefined);

  console.log(JSON.stringify({ seeded: true, admin: admin.telegramId, wheel: wheel.id }));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
