#!/usr/bin/env bash
# Read-only inventory. Redirect output to a private backup directory outside Git.
set -euo pipefail
umask 077
docker compose config --volumes
docker compose exec -T backend node --input-type=module -e '
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient({log:[]});
try {
  const counts = {};
  for (const name of ["user", "conversation", "conversationMember", "message", "messageAttachment", "friendship", "blockedUser", "adminAction", "server", "serverMember", "channel", "ticket", "botInstallation", "guestTicketSession", "channelRestriction"]) if (db[name]?.count) counts[name] = await db[name].count();
  console.log(JSON.stringify(counts));
} finally { await db.$disconnect(); }
'
docker compose exec -T backend sh -c 'find /app/uploads -type f -exec sha256sum {} \; | sort'
