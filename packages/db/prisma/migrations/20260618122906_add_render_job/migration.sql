-- CreateTable
CREATE TABLE "render_jobs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "outputUrl" TEXT,
    "outputPath" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "render_jobs_pkey" PRIMARY KEY ("id")
);
