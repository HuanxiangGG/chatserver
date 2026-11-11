import type { Prisma } from "@prisma/client";
import { prisma, HttpError } from "./context.js";
import { effectiveServerPermissions } from "./community-permissions.js";
async function eligibleHandler(
  serverId: string,
  userId: string,
  db: Prisma.TransactionClient,
) {
  try {
    return (await effectiveServerPermissions(serverId, userId, db)).permissions
      .handleTickets;
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) return false;
    throw error;
  }
}
export async function ticketPermission(
  conversationId: string,
  userId: string,
  write = false,
  db: Prisma.TransactionClient = prisma,
) {
  const ticket = await db.ticket.findUnique({
    where: { conversationId },
    include: { server: { select: { ownerId: true } } },
  });
  if (!ticket) return null;
  const joined = await db.serverMember.findUnique({
    where: { serverId_userId: { serverId: ticket.serverId, userId } },
  });
  if (
    !joined ||
    ![ticket.memberId, ticket.server.ownerId, ticket.assigneeId].includes(
      userId,
    ) ||
    (userId === ticket.assigneeId &&
      userId !== ticket.server.ownerId &&
      !(await eligibleHandler(ticket.serverId, userId, db)))
  )
    throw new HttpError(403, "无权访问此工单", "TICKET_FORBIDDEN");
  if (write && ticket.status === "CLOSED")
    throw new HttpError(403, "工单已关闭，请先重新打开", "TICKET_CLOSED");
  if (write && joined.mutedUntil && joined.mutedUntil > new Date())
    throw new HttpError(403, "你正在被禁言", "COMMUNITY_MUTED");
  return ticket;
}
export async function syncTicketReaders(
  db: Prisma.TransactionClient,
  serverId: string,
) {
  const server = await db.server.findUniqueOrThrow({
    where: { id: serverId },
    select: { ownerId: true },
  });
  const users = await db.serverMember.findMany({
    where: { serverId },
    select: { userId: true },
  });
  const tickets = await db.ticket.findMany({
    where: { serverId },
    orderBy: { conversationId: "asc" },
  });
  for (const t of tickets) {
    await db.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${t.conversationId} FOR UPDATE`;
    if (
      t.handoffAssigneeId &&
      !(await eligibleHandler(serverId, t.handoffAssigneeId, db))
    )
      await db.ticket.update({
        where: { id: t.id },
        data: { handoffAssigneeId: null, handoffRequestedAt: null },
      });
    let assigneeId = t.assigneeId;
    if (assigneeId && !(await eligibleHandler(serverId, assigneeId, db))) {
      assigneeId = null;
      await db.ticket.update({
        where: { id: t.id },
        data: {
          assigneeId: null,
          ...(t.status === "IN_PROGRESS" ? { status: "OPEN" } : {}),
        },
      });
    }
    const ids = [
      ...new Set(
        [server.ownerId, t.memberId, assigneeId].filter(
          (id): id is string => !!id && users.some((u) => u.userId === id),
        ),
      ),
    ];
    await db.conversationMember.deleteMany({
      where: { conversationId: t.conversationId, userId: { notIn: ids } },
    });
    await db.conversationMember.createMany({
      data: ids.map((userId) => ({
        conversationId: t.conversationId,
        userId,
        role: userId === server.ownerId ? "OWNER" : "MEMBER",
      })),
      skipDuplicates: true,
    });
  }
}
