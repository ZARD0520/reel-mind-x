-- CreateTable
CREATE TABLE "asset_folders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_folders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_folders_userId_createdAt_idx" ON "asset_folders"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "asset_folders_teamId_createdAt_idx" ON "asset_folders"("teamId", "createdAt");

-- AddForeignKey
ALTER TABLE "asset_folders" ADD CONSTRAINT "asset_folders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
