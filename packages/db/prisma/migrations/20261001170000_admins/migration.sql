CREATE TABLE "AdminAccount" (
  "id" TEXT NOT NULL,
  "telegramId" TEXT,
  "username" TEXT,
  "usernameNorm" TEXT,
  "role" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'panel',
  "addedBy" TEXT,
  "boundAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAccount_revokedAt_idx" ON "AdminAccount"("revokedAt");
CREATE UNIQUE INDEX "AdminAccount_telegramId_active_key" ON "AdminAccount"("telegramId") WHERE "revokedAt" IS NULL AND "telegramId" IS NOT NULL;
CREATE UNIQUE INDEX "AdminAccount_usernameNorm_active_key" ON "AdminAccount"("usernameNorm") WHERE "revokedAt" IS NULL AND "usernameNorm" IS NOT NULL;

CREATE TABLE "AdminAudit" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "targetId" TEXT,
  "targetUser" TEXT,
  "role" TEXT,
  "detail" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAudit_createdAt_idx" ON "AdminAudit"("createdAt");
