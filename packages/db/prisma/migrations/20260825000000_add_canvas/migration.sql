CREATE TABLE "canvases" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvases_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "canvases"
  ADD CONSTRAINT "canvases_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "canvases_userId_updatedAt_idx" ON "canvases"("userId", "updatedAt");
