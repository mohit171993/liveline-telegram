-- Website verify gate: account source + verification method + last website login.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'telegram';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "verifyMethod" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "webLoginAt" TIMESTAMP(3);
UPDATE "User" SET "verifyMethod" = 'telegram' WHERE "phoneVerifiedAt" IS NOT NULL AND "verifyMethod" IS NULL;
