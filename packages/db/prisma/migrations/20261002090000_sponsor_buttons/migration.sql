-- CreateTable
CREATE TABLE "SponsorButton" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '',
    "style" TEXT NOT NULL DEFAULT 'success',
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "target" TEXT NOT NULL DEFAULT 'verified',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "frameable" BOOLEAN NOT NULL DEFAULT true,
    "frameNote" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SponsorButton_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorTap" (
    "id" TEXT NOT NULL,
    "sponsorId" TEXT NOT NULL,
    "userId" TEXT,
    "surface" TEXT NOT NULL DEFAULT 'home',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SponsorTap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SponsorTap_sponsorId_createdAt_idx" ON "SponsorTap"("sponsorId", "createdAt");

-- CreateIndex
CREATE INDEX "SponsorTap_userId_idx" ON "SponsorTap"("userId");

-- AddForeignKey
ALTER TABLE "SponsorTap" ADD CONSTRAINT "SponsorTap_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "SponsorButton"("id") ON DELETE CASCADE ON UPDATE CASCADE;
