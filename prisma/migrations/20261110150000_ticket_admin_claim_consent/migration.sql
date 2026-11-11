ALTER TABLE "Server" ADD COLUMN "adminTicketClaimEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Ticket" ADD COLUMN "ownerOnly" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "handoffAssigneeId" TEXT,
  ADD COLUMN "handoffRequestedAt" TIMESTAMP(3);
CREATE TABLE "TicketHandoffConsent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ticketId" TEXT NOT NULL,
  "assigneeId" TEXT NOT NULL,
  "userId" TEXT,
  "guestSessionId" TEXT,
  "approved" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketHandoffConsent_actor_check" CHECK (("userId" IS NOT NULL) <> ("guestSessionId" IS NOT NULL)),
  CONSTRAINT "TicketHandoffConsent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX "TicketHandoffConsent_ticketId_createdAt_idx" ON "TicketHandoffConsent"("ticketId", "createdAt");
CREATE INDEX "Ticket_claim_queue_idx" ON "Ticket"("serverId", "ownerOnly", "status", "assigneeId", "createdAt");
