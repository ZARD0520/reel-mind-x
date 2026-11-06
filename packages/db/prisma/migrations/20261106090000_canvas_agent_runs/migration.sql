CREATE TABLE "canvas_agent_runs" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "events" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "canvas_agent_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "canvas_agent_runs_conversationId_createdAt_idx" ON "canvas_agent_runs"("conversationId", "createdAt");
ALTER TABLE "canvas_agent_runs" ADD CONSTRAINT "canvas_agent_runs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "canvas_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
