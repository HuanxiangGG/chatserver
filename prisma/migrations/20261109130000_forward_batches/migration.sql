ALTER TABLE "Message" ADD COLUMN "forwardedFrom" JSONB;
CREATE TABLE "ForwardBatch" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "clientId" TEXT NOT NULL, "payloadHash" TEXT NOT NULL, "messageIds" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ForwardBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "ForwardBatch_userId_clientId_key" ON "ForwardBatch"("userId", "clientId");
