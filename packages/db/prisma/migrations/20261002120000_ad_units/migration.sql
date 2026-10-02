-- CreateTable
CREATE TABLE "AdUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'banner',
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "cta" TEXT NOT NULL DEFAULT '',
    "images" JSONB NOT NULL DEFAULT '{}',
    "videoUrl" TEXT NOT NULL DEFAULT '',
    "posterUrl" TEXT NOT NULL DEFAULT '',
    "html" TEXT NOT NULL DEFAULT '',
    "targetUrl" TEXT NOT NULL DEFAULT '',
    "openMode" TEXT NOT NULL DEFAULT 'inapp',
    "frameable" BOOLEAN NOT NULL DEFAULT false,
    "placements" TEXT NOT NULL DEFAULT '',
    "pages" TEXT NOT NULL DEFAULT '',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "freqCap" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdUnitStat" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AdUnitStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdUnitStat_adId_day_surface_placement_page_key" ON "AdUnitStat"("adId", "day", "surface", "placement", "page");

-- CreateIndex
CREATE INDEX "AdUnitStat_day_idx" ON "AdUnitStat"("day");

-- AddForeignKey
ALTER TABLE "AdUnitStat" ADD CONSTRAINT "AdUnitStat_adId_fkey" FOREIGN KEY ("adId") REFERENCES "AdUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
