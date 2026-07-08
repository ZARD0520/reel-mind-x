ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "passwordHash" TEXT,
  ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';

INSERT INTO "users" ("id", "email", "name", "createdAt", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000001', 'legacy@reelmind.local', 'Legacy User', NOW(), NOW())
ON CONFLICT ("email") DO NOTHING;

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "userId" TEXT;
UPDATE "projects" SET "userId" = '00000000-0000-0000-0000-000000000001' WHERE "userId" IS NULL;
ALTER TABLE "projects" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "userId" TEXT;
UPDATE "assets" SET "userId" = '00000000-0000-0000-0000-000000000001' WHERE "userId" IS NULL;
ALTER TABLE "assets" ALTER COLUMN "userId" SET NOT NULL;

ALTER TABLE "render_jobs" ADD COLUMN IF NOT EXISTS "userId" TEXT;
UPDATE "render_jobs" SET "userId" = '00000000-0000-0000-0000-000000000001' WHERE "userId" IS NULL;
ALTER TABLE "render_jobs" ALTER COLUMN "userId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_userId_fkey') THEN
    ALTER TABLE "projects"
      ADD CONSTRAINT "projects_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_userId_fkey') THEN
    ALTER TABLE "assets"
      ADD CONSTRAINT "assets_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'render_jobs_userId_fkey') THEN
    ALTER TABLE "render_jobs"
      ADD CONSTRAINT "render_jobs_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "projects_userId_updatedAt_idx" ON "projects"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "assets_userId_createdAt_idx" ON "assets"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "render_jobs_userId_createdAt_idx" ON "render_jobs"("userId", "createdAt");
