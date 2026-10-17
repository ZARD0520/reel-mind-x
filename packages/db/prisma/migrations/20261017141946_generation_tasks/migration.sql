-- CreateTable
CREATE TABLE "generation_tasks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canvasId" TEXT,
    "projectId" TEXT,
    "nodeId" TEXT,
    "requestId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "activeNodeKey" TEXT,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_task_items" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "assetId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "providerTaskId" TEXT,
    "providerResult" JSONB,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "pollFailures" INTEGER NOT NULL DEFAULT 0,
    "saveAttempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "errorCode" TEXT,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_task_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "generation_tasks_activeNodeKey_key" ON "generation_tasks"("activeNodeKey");

-- CreateIndex
CREATE INDEX "generation_tasks_userId_canvasId_createdAt_idx" ON "generation_tasks"("userId", "canvasId", "createdAt");

-- CreateIndex
CREATE INDEX "generation_tasks_status_updatedAt_idx" ON "generation_tasks"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "generation_tasks_userId_requestId_key" ON "generation_tasks"("userId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "generation_task_items_assetId_key" ON "generation_task_items"("assetId");

-- CreateIndex
CREATE INDEX "generation_task_items_status_nextRunAt_leaseExpiresAt_idx" ON "generation_task_items"("status", "nextRunAt", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "generation_task_items_taskId_index_key" ON "generation_task_items"("taskId", "index");

-- AddForeignKey
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "canvases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_task_items" ADD CONSTRAINT "generation_task_items_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "generation_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_task_items" ADD CONSTRAINT "generation_task_items_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
