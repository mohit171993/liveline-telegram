ALTER TABLE "User" ADD COLUMN "ageStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "User" ADD COLUMN "birthYear" INTEGER;
ALTER TABLE "User" ADD COLUMN "predStreak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "bestPredStreak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "streakSavers" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "doubleDown" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "friendCode" TEXT;
ALTER TABLE "User" ADD COLUMN "leagueTier" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "User" ADD COLUMN "leaguePoints" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "leagueWeek" TEXT;
CREATE UNIQUE INDEX "User_friendCode_key" ON "User"("friendCode");

ALTER TABLE "Prediction" ADD COLUMN "chip" TEXT NOT NULL DEFAULT '';

ALTER TABLE "GroupChat" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'group';
ALTER TABLE "GroupChat" ADD COLUMN "points" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GroupChat" ADD COLUMN "referralCode" TEXT;
CREATE UNIQUE INDEX "GroupChat_referralCode_key" ON "GroupChat"("referralCode");

ALTER TABLE "Advertiser" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'other';

CREATE TABLE "SeriesChip" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "seriesKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "used" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "SeriesChip_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SeriesChip_userId_seriesKey_kind_key" ON "SeriesChip"("userId", "seriesKey", "kind");
ALTER TABLE "SeriesChip" ADD CONSTRAINT "SeriesChip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LivePin" (
  "chatId" TEXT NOT NULL,
  "matchKey" TEXT NOT NULL,
  "messageId" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LivePin_pkey" PRIMARY KEY ("chatId")
);

CREATE TABLE "FanVote" (
  "matchKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FanVote_pkey" PRIMARY KEY ("matchKey", "userId", "category")
);
ALTER TABLE "FanVote" ADD CONSTRAINT "FanVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DanmakuNote" (
  "id" TEXT NOT NULL,
  "matchKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DanmakuNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DanmakuNote_matchKey_createdAt_idx" ON "DanmakuNote"("matchKey", "createdAt");
ALTER TABLE "DanmakuNote" ADD CONSTRAINT "DanmakuNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PuzzleAttempt" (
  "userId" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "puzzleKey" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "correct" BOOLEAN NOT NULL,
  "points" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "PuzzleAttempt_pkey" PRIMARY KEY ("userId", "day", "puzzleKey")
);
ALTER TABLE "PuzzleAttempt" ADD CONSTRAINT "PuzzleAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StickerHolding" (
  "userId" TEXT NOT NULL,
  "stickerKey" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "StickerHolding_pkey" PRIMARY KEY ("userId", "stickerKey")
);
ALTER TABLE "StickerHolding" ADD CONSTRAINT "StickerHolding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StickerPackOpen" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StickerPackOpen_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StickerPackOpen_userId_day_idx" ON "StickerPackOpen"("userId", "day");
ALTER TABLE "StickerPackOpen" ADD CONSTRAINT "StickerPackOpen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MatchTicket" (
  "userId" TEXT NOT NULL,
  "matchKey" TEXT NOT NULL,
  "teamKey" TEXT NOT NULL,
  "badge" TEXT NOT NULL,
  "stub" BOOLEAN NOT NULL DEFAULT false,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchTicket_pkey" PRIMARY KEY ("userId", "matchKey")
);
ALTER TABLE "MatchTicket" ADD CONSTRAINT "MatchTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FanXi" (
  "matchKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "playerIds" TEXT NOT NULL,
  CONSTRAINT "FanXi_pkey" PRIMARY KEY ("matchKey", "userId")
);
ALTER TABLE "FanXi" ADD CONSTRAINT "FanXi_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FriendLink" (
  "userId" TEXT NOT NULL,
  "friendId" TEXT NOT NULL,
  "streak" INTEGER NOT NULL DEFAULT 0,
  "lastDay" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "FriendLink_pkey" PRIMARY KEY ("userId", "friendId")
);
ALTER TABLE "FriendLink" ADD CONSTRAINT "FriendLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FriendLink" ADD CONSTRAINT "FriendLink_friendId_fkey" FOREIGN KEY ("friendId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
