-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "languageCode" TEXT NOT NULL DEFAULT 'en',
    "languageLocked" BOOLEAN NOT NULL DEFAULT false,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "phoneHash" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "termsAcceptedAt" TIMESTAMP(3),
    "startParam" TEXT,
    "referredById" TEXT,
    "referralCount" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "bonusSpins" INTEGER NOT NULL DEFAULT 0,
    "predictionBoost" INTEGER NOT NULL DEFAULT 0,
    "theme" TEXT NOT NULL DEFAULT 'floodlight',
    "unlockedThemes" TEXT NOT NULL DEFAULT 'floodlight',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "blockedAt" TIMESTAMP(3),
    "blockReason" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchKey" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refKey" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchKey" TEXT,
    "teamKey" TEXT,
    "seriesKey" TEXT,
    "minutesBefore" INTEGER,
    "alertTypes" TEXT NOT NULL,
    "fireAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "matchKey" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "pick" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "correct" BOOLEAN,
    "points" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeKey" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupChat" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateTable
CREATE TABLE "WatchMessage" (
    "id" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WatchMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchReaction" (
    "id" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "messageId" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchPoll" (
    "id" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closesAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchPoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchPollVote" (
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "option" INTEGER NOT NULL,

    CONSTRAINT "WatchPollVote_pkey" PRIMARY KEY ("pollId","userId")
);

-- CreateTable
CREATE TABLE "Moderation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL DEFAULT '',
    "mutedUntil" TIMESTAMP(3),
    "banned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Moderation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Advertiser" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "contact" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Advertiser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "budget" INTEGER NOT NULL DEFAULT 0,
    "flatFee" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creative" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "mediaUrl" TEXT,
    "clickUrl" TEXT,
    "cta" TEXT NOT NULL DEFAULT 'Learn more',
    "frequencyCap" INTEGER NOT NULL DEFAULT 4,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "matchKeys" TEXT NOT NULL DEFAULT '',
    "seriesKeys" TEXT NOT NULL DEFAULT '',
    "teamKeys" TEXT NOT NULL DEFAULT '',
    "languages" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Creative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdEvent" (
    "id" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorLead" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "budget" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SponsorLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareReport" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "campaignId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrizeTable" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sponsorName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "dailyCap" INTEGER NOT NULL DEFAULT 5000,
    "budgetInr" INTEGER NOT NULL DEFAULT 0,
    "spentInr" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PrizeTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prize" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "themeKey" TEXT,
    "badgeKey" TEXT,
    "operatorCode" TEXT,
    "amountInr" INTEGER,
    "inventory" INTEGER,
    "awarded" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Prize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Spin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "prizeId" TEXT,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Spin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScratchCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "opened" BOOLEAN NOT NULL DEFAULT false,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),

    CONSTRAINT "ScratchCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Giveaway" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sponsorName" TEXT,
    "prizeLabel" TEXT NOT NULL,
    "operatorCode" TEXT,
    "amountInr" INTEGER,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "drawnAt" TIMESTAMP(3),
    "winnerUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',

    CONSTRAINT "Giveaway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiveawayEntry" (
    "giveawayId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiveawayEntry_pkey" PRIMARY KEY ("giveawayId","userId")
);

-- CreateTable
CREATE TABLE "GiftCatalogueItem" (
    "operatorCode" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "brandImage" TEXT,
    "denominations" TEXT NOT NULL,
    "variable" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftCatalogueItem_pkey" PRIMARY KEY ("operatorCode")
);

-- CreateTable
CREATE TABLE "VoucherOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "operatorCode" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "amountInr" INTEGER NOT NULL,
    "mobile" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "failureConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "transactionId" TEXT,
    "redeemCodeEnc" TEXT,
    "cardNoEnc" TEXT,
    "providerMessage" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftportBalance" (
    "id" TEXT NOT NULL,
    "balance" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftportBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchViewStat" (
    "matchKey" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MatchViewStat_pkey" PRIMARY KEY ("matchKey","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash");

-- CreateIndex
CREATE INDEX "User_status_createdAt_idx" ON "User"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Session_startedAt_idx" ON "Session"("startedAt");

-- CreateIndex
CREATE INDEX "Session_userId_startedAt_idx" ON "Session"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_kind_refKey_key" ON "Favorite"("userId", "kind", "refKey");

-- CreateIndex
CREATE INDEX "Reminder_status_fireAt_idx" ON "Reminder"("status", "fireAt");

-- CreateIndex
CREATE INDEX "Reminder_userId_status_idx" ON "Reminder"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_sentAt_idx" ON "Notification"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "Prediction_matchKey_settledAt_idx" ON "Prediction"("matchKey", "settledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Prediction_userId_matchKey_kind_targetKey_key" ON "Prediction"("userId", "matchKey", "kind", "targetKey");

-- CreateIndex
CREATE UNIQUE INDEX "Badge_userId_badgeKey_key" ON "Badge"("userId", "badgeKey");

-- CreateIndex
CREATE INDEX "WatchMessage_matchKey_createdAt_idx" ON "WatchMessage"("matchKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WatchReaction_matchKey_userId_emoji_messageId_key" ON "WatchReaction"("matchKey", "userId", "emoji", "messageId");

-- CreateIndex
CREATE INDEX "WatchPoll_matchKey_idx" ON "WatchPoll"("matchKey");

-- CreateIndex
CREATE UNIQUE INDEX "Moderation_userId_matchKey_key" ON "Moderation"("userId", "matchKey");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Creative_slot_active_idx" ON "Creative"("slot", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AdEvent_dedupeKey_key" ON "AdEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "AdEvent_creativeId_type_idx" ON "AdEvent"("creativeId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ShareReport_token_key" ON "ShareReport"("token");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsage_userId_day_key" ON "AiUsage"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "Spin_dedupeKey_key" ON "Spin"("dedupeKey");

-- CreateIndex
CREATE INDEX "Spin_userId_dayKey_idx" ON "Spin"("userId", "dayKey");

-- CreateIndex
CREATE INDEX "ScratchCard_userId_opened_idx" ON "ScratchCard"("userId", "opened");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherOrder_orderId_key" ON "VoucherOrder"("orderId");

-- CreateIndex
CREATE INDEX "VoucherOrder_userId_createdAt_idx" ON "VoucherOrder"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VoucherOrder_status_idx" ON "VoucherOrder"("status");

-- CreateIndex
CREATE INDEX "RewardAudit_createdAt_idx" ON "RewardAudit"("createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "GroupChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchMessage" ADD CONSTRAINT "WatchMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchPollVote" ADD CONSTRAINT "WatchPollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "WatchPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "Advertiser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creative" ADD CONSTRAINT "Creative_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdEvent" ADD CONSTRAINT "AdEvent_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "Creative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdEvent" ADD CONSTRAINT "AdEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prize" ADD CONSTRAINT "Prize_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "PrizeTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Spin" ADD CONSTRAINT "Spin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScratchCard" ADD CONSTRAINT "ScratchCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayEntry" ADD CONSTRAINT "GiveawayEntry_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayEntry" ADD CONSTRAINT "GiveawayEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherOrder" ADD CONSTRAINT "VoucherOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

