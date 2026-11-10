-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "permissionOverrides" JSONB;

-- AlterTable
ALTER TABLE "Server" ADD COLUMN     "iconUrl" TEXT,
ADD COLUMN     "rules" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "ServerRole" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 10,
    "permissions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerRoleMember" (
    "roleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ServerRoleMember_pkey" PRIMARY KEY ("roleId","userId")
);

-- CreateTable
CREATE TABLE "ChannelRoleOverride" (
    "channelId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,

    CONSTRAINT "ChannelRoleOverride_pkey" PRIMARY KEY ("channelId","roleId")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bot" (
    "id" TEXT NOT NULL,
    "developerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotInstallation" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "channelIds" JSONB NOT NULL,
    "permissions" JSONB NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotWelcome" (
    "installationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "BotWelcome_pkey" PRIMARY KEY ("installationId","userId")
);

-- CreateTable
CREATE TABLE "BotEvent" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServerRole_serverId_position_idx" ON "ServerRole"("serverId", "position");

-- CreateIndex
CREATE INDEX "ServerRoleMember_userId_idx" ON "ServerRoleMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_number_key" ON "Ticket"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_conversationId_key" ON "Ticket"("conversationId");

-- CreateIndex
CREATE INDEX "Ticket_serverId_status_createdAt_idx" ON "Ticket"("serverId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_memberId_createdAt_idx" ON "Ticket"("memberId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_creatorId_clientId_key" ON "Ticket"("creatorId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Bot_userId_key" ON "Bot"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Bot_tokenHash_key" ON "Bot"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "BotInstallation_botId_serverId_key" ON "BotInstallation"("botId", "serverId");

-- CreateIndex
CREATE INDEX "BotEvent_installationId_createdAt_id_idx" ON "BotEvent"("installationId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "ServerRole" ADD CONSTRAINT "ServerRole_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerRoleMember" ADD CONSTRAINT "ServerRoleMember_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "ServerRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerRoleMember" ADD CONSTRAINT "ServerRoleMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelRoleOverride" ADD CONSTRAINT "ChannelRoleOverride_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelRoleOverride" ADD CONSTRAINT "ChannelRoleOverride_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "ServerRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotInstallation" ADD CONSTRAINT "BotInstallation_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotInstallation" ADD CONSTRAINT "BotInstallation_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotWelcome" ADD CONSTRAINT "BotWelcome_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "BotInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotEvent" ADD CONSTRAINT "BotEvent_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "BotInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

