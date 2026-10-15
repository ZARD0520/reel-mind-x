CREATE TABLE "canvas_conversations" (
  "id" TEXT NOT NULL,
  "canvasId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '新对话',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "canvas_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "canvas_chat_messages" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "canvas_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "canvas_conversations_canvasId_updatedAt_idx" ON "canvas_conversations"("canvasId", "updatedAt");
CREATE INDEX "canvas_conversations_userId_updatedAt_idx" ON "canvas_conversations"("userId", "updatedAt");
CREATE INDEX "canvas_chat_messages_conversationId_createdAt_idx" ON "canvas_chat_messages"("conversationId", "createdAt");

ALTER TABLE "canvas_conversations" ADD CONSTRAINT "canvas_conversations_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "canvases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "canvas_conversations" ADD CONSTRAINT "canvas_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "canvas_chat_messages" ADD CONSTRAINT "canvas_chat_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "canvas_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
