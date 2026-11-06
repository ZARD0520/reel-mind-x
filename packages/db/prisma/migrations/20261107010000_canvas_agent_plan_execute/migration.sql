-- AlterTable
ALTER TABLE "canvas_chat_messages" ADD COLUMN     "runId" TEXT;

-- AlterTable
ALTER TABLE "canvas_agent_runs" ADD COLUMN     "context" JSONB,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "holdId" TEXT,
ADD COLUMN     "input" JSONB,
ADD COLUMN     "inputHash" TEXT,
ADD COLUMN     "plan" JSONB,
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "response" TEXT;

-- CreateTable
CREATE TABLE "canvas_agent_steps" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "tool" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_agent_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canvas_agent_leases" (
    "canvasId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_agent_leases_pkey" PRIMARY KEY ("canvasId")
);

-- CreateIndex
CREATE INDEX "canvas_agent_steps_runId_ordinal_idx" ON "canvas_agent_steps"("runId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_agent_steps_runId_stepKey_key" ON "canvas_agent_steps"("runId", "stepKey");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_agent_leases_runId_key" ON "canvas_agent_leases"("runId");

-- CreateIndex
CREATE INDEX "canvas_agent_leases_expiresAt_idx" ON "canvas_agent_leases"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_chat_messages_runId_role_key" ON "canvas_chat_messages"("runId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_agent_runs_conversationId_requestId_key" ON "canvas_agent_runs"("conversationId", "requestId");

-- AddForeignKey
ALTER TABLE "canvas_chat_messages" ADD CONSTRAINT "canvas_chat_messages_runId_fkey" FOREIGN KEY ("runId") REFERENCES "canvas_agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canvas_agent_steps" ADD CONSTRAINT "canvas_agent_steps_runId_fkey" FOREIGN KEY ("runId") REFERENCES "canvas_agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canvas_agent_leases" ADD CONSTRAINT "canvas_agent_leases_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "canvases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canvas_agent_leases" ADD CONSTRAINT "canvas_agent_leases_runId_fkey" FOREIGN KEY ("runId") REFERENCES "canvas_agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
