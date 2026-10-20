-- AlterTable
-- Monetary invariants are also enforced in PostgreSQL, independently of application code.
ALTER TABLE "users" ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'user';

-- AlterTable
ALTER TABLE "generation_tasks" ADD COLUMN     "creditQuote" JSONB;

-- AlterTable
ALTER TABLE "generation_task_items" ADD COLUMN     "creditCost" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "creditHoldId" TEXT;

-- CreateTable
CREATE TABLE "credit_accounts" (
    "userId" TEXT NOT NULL,
    "available" INTEGER NOT NULL DEFAULT 0,
    "frozen" INTEGER NOT NULL DEFAULT 0,
    "spent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_accounts_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "credit_holds" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'held',
    "reason" TEXT NOT NULL,
    "referenceId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "availableDelta" INTEGER NOT NULL,
    "frozenDelta" INTEGER NOT NULL,
    "availableAfter" INTEGER NOT NULL,
    "frozenAfter" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceId" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_prices" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'request',
    "credits" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "admin_audits" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_holds_key_key" ON "credit_holds"("key");

-- CreateIndex
CREATE INDEX "credit_holds_status_expiresAt_idx" ON "credit_holds"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "credit_holds_userId_createdAt_idx" ON "credit_holds"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "credit_entries_key_key" ON "credit_entries"("key");

-- CreateIndex
CREATE INDEX "credit_entries_userId_createdAt_idx" ON "credit_entries"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "credit_entries_referenceId_idx" ON "credit_entries"("referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_prices_kind_model_key" ON "credit_prices"("kind", "model");

-- CreateIndex
CREATE INDEX "admin_audits_createdAt_idx" ON "admin_audits"("createdAt");

-- AddForeignKey
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('user', 'admin'));
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_nonnegative" CHECK ("available" >= 0 AND "frozen" >= 0 AND "spent" >= 0);
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_amount_check" CHECK ("amount" >= 0);
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_status_check" CHECK ("status" IN ('held', 'captured', 'refunded'));
ALTER TABLE "credit_prices" ADD CONSTRAINT "credit_prices_values_check" CHECK ("credits" >= 0 AND "version" > 0 AND "kind" IN ('text', 'image', 'video', 'chat') AND "unit" IN ('request', 'second') AND ("kind" = 'video' OR "unit" = 'request'));
ALTER TABLE "generation_task_items" ADD CONSTRAINT "generation_item_credits_check" CHECK ("creditCost" >= 0);

-- Initial editable platform defaults, not supplier currency prices.
INSERT INTO "credit_prices" ("id", "kind", "model", "unit", "credits", "updatedAt") VALUES
  ('default-text', 'text', '*', 'request', 1, CURRENT_TIMESTAMP),
  ('default-image', 'image', '*', 'request', 10, CURRENT_TIMESTAMP),
  ('default-video', 'video', '*', 'second', 10, CURRENT_TIMESTAMP),
  ('default-chat', 'chat', '*', 'request', 1, CURRENT_TIMESTAMP);
INSERT INTO "platform_settings" ("key", "value") VALUES ('signupCredits', 100);
