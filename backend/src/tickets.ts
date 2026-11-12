import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import {
  prisma,
  requireAuth,
  asyncRoute,
  validate,
  HttpError,
  publicUserSelect,
  consumeLimit,
} from "./context.js";
import { serverMember, lockServer } from "./channel-policy.js";
import { ticketPermission, syncTicketReaders } from "./ticket-policy.js";
import { assertTicketHandler, decideTicketHandoff } from "./ticket-workflow.js";
import { emitUsers } from "./realtime.js";
const router = Router();
router.use(requireAuth);
const id = z.string().min(1).max(100),
  status = z.enum(["OPEN", "IN_PROGRESS", "CLOSED"]);
async function info(ticket: Prisma.TicketGetPayload<{}>, userId: string) {
  const server = await prisma.server.findUniqueOrThrow({
    where: { id: ticket.serverId },
    select: { ownerId: true },
  });
  const people = await prisma.user.findMany({
    where: {
      id: {
        in: [
          ticket.memberId,
          server.ownerId,
          ticket.assigneeId,
          ticket.handoffAssigneeId,
        ].filter((v): v is string => !!v),
      },
    },
    select: publicUserSelect,
  });
  const unreadCount = await prisma.message.count({
    where: {
      conversationId: ticket.conversationId,
      OR: [{ senderId: { not: userId } }, { senderId: null }],
      retractedAt: null,
      hidden: { none: { userId } },
      reads: { none: { userId, readAt: { not: null } } },
    },
  });
  // The normal queue is already permission-scoped. Keep previews scoped to this
  // reader too: a locally hidden message must not reappear in the list.
  const [lastMessage, lastReply] = await Promise.all([
    prisma.message.findFirst({
      where: { conversationId: ticket.conversationId, hidden: { none: { userId } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        content: true, createdAt: true, editedAt: true, retractedAt: true,
        sender: { select: { displayName: true } },
        attachments: { select: { mimeType: true, filename: true }, take: 1 },
      },
    }),
    // Waiting is a conversation fact, not a manual status or an unread guess.
    prisma.message.findFirst({
      where: { conversationId: ticket.conversationId, retractedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { senderId: true, guestTicketId: true, createdAt: true },
    }),
  ]);
  const attachment = lastMessage?.attachments[0];
  const lastActivityAt = new Date(Math.max(ticket.updatedAt.getTime(), lastReply?.createdAt.getTime() ?? 0, lastMessage?.editedAt?.getTime() ?? 0));
  const preview = lastMessage ? {
    content: lastMessage.retractedAt ? "" : Array.from(lastMessage.content).slice(0, 180).join(""),
    senderName: lastMessage.sender?.displayName || ticket.guestName || "",
    kind: lastMessage.retractedAt ? "RETRACTED" : lastMessage.content ? "TEXT" : attachment?.mimeType.startsWith("image/") ? "IMAGE" : attachment ? "FILE" : "TEXT",
    filename: lastMessage.retractedAt ? undefined : attachment?.filename,
    createdAt: lastMessage.createdAt,
  } : null;
  const waitingFor = ticket.status === "CLOSED" || !lastReply ? null :
    lastReply.senderId === ticket.memberId || lastReply.guestTicketId === ticket.id ? "STAFF" : "MEMBER";
  const { recoveryHash: _secret, ...safe } = ticket;
  return {
    ...safe,
    member: people.find((p) => p.id === ticket.memberId),
    owner: people.find((p) => p.id === server.ownerId),
    assignee: people.find((p) => p.id === ticket.assigneeId) ?? null,
    handoffAssignee:
      people.find((p) => p.id === ticket.handoffAssigneeId) ?? null,
    unreadCount,
    lastMessage: preview,
    lastActivityAt,
    waitingFor,
  };
}
export async function notifyTicket(ticketId: string, prior: string[] = []) {
  const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  const readers = (
    await prisma.conversationMember.findMany({
      where: { conversationId: t.conversationId },
      select: { userId: true },
    })
  ).map((m) => m.userId);
  emitUsers(
    prior.filter((id) => !readers.includes(id)),
    "ticket:access-revoked",
    { id: t.id, serverId: t.serverId, conversationId: t.conversationId },
  );
  emitUsers(readers, "ticket:updated", {
    id: t.id,
    serverId: t.serverId,
    conversationId: t.conversationId,
  });
  emitUsers(readers, "conversation:updated", { id: t.conversationId });
  // A content-free invalidation; administrators fetch the redacted queue separately.
  const admins = await prisma.serverMember.findMany({
    where: {
      serverId: t.serverId,
      role: "ADMIN",
      ...(t.ownerOnly ? { userId: { in: readers } } : {}),
    },
    select: { userId: true },
  });
  emitUsers(
    admins.map((m) => m.userId),
    "ticket:queue-changed",
    { serverId: t.serverId },
  );
}
const pageQuery = z.object({
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
async function paginate(
  where: Prisma.TicketWhereInput,
  query: z.infer<typeof pageQuery>,
) {
  if (query.cursor) {
    const c = await prisma.ticket.findFirst({
      where: { AND: [where, { id: query.cursor }] },
    });
    if (!c) throw new HttpError(400, "无效的工单游标", "TICKET_CURSOR");
    where = {
      AND: [
        where,
        {
          OR: [
            { createdAt: { lt: c.createdAt } },
            { createdAt: c.createdAt, id: { lt: c.id } },
          ],
        },
      ],
    };
  }
  const rows = await prisma.ticket.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
  });
  const page = rows.slice(0, query.limit);
  return { page, cursor: rows.length > query.limit ? page.at(-1)!.id : null };
}
router.get(
  "/servers/:id/tickets/claimable",
  asyncRoute(async (req, res) => {
    const serverId = validate(id, req.params.id),
      query = validate(pageQuery, req.query);
    const m = await serverMember(serverId, req.user.id),
      server = await prisma.server.findUniqueOrThrow({
        where: { id: serverId },
      });
    if (m.role !== "ADMIN" || !server.adminTicketClaimEnabled)
      throw new HttpError(
        403,
        "当前社区未允许管理员认领工单",
        "TICKET_CLAIM_DISABLED",
      );
    await assertTicketHandler(prisma, serverId, req.user.id);
    const { page, cursor } = await paginate(
      {
        serverId,
        status: "OPEN",
        assigneeId: null,
        ownerOnly: false,
        OR: [{ memberId: null }, { memberId: { not: req.user.id } }],
      },
      query,
    );
    res.json({
      tickets: page.map((t) => ({
        id: t.id,
        number: t.number,
        category: t.category,
        createdAt: t.createdAt,
      })),
      cursor,
    });
  }),
);
router.post(
  "/tickets/:id/claim",
  asyncRoute(async (req, res) => {
    const ticketId = validate(id, req.params.id),
      original = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!original)
      throw new HttpError(404, "无权访问此工单", "TICKET_FORBIDDEN");
    await consumeLimit(`ticket-claim:${req.user.id}`, 30, 60);
    const ticket = await prisma.$transaction(async (db) => {
      await lockServer(db, original.serverId);
      const m = await serverMember(original.serverId, req.user.id, db),
        s = await db.server.findUniqueOrThrow({
          where: { id: original.serverId },
        });
      if (m.role !== "ADMIN" || !s.adminTicketClaimEnabled)
        throw new HttpError(
          403,
          "当前社区未允许管理员认领工单",
          "TICKET_CLAIM_DISABLED",
        );
      await assertTicketHandler(db, s.id, req.user.id);
      const t = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
      if (t.ownerOnly)
        throw new HttpError(404, "无权访问此工单", "TICKET_FORBIDDEN");
      if (t.status !== "OPEN" || t.assigneeId || t.memberId === req.user.id)
        throw new HttpError(
          409,
          "工单已被认领或状态已改变，请刷新队列",
          "TICKET_CLAIM_CONFLICT",
        );
      const saved = await db.ticket.update({
        where: { id: ticketId },
        data: { assigneeId: req.user.id, status: "IN_PROGRESS" },
      });
      await syncTicketReaders(db, s.id);
      await db.adminAction.create({
        data: {
          actorId: req.user.id,
          action: "TICKET_CLAIM",
          targetId: ticketId,
          reason: "",
          metadata: { serverId: s.id },
        },
      });
      return saved;
    });
    await notifyTicket(ticket.id);
    res.json(await info(ticket, req.user.id));
  }),
);
router.get(
  "/servers/:id/tickets",
  asyncRoute(async (req, res) => {
    const serverId = validate(id, req.params.id);
    await serverMember(serverId, req.user.id);
    const query = validate(
      pageQuery.extend({
        assigned: z.enum(["0", "1"]).optional(),
        status: status.optional(),
        q: z.string().trim().max(100).optional(),
      }),
      req.query,
    );
    const server = await prisma.server.findUniqueOrThrow({
      where: { id: serverId },
    });
    const where: Prisma.TicketWhereInput = {
      serverId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.assigned === "1"
        ? { assigneeId: req.user.id }
        : server.ownerId === req.user.id
          ? {}
          : { OR: [{ memberId: req.user.id }, { assigneeId: req.user.id }] }),
      conversation: { members: { some: { userId: req.user.id } } },
    };
    if (query.q) {
      const n = /^#?\d+$/.test(query.q)
        ? Number(query.q.replace("#", ""))
        : NaN;
      const people = await prisma.user.findMany({
        where: {
          OR: [
            { displayName: { contains: query.q, mode: "insensitive" } },
            { username: { contains: query.q, mode: "insensitive" } },
          ],
        },
        select: { id: true },
        take: 100,
      });
      where.AND = [
        {
          OR: [
            { subject: { contains: query.q, mode: "insensitive" } },
            { id: { startsWith: query.q } },
            ...(Number.isSafeInteger(n) && n > 0 && n <= 2147483647
              ? [{ number: n }]
              : []),
            { memberId: { in: people.map((p) => p.id) } },
            { assigneeId: { in: people.map((p) => p.id) } },
          ],
        },
      ];
    }
    const { page, cursor } = await paginate(where, query);
    res.json({
      tickets: await Promise.all(page.map((t) => info(t, req.user.id))),
      cursor,
    });
  }),
);
router.post(
  "/servers/:id/tickets",
  asyncRoute(async (req, res) => {
    const serverId = validate(id, req.params.id),
      input = validate(
        z.strictObject({
          clientId: z.string().min(8).max(100),
          memberId: id.optional(),
          ownerOnly: z.boolean().default(true),
          assigneeId: id.optional(),
          subject: z.string().trim().min(1).max(120),
          category: z.string().trim().min(1).max(40),
          content: z.string().trim().min(1).max(4000),
          attachmentIds: z.array(id).max(5).default([]),
        }),
        req.body,
      );
    await serverMember(serverId, req.user.id);
    await consumeLimit(`ticket-create:${req.user.id}`, 15, 3600);
    const ticket = await prisma.$transaction(async (db) => {
      await lockServer(db, serverId);
      await serverMember(serverId, req.user.id, db);
      const server = await db.server.findUniqueOrThrow({
          where: { id: serverId },
        }),
        memberId = input.memberId ?? req.user.id;
      if (input.memberId && server.ownerId !== req.user.id)
        throw new HttpError(
          403,
          "只有社区主能主动发起私密工单",
          "TICKET_OWNER_REQUIRED",
        );
      if (memberId === server.ownerId)
        throw new HttpError(
          400,
          "请选择要联系的社区成员",
          "TICKET_MEMBER_REQUIRED",
        );
      await serverMember(serverId, memberId, db);
      // A proactive ticket never assumes consent on behalf of its member.
      const ownerOnly = memberId !== req.user.id ? true : input.ownerOnly;
      if (input.assigneeId) {
        if (req.user.id !== server.ownerId)
          throw new HttpError(
            403,
            "只有社区主能指派工单",
            "TICKET_OWNER_REQUIRED",
          );
        await assertTicketHandler(db, serverId, input.assigneeId);
      }
      const old = await db.ticket.findUnique({
        where: {
          creatorId_clientId: {
            creatorId: req.user.id,
            clientId: input.clientId,
          },
        },
      });
      if (old) {
        const first = await db.message.findFirst({
          where: { conversationId: old.conversationId },
          orderBy: { createdAt: "asc" },
        });
        if (
          old.serverId !== serverId ||
          old.memberId !== memberId ||
          old.subject !== input.subject ||
          old.category !== input.category ||
          old.ownerOnly !== ownerOnly ||
          first?.content !== input.content
        )
          throw new HttpError(409, "工单标识已用于其他内容", "TICKET_CONFLICT");
        return old;
      }
      if (!server.privateTicketsEnabled)
        throw new HttpError(
          403,
          "私密工单已关闭，不能新建",
          "TICKETS_DISABLED",
        );
      const c = await db.conversation.create({
        data: {
          type: "TICKET",
          name: input.subject,
          members: {
            create: [...new Set([memberId, server.ownerId])].map((userId) => ({
              userId,
              role: userId === server.ownerId ? "OWNER" : "MEMBER",
            })),
          },
        },
      });
      const t = await db.ticket.create({
        data: {
          serverId,
          conversationId: c.id,
          memberId,
          creatorId: req.user.id,
          clientId: input.clientId,
          subject: input.subject,
          category: input.category,
          ownerOnly,
          ...(input.assigneeId
            ? {
                handoffAssigneeId: input.assigneeId,
                handoffRequestedAt: new Date(),
              }
            : {}),
        },
      });
      const m = await db.message.create({
        data: {
          conversationId: c.id,
          senderId: req.user.id,
          content: input.content,
          clientId: `ticket:${t.id}`,
        },
      });
      const attachments = [...new Set(input.attachmentIds)];
      if (attachments.length) {
        const changed = await db.messageAttachment.updateMany({
          where: {
            id: { in: attachments },
            ownerId: req.user.id,
            messageId: null,
          },
          data: { messageId: m.id },
        });
        if (changed.count !== attachments.length)
          throw new HttpError(400, "附件不存在、已使用或不属于你");
      }
      await db.adminAction.create({
        data: {
          actorId: req.user.id,
          action: "TICKET_CREATE",
          targetId: t.id,
          reason: "",
          metadata: {
            serverId,
            ownerOnly,
            requestedAssigneeId: input.assigneeId ?? null,
          },
        },
      });
      return t;
    });
    await notifyTicket(ticket.id);
    res.status(201).json(await info(ticket, req.user.id));
  }),
);
router.get(
  "/tickets/:id",
  asyncRoute(async (req, res) => {
    const t = await prisma.ticket.findUnique({
      where: { id: validate(id, req.params.id) },
    });
    if (!t) throw new HttpError(404, "工单不存在", "TICKET_NOT_FOUND");
    await ticketPermission(t.conversationId, req.user.id);
    res.json(await info(t, req.user.id));
  }),
);
router.patch(
  "/tickets/:id",
  asyncRoute(async (req, res) => {
    const ticketId = validate(id, req.params.id),
      input = validate(
        z
          .strictObject({
            status: status.optional(),
            assigneeId: id.nullable().optional(),
            requestAssigneeId: id.nullable().optional(),
            handoffConsent: z.enum(["APPROVE", "DECLINE"]).optional(),
            expectedAssigneeId: id.optional(),
          })
          .refine((v) =>
            v.handoffConsent
              ? !!v.expectedAssigneeId && Object.keys(v).length === 2
              : !v.expectedAssigneeId && Object.keys(v).length === 1,
          ),
        req.body,
      );
    const original = await prisma.ticket.findUnique({
      where: { id: ticketId },
    });
    if (!original) throw new HttpError(404, "工单不存在", "TICKET_NOT_FOUND");
    await ticketPermission(original.conversationId, req.user.id);
    const prior = (
      await prisma.conversationMember.findMany({
        where: { conversationId: original.conversationId },
        select: { userId: true },
      })
    ).map((m) => m.userId);
    const ticket = await prisma.$transaction(async (db) => {
      await lockServer(db, original.serverId);
      const t = await ticketPermission(
        original.conversationId,
        req.user.id,
        false,
        db,
      );
      if (!t) throw new HttpError(404, "工单不存在", "TICKET_NOT_FOUND");
      let saved;
      if (input.handoffConsent)
        saved = await decideTicketHandoff(
          db,
          ticketId,
          input.handoffConsent === "APPROVE",
          input.expectedAssigneeId!,
          { userId: req.user.id },
        );
      else if (
        input.assigneeId !== undefined ||
        input.requestAssigneeId !== undefined
      ) {
        if (t.server.ownerId !== req.user.id)
          throw new HttpError(
            403,
            "只有社区主能指派工单",
            "TICKET_OWNER_REQUIRED",
          );
        const target = input.assigneeId ?? input.requestAssigneeId;
        if (target) {
          await assertTicketHandler(db, t.serverId, target);
          if (target === t.memberId)
            throw new HttpError(
              400,
              "不能将工单指派给当事成员",
              "TICKET_ASSIGNEE_INVALID",
            );
        }
        if (
          input.assigneeId &&
          input.assigneeId !== t.assigneeId &&
          t.ownerOnly
        )
          throw new HttpError(
            409,
            "请先征得工单当事人同意再转交",
            "TICKET_CONSENT_REQUIRED",
          );
        saved = await db.ticket.update({
          where: { id: ticketId },
          data:
            input.assigneeId !== undefined
              ? {
                  assigneeId: input.assigneeId,
                  handoffAssigneeId: null,
                  handoffRequestedAt: null,
                  ...(t.status !== "CLOSED"
                    ? { status: input.assigneeId ? "IN_PROGRESS" : "OPEN" }
                    : {}),
                }
              : {
                  handoffAssigneeId: input.requestAssigneeId,
                  handoffRequestedAt: target ? new Date() : null,
                },
        });
      } else {
        if (
          input.status === "IN_PROGRESS" &&
          ![t.server.ownerId, t.assigneeId].includes(req.user.id)
        )
          throw new HttpError(
            403,
            "只有当前处理人能标记处理中",
            "TICKET_HANDLER_REQUIRED",
          );
        saved = await db.ticket.update({
          where: { id: ticketId },
          data: {
            status:
              input.status === "OPEN" && t.assigneeId
                ? "IN_PROGRESS"
                : input.status,
          },
        });
      }
      await syncTicketReaders(db, t.serverId);
      await db.adminAction.create({
        data: {
          actorId: req.user.id,
          action: input.handoffConsent
            ? "TICKET_HANDOFF_CONSENT"
            : input.requestAssigneeId !== undefined
              ? "TICKET_HANDOFF_REQUEST"
              : input.assigneeId !== undefined
                ? "TICKET_ASSIGN"
                : "TICKET_STATUS",
          targetId: ticketId,
          reason: "",
          metadata: { serverId: t.serverId, ...input },
        },
      });
      return saved;
    });
    await notifyTicket(ticket.id, prior);
    res.json(await info(ticket, req.user.id));
  }),
);
export default router;
