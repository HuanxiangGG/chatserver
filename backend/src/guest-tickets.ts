import { Router, type Response } from "express";
import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import { z } from "zod";
import {
  prisma,
  config,
  hashToken,
  asyncRoute,
  validate,
  HttpError,
  consumeLimit,
} from "./context.js";
import {
  guestCookie,
  guestDenied,
  guestRequest,
  secretEqual,
} from "./guest-access.js";
import { lockServer } from "./channel-policy.js";
import { messageInclude, serializeMessage } from "./chat.js";
import { emitUsers } from "./realtime.js";
import { upload, storeUpload, sendAttachment } from "./attachment-storage.js";
const router = Router(),
  id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  secret = z.string().regex(/^[a-f0-9]{64}$/);
const expiry = () => new Date(Date.now() + 30 * 86400000);
async function session(res: Response, ticketId: string) {
  const token = randomBytes(32).toString("hex"),
    csrfToken = randomBytes(32).toString("hex"),
    expiresAt = expiry();
  await prisma.guestTicketSession.create({
    data: { ticketId, tokenHash: hashToken(token), csrfToken, expiresAt },
  });
  res.cookie(guestCookie(ticketId), token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  res.setHeader("Cache-Control", "no-store");
  return csrfToken;
}
const safeTicket = (t: {
  id: string;
  number: number;
  subject: string;
  guestName: string | null;
  status: string;
  serverId: string;
  conversationId: string;
}) => ({
  id: t.id,
  number: t.number,
  subject: t.subject,
  guestName: t.guestName,
  status: t.status,
  serverId: t.serverId,
  conversationId: t.conversationId,
});
async function notify(conversationId: string, message?: unknown) {
  const users = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  });
  if (message)
    emitUsers(
      users.map((m) => m.userId),
      "message:new",
      message,
    );
  emitUsers(
    users.map((m) => m.userId),
    "conversation:updated",
    { id: conversationId },
  );
}
router.use("/guest", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
router.get(
  "/guest/:serverId",
  asyncRoute(async (req, res) => {
    const server = await prisma.server.findUnique({
      where: { id: validate(id, req.params.serverId) },
      select: {
        id: true,
        name: true,
        privateTicketsEnabled: true,
        guestTicketsEnabled: true,
      },
    });
    if (!server) throw guestDenied();
    res.json({
      id: server.id,
      name: server.name,
      canCreate: server.privateTicketsEnabled && server.guestTicketsEnabled,
    });
  }),
);
router.post(
  "/guest/:serverId/tickets",
  asyncRoute(async (req, res) => {
    const serverId = validate(id, req.params.serverId),
      input = validate(
        z.strictObject({
          clientId: id,
          displayName: z.string().trim().min(1).max(60),
          subject: z.string().trim().min(1).max(120),
          content: z.string().trim().min(1).max(4000),
          recoveryCode: secret,
        }),
        req.body,
      );
    await consumeLimit(`guest-create:${req.ip}`, 10, 3600);
    const ticket = await prisma.$transaction(async (db) => {
      await lockServer(db, serverId);
      const server = await db.server.findUnique({ where: { id: serverId } });
      if (!server) throw guestDenied();
      const old = await db.ticket.findUnique({
        where: {
          creatorId_clientId: {
            creatorId: `guest:${serverId}`,
            clientId: input.clientId,
          },
        },
      });
      if (old) {
        if (
          !old.recoveryHash ||
          !secretEqual(old.recoveryHash, hashToken(input.recoveryCode))
        )
          throw guestDenied();
        const first = await db.message.findFirst({
          where: { conversationId: old.conversationId },
          orderBy: { createdAt: "asc" },
        });
        if (
          old.subject !== input.subject ||
          old.guestName !== input.displayName ||
          first?.content !== input.content
        )
          throw new HttpError(409, "工单标识已用于其他内容", "TICKET_CONFLICT");
        return old;
      }
      if (!server.privateTicketsEnabled || !server.guestTicketsEnabled)
        throw new HttpError(
          403,
          "此社区暂不接受游客新工单",
          "GUEST_TICKETS_DISABLED",
        );
      const c = await db.conversation.create({
        data: {
          type: "TICKET",
          name: input.subject,
          members: { create: { userId: server.ownerId, role: "OWNER" } },
        },
      });
      const t = await db.ticket.create({
        data: {
          serverId,
          conversationId: c.id,
          guestName: input.displayName,
          recoveryHash: hashToken(input.recoveryCode),
          creatorId: `guest:${serverId}`,
          clientId: input.clientId,
          subject: input.subject,
          category: "GUEST",
        },
      });
      await db.message.create({
        data: {
          conversationId: c.id,
          guestTicketId: t.id,
          content: input.content,
          clientId: `first:${t.id}`,
        },
      });
      return t;
    });
    const csrfToken = await session(res, ticket.id);
    await notify(ticket.conversationId);
    res.status(201).json({ ticket: safeTicket(ticket), csrfToken });
  }),
);
router.post(
  "/guest/:serverId/recover",
  asyncRoute(async (req, res) => {
    const serverId = validate(id, req.params.serverId),
      input = validate(
        z.strictObject({ ticketId: id, recoveryCode: secret }),
        req.body,
      );
    await consumeLimit(`guest-recover:${req.ip}`, 10, 900);
    const ticket = await prisma.ticket.findFirst({
      where: { id: input.ticketId, serverId, memberId: null },
    });
    const hash = hashToken(input.recoveryCode);
    if (!ticket?.recoveryHash || !secretEqual(ticket.recoveryHash, hash))
      throw guestDenied();
    const csrfToken = await session(res, ticket.id);
    res.json({ ticket: safeTicket(ticket), csrfToken });
  }),
);
router.get(
  "/guest/:serverId/tickets/:ticketId",
  asyncRoute(async (req, res) => {
    await consumeLimit(`guest-query:${req.ip}`, 240, 60);
    const s = await guestRequest(req);
    res.json({ ticket: safeTicket(s.ticket), csrfToken: s.csrfToken });
  }),
);
router.get(
  "/guest/:serverId/tickets/:ticketId/messages",
  asyncRoute(async (req, res) => {
    const s = await guestRequest(req),
      before = validate(id.optional(), req.query.before);
    let boundary: { createdAt: Date; id: string } | null = null;
    if (before) {
      boundary = await prisma.message.findFirst({
        where: { id: before, conversationId: s.ticket.conversationId },
        select: { createdAt: true, id: true },
      });
      if (!boundary) throw guestDenied();
    }
    const rows = await prisma.message.findMany({
      where: {
        conversationId: s.ticket.conversationId,
        ...(boundary
          ? {
              OR: [
                { createdAt: { lt: boundary.createdAt } },
                { createdAt: boundary.createdAt, id: { lt: boundary.id } },
              ],
            }
          : {}),
      },
      include: messageInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
    });
    res.json({
      messages: rows.slice(0, 50).reverse().map(serializeMessage),
      hasMore: rows.length > 50,
    });
  }),
);
router.post(
  "/guest/:serverId/tickets/:ticketId/messages",
  asyncRoute(async (req, res) => {
    const s = await guestRequest(req, true),
      input = validate(
        z
          .strictObject({
            clientId: id,
            content: z.string().trim().max(4000),
            replyToId: id.nullable().optional(),
            attachmentIds: z.array(id).max(5).default([]),
          })
          .refine((v) => !!v.content || v.attachmentIds.length > 0),
        req.body,
      );
    await consumeLimit(`guest-message:${s.ticketId}`, 120, 60);
    const result = await prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${s.ticket.conversationId} FOR UPDATE`;
      const t = await db.ticket.findUniqueOrThrow({
        where: { id: s.ticketId },
      });
      if (t.status === "CLOSED")
        throw new HttpError(403, "工单已关闭，请先重新打开", "TICKET_CLOSED");
      const old = await db.message.findUnique({
        where: {
          guestTicketId_clientId: {
            guestTicketId: s.ticketId,
            clientId: input.clientId,
          },
        },
        include: messageInclude,
      });
      if (old) {
        if (
          old.content !== input.content ||
          old.replyToId !== (input.replyToId || null) ||
          old.attachments
            .map((a) => a.id)
            .sort()
            .join() !== [...input.attachmentIds].sort().join()
        )
          throw new HttpError(409, "工单标识已用于其他内容", "TICKET_CONFLICT");
        return { message: old, created: false };
      }
      if (
        input.replyToId &&
        !(await db.message.findFirst({
          where: {
            id: input.replyToId,
            conversationId: t.conversationId,
            retractedAt: null,
          },
        }))
      )
        throw guestDenied();
      const message = await db.message.create({
        data: {
          guestTicketId: t.id,
          conversationId: t.conversationId,
          content: input.content,
          clientId: input.clientId,
          replyToId: input.replyToId,
        },
        include: messageInclude,
      });
      const ids = [...new Set(input.attachmentIds)];
      if (
        ids.length &&
        (
          await db.messageAttachment.updateMany({
            where: { id: { in: ids }, guestTicketId: t.id, messageId: null },
            data: { messageId: message.id },
          })
        ).count !== ids.length
      )
        throw guestDenied();
      await db.conversation.update({
        where: { id: t.conversationId },
        data: { updatedAt: new Date() },
      });
      return {
        message: await db.message.findUniqueOrThrow({
          where: { id: message.id },
          include: messageInclude,
        }),
        created: true,
      };
    });
    if (result.created)
      await notify(s.ticket.conversationId, serializeMessage(result.message));
    res
      .status(result.created ? 201 : 200)
      .json(serializeMessage(result.message));
  }),
);
router.post(
  "/guest/:serverId/tickets/:ticketId/uploads",
  asyncRoute(async (req, _res, next) => {
    const s = await guestRequest(req, true);
    await consumeLimit(`guest-upload:${s.ticketId}`, 20, 60);
    next();
  }),
  upload.single("file"),
  asyncRoute(async (req, res) => {
    const s = await guestRequest(req, true),
      { filepath, ...data } = await storeUpload(req.file);
    try {
      const a = await prisma.messageAttachment.create({
        data: { ...data, guestTicketId: s.ticketId },
      });
      res.status(201).json({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
      });
    } catch (e) {
      await unlink(filepath).catch(() => undefined);
      throw e;
    }
  }),
);
router.get(
  "/guest/:serverId/tickets/:ticketId/files/:fileId",
  asyncRoute(async (req, res) => {
    const s = await guestRequest(req),
      a = await prisma.messageAttachment.findUnique({
        where: { id: validate(id, req.params.fileId) },
        include: { message: true },
      });
    if (
      !a ||
      !(
        (a.guestTicketId === s.ticketId && !a.messageId) ||
        (a.message?.conversationId === s.ticket.conversationId &&
          !a.message.retractedAt)
      )
    )
      throw guestDenied();
    sendAttachment(res, a);
  }),
);
export default router;
