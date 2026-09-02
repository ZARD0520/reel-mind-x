ALTER TABLE "assets"
ALTER COLUMN "projectId" DROP NOT NULL,
ADD COLUMN "canvasId" TEXT;

ALTER TABLE "assets"
ADD CONSTRAINT "assets_canvasId_fkey"
FOREIGN KEY ("canvasId") REFERENCES "canvases"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assets"
ADD CONSTRAINT "assets_scope_check"
CHECK (("projectId" IS NOT NULL)::int + ("canvasId" IS NOT NULL)::int = 1);

CREATE INDEX "assets_userId_canvasId_createdAt_idx"
ON "assets"("userId", "canvasId", "createdAt");
