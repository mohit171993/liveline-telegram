-- AlterTable
ALTER TABLE "User" ADD COLUMN "xp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "seasonXp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "dailyStreak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "bestDailyStreak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lastActiveDay" TEXT;
ALTER TABLE "User" ADD COLUMN "streakFreeze" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "fanTeamKey" TEXT;
ALTER TABLE "User" ADD COLUMN "lastBoardRank" INTEGER;

-- CreateTable
CREATE TABLE "MissionProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "missionKey" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "claimed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MissionProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seasonKey" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeasonClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "pick" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "PlayEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MissionProgress_userId_missionKey_periodKey_key" ON "MissionProgress"("userId", "missionKey", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonClaim_userId_seasonKey_tier_key" ON "SeasonClaim"("userId", "seasonKey", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "PlayEntry_userId_matchKey_kind_targetKey_key" ON "PlayEntry"("userId", "matchKey", "kind", "targetKey");

-- CreateIndex
CREATE INDEX "PlayEntry_matchKey_kind_settledAt_idx" ON "PlayEntry"("matchKey", "kind", "settledAt");

-- AddForeignKey
ALTER TABLE "MissionProgress" ADD CONSTRAINT "MissionProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonClaim" ADD CONSTRAINT "SeasonClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayEntry" ADD CONSTRAINT "PlayEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
