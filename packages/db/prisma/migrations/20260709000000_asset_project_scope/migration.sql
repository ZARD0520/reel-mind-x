ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "projectId" TEXT;

-- 回填：把每个 asset 挂到其 user 的最近一个未删除项目上；无项目的 user 的 asset 直接删除（无法归属）
UPDATE "assets" a
SET "projectId" = p."id"
FROM (
  SELECT DISTINCT ON ("userId") "id", "userId"
  FROM "projects"
  WHERE "deletedAt" IS NULL
  ORDER BY "userId", "updatedAt" DESC
) p
WHERE a."userId" = p."userId" AND a."projectId" IS NULL;

DELETE FROM "assets" WHERE "projectId" IS NULL;

ALTER TABLE "assets" ALTER COLUMN "projectId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_projectId_fkey') THEN
    ALTER TABLE "assets"
      ADD CONSTRAINT "assets_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DROP INDEX IF EXISTS "assets_userId_createdAt_idx";
CREATE INDEX IF NOT EXISTS "assets_userId_projectId_createdAt_idx"
  ON "assets"("userId", "projectId", "createdAt");
