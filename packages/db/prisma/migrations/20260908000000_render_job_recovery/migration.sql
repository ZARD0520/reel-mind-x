-- AlterTable
ALTER TABLE "render_jobs"
ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'queued',
ADD COLUMN "quality" TEXT NOT NULL DEFAULT 'high',
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "checkpoint" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN "timelineSnapshot" JSONB,
ADD COLUMN "checkpointData" JSONB,
ADD COLUMN "errorDetail" TEXT,
ADD COLUMN "failureCode" TEXT,
ADD COLUMN "failureCategory" TEXT,
ADD COLUMN "failureLevel" TEXT,
ADD COLUMN "failureStage" TEXT,
ADD COLUMN "retryable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "nextRetryAt" TIMESTAMP(3),
ADD COLUMN "finishedAt" TIMESTAMP(3),
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing terminal jobs predate stage/checkpoint tracking.
UPDATE "render_jobs"
SET "stage" = CASE WHEN "status" = 'completed' THEN 'completed' ELSE 'queued' END,
    "checkpoint" = CASE WHEN "status" = 'completed' THEN 'rendered' ELSE 'none' END,
    "finishedAt" = CASE WHEN "status" IN ('completed', 'failed') THEN "createdAt" ELSE NULL END;

CREATE INDEX "render_jobs_userId_projectId_createdAt_idx"
ON "render_jobs"("userId", "projectId", "createdAt");

CREATE INDEX "render_jobs_status_updatedAt_idx"
ON "render_jobs"("status", "updatedAt");
