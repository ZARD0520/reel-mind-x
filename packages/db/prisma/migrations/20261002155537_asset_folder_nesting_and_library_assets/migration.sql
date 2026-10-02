-- AlterTable
ALTER TABLE "asset_folders" ADD COLUMN     "parentId" TEXT;

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "folderId" TEXT;

-- CreateIndex
CREATE INDEX "assets_userId_folderId_createdAt_idx" ON "assets"("userId", "folderId", "createdAt");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "asset_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_folders" ADD CONSTRAINT "asset_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "asset_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 素材库素材独立于项目/画布：folderId 非空时允许 projectId/canvasId 均为空
ALTER TABLE "assets" DROP CONSTRAINT "assets_scope_check";

ALTER TABLE "assets" ADD CONSTRAINT "assets_scope_check"
CHECK (("folderId" IS NOT NULL) OR (("projectId" IS NOT NULL)::int + ("canvasId" IS NOT NULL)::int = 1));
