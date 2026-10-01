-- AlterTable

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "botBlockedAt" TIMESTAMP(3),
ADD COLUMN     "optOut" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CrmTag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSegment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filter" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "buttonText" TEXT,
    "buttonParam" TEXT,
    "filter" TEXT NOT NULL DEFAULT '{}',
    "segmentName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "blocked" INTEGER NOT NULL DEFAULT 0,
    "opened" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastDelivery" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "messageId" INTEGER,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),

    CONSTRAINT "BroadcastDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoRule" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" TEXT NOT NULL DEFAULT '{}',
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoRule_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AutoSend" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 0,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),

    CONSTRAINT "AutoSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmTag_tag_idx" ON "CrmTag"("tag");

-- CreateIndex
CREATE UNIQUE INDEX "CrmTag_userId_tag_key" ON "CrmTag"("userId", "tag");

-- CreateIndex
CREATE INDEX "CrmNote_userId_createdAt_idx" ON "CrmNote"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Broadcast_status_scheduledAt_idx" ON "Broadcast"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "BroadcastDelivery_broadcastId_status_idx" ON "BroadcastDelivery"("broadcastId", "status");

-- CreateIndex
CREATE INDEX "BroadcastDelivery_userId_idx" ON "BroadcastDelivery"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastDelivery_broadcastId_userId_key" ON "BroadcastDelivery"("broadcastId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AutoSend_dedupeKey_key" ON "AutoSend"("dedupeKey");

-- CreateIndex
CREATE INDEX "AutoSend_userId_sentAt_idx" ON "AutoSend"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "AutoSend_ruleKey_sentAt_idx" ON "AutoSend"("ruleKey", "sentAt");

-- AddForeignKey
ALTER TABLE "BroadcastDelivery" ADD CONSTRAINT "BroadcastDelivery_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

