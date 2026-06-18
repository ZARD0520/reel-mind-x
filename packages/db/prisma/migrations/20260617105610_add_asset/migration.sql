-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "localPath" TEXT,
    "durationInFrames" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "prompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);
