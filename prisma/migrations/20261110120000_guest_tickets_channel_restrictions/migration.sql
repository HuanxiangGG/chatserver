-- Additive upgrade: existing member tickets remain enabled; guests opt in only.
ALTER TABLE "Server" ADD COLUMN "privateTicketsEnabled" BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN "guestTicketsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Ticket" ALTER COLUMN "memberId" DROP NOT NULL,
 ADD COLUMN "guestName" TEXT, ADD COLUMN "recoveryHash" TEXT;
ALTER TABLE "Message" ALTER COLUMN "senderId" DROP NOT NULL, ADD COLUMN "guestTicketId" TEXT;
ALTER TABLE "MessageAttachment" ALTER COLUMN "ownerId" DROP NOT NULL, ADD COLUMN "guestTicketId" TEXT;
ALTER TABLE "Message" ADD CONSTRAINT "Message_guestTicketId_fkey" FOREIGN KEY ("guestTicketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT;
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "Attachment_guestTicketId_fkey" FOREIGN KEY ("guestTicketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT;
ALTER TABLE "Message" ADD CONSTRAINT "Message_author_check" CHECK (("senderId" IS NOT NULL)::int + ("guestTicketId" IS NOT NULL)::int = 1);
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "Attachment_owner_check" CHECK (("ownerId" IS NOT NULL)::int + ("guestTicketId" IS NOT NULL)::int = 1);
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_identity_check" CHECK (("memberId" IS NOT NULL AND "guestName" IS NULL AND "recoveryHash" IS NULL) OR ("memberId" IS NULL AND "guestName" IS NOT NULL AND "recoveryHash" IS NOT NULL));
CREATE UNIQUE INDEX "Message_guestTicketId_clientId_key" ON "Message"("guestTicketId", "clientId");
CREATE TABLE "GuestTicketSession" ("id" TEXT PRIMARY KEY, "ticketId" TEXT NOT NULL REFERENCES "Ticket"("id") ON DELETE CASCADE, "tokenHash" TEXT NOT NULL UNIQUE, "csrfToken" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "GuestTicketSession_ticketId_expiresAt_idx" ON "GuestTicketSession"("ticketId", "expiresAt");
CREATE TABLE "ChannelRestriction" ("channelId" TEXT NOT NULL REFERENCES "Channel"("id") ON DELETE CASCADE, "userId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "reason" TEXT NOT NULL, "until" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("channelId", "userId"));
CREATE INDEX "ChannelRestriction_userId_until_idx" ON "ChannelRestriction"("userId", "until");
