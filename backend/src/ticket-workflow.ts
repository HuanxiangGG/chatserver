import type { Prisma } from "@prisma/client";
import { HttpError } from "./context.js";
import { effectiveServerPermissions } from "./community-permissions.js";

export async function assertTicketHandler(
  db: Prisma.TransactionClient,
  serverId: string,
  userId: string,
) {
  const m = await effectiveServerPermissions(serverId, userId, db);
  if (!m.permissions.handleTickets)
    throw new HttpError(
      403,
      "请选择本社区的管理员或版主",
      "TICKET_HANDLER_REQUIRED",
    );
  return m;
}
export async function decideTicketHandoff(
  db: Prisma.TransactionClient,
  ticketId: string,
  approved: boolean,
  expectedAssigneeId: string,
  actor: { userId?: string; guestSessionId?: string },
) {
  const t = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  if (
    !t.handoffAssigneeId ||
    !t.handoffRequestedAt ||
    t.handoffAssigneeId !== expectedAssigneeId
  )
    throw new HttpError(409, "没有待确认的转交请求", "TICKET_CONSENT_STALE");
  if (actor.userId && actor.userId !== t.memberId)
    throw new HttpError(
      403,
      "只有工单当事人可以确认转交",
      "TICKET_CONSENT_PARTICIPANT",
    );
  if (
    actor.guestSessionId &&
    !(await db.guestTicketSession.findFirst({
      where: {
        id: actor.guestSessionId,
        ticketId,
        expiresAt: { gt: new Date() },
      },
    }))
  )
    throw new HttpError(
      403,
      "只有工单当事人可以确认转交",
      "TICKET_CONSENT_PARTICIPANT",
    );
  if (!actor.userId && !actor.guestSessionId)
    throw new HttpError(
      403,
      "只有工单当事人可以确认转交",
      "TICKET_CONSENT_PARTICIPANT",
    );
  if (approved) await assertTicketHandler(db, t.serverId, t.handoffAssigneeId);
  await db.ticketHandoffConsent.create({
    data: { ticketId, assigneeId: t.handoffAssigneeId, ...actor, approved },
  });
  return db.ticket.update({
    where: { id: ticketId },
    data: {
      ...(approved
        ? {
            assigneeId: t.handoffAssigneeId,
            ...(t.status !== "CLOSED" ? { status: "IN_PROGRESS" } : {}),
          }
        : {}),
      handoffAssigneeId: null,
      handoffRequestedAt: null,
    },
  });
}
