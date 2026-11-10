CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Message_conversationId_senderId_createdAt_id_idx" ON "Message"("conversationId", "senderId", "createdAt", "id");
CREATE INDEX "Message_content_trgm_idx" ON "Message" USING GIN ("content" gin_trgm_ops);
