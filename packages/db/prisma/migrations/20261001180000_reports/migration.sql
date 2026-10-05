ALTER TABLE "MatchViewStat" ADD COLUMN "peak" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ChannelPost" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "messageId" INTEGER NOT NULL,
    "matchKey" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "views" INTEGER NOT NULL DEFAULT 0,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelPost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelPost_chatId_messageId_key" ON "ChannelPost"("chatId", "messageId");
CREATE INDEX "ChannelPost_postedAt_idx" ON "ChannelPost"("postedAt");

CREATE TABLE "ChannelDay" (
    "day" TEXT NOT NULL,
    "subscribers" INTEGER NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelDay_pkey" PRIMARY KEY ("day")
);
