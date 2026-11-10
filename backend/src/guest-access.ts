import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { prisma, hashToken, HttpError } from "./context.js";
export const guestCookie = (ticketId: string) => `harbor_guest_${ticketId}`;
export const guestDenied = () =>
  new HttpError(
    404,
    "无法查询工单，请检查社区入口、工单 ID 和恢复码",
    "GUEST_ACCESS_DENIED",
  );
export function secretEqual(a: string, b: string) {
  return (
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export async function guestAccess(
  serverId: string,
  ticketId: string,
  token: unknown,
  write = false,
) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    throw guestDenied();
  const session = await prisma.guestTicketSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { ticket: true },
  });
  if (
    !session ||
    session.expiresAt <= new Date() ||
    session.ticketId !== ticketId ||
    session.ticket.serverId !== serverId ||
    !session.ticket.guestName
  )
    throw guestDenied();
  if (write && session.ticket.status === "CLOSED")
    throw new HttpError(403, "工单已关闭，请先重新打开", "TICKET_CLOSED");
  return session;
}
export async function guestRequest(req: Request, write = false) {
  const serverId = String(req.params.serverId),
    ticketId = String(req.params.ticketId);
  const session = await guestAccess(
    serverId,
    ticketId,
    req.cookies?.[guestCookie(ticketId)],
    write,
  );
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    !secretEqual(req.get("X-CSRF-Token") || "", session.csrfToken)
  )
    throw new HttpError(403, "CSRF 校验失败，请刷新页面后重试", "CSRF_INVALID");
  return session;
}
