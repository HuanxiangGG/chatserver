import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma, requireAuth, asyncRoute, validate, HttpError, publicUserSelect, consumeLimit } from './context.js';
import { serverMember, lockServer, serverCapability } from './channel-policy.js';
import { ticketPermission, syncTicketReaders } from './ticket-policy.js';
import { emitUsers } from './realtime.js';
import { messageInclude, serializeMessage } from './chat.js';
const router = Router(); router.use(requireAuth);
const id = z.string().min(1).max(100), status = z.enum(['OPEN','IN_PROGRESS','CLOSED']);
async function info(ticket: Prisma.TicketGetPayload<{}>, userId: string) {
  const server = await prisma.server.findUniqueOrThrow({ where: { id: ticket.serverId }, select: { ownerId: true } });
  const people = await prisma.user.findMany({ where: { id: { in: [ticket.memberId, server.ownerId, ...(ticket.assigneeId ? [ticket.assigneeId] : [])] } }, select: publicUserSelect });
  const unreadCount = await prisma.message.count({ where: { conversationId: ticket.conversationId, senderId: { not: userId }, retractedAt: null, hidden: { none: { userId } }, reads: { none: { userId, readAt: { not: null } } } } });
  return { ...ticket, member: people.find(p => p.id === ticket.memberId), owner: people.find(p => p.id === server.ownerId), assignee: people.find(p => p.id === ticket.assigneeId) ?? null, unreadCount };
}
async function notify(ticketId: string, extra: string[] = []) {
  const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  const readers = await prisma.conversationMember.findMany({ where: { conversationId: t.conversationId }, select: { userId: true } });
  emitUsers([...readers.map(m => m.userId), ...extra], 'ticket:updated', { id: t.id, serverId: t.serverId, conversationId: t.conversationId });
  emitUsers(readers.map(m => m.userId), 'conversation:updated', { id: t.conversationId });
}
router.get('/servers/:id/tickets', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id); await serverMember(serverId, req.user.id);
  const query = validate(z.object({ status: status.optional(), q: z.string().trim().max(100).optional(), cursor: id.optional(), limit: z.coerce.number().int().min(1).max(50).default(30) }), req.query);
  const server = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
  const where: Prisma.TicketWhereInput = { serverId, ...(query.status ? { status: query.status } : {}), ...(server.ownerId === req.user.id ? {} : { OR: [{ memberId: req.user.id }, { assigneeId: req.user.id }] }) };
  if (query.q) {
    const numericQuery = /^#?\d+$/.test(query.q) ? Number(query.q.replace('#', '')) : NaN;
    const numberFilter = Number.isSafeInteger(numericQuery) && numericQuery >= 1 && numericQuery <= 2147483647 ? [{ number: numericQuery }] : [];
    const people = await prisma.user.findMany({ where: { OR: [{ displayName: { contains: query.q, mode: 'insensitive' } }, { username: { contains: query.q, mode: 'insensitive' } }] }, select: { id: true }, take: 100 });
    where.AND = [{ OR: [{ subject: { contains: query.q, mode: 'insensitive' } }, { id: { startsWith: query.q } }, ...numberFilter, { memberId: { in: people.map(p => p.id) } }, { assigneeId: { in: people.map(p => p.id) } }] }];
  }
  if (query.cursor) {
    const c = await prisma.ticket.findFirst({ where: { AND: [where, { id: query.cursor }] } });
    if (!c) throw new HttpError(400, '无效的工单游标', 'TICKET_CURSOR');
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] }];
  }
  const rows = await prisma.ticket.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 });
  const page = rows.slice(0, query.limit);
  res.json({ tickets: await Promise.all(page.map(t => info(t, req.user.id))), cursor: rows.length > query.limit ? page.at(-1)!.id : null });
}));
router.post('/servers/:id/tickets', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), input = validate(z.strictObject({ clientId: z.string().min(8).max(100), memberId: id.optional(), subject: z.string().trim().min(1).max(120), category: z.string().trim().min(1).max(40), content: z.string().trim().min(1).max(4000), attachmentIds: z.array(id).max(5).default([]) }), req.body);
  await serverMember(serverId, req.user.id); await consumeLimit(`ticket-create:${req.user.id}`, 15, 3600);
  const ticket = await prisma.$transaction(async db => {
    await lockServer(db, serverId); await serverMember(serverId, req.user.id, db);
    const server = await db.server.findUniqueOrThrow({ where: { id: serverId } });
    const memberId = input.memberId ?? req.user.id;
    if (input.memberId && server.ownerId !== req.user.id) throw new HttpError(403, '只有社区主能主动发起私密工单', 'TICKET_OWNER_REQUIRED');
    if (memberId === server.ownerId) throw new HttpError(400, '请选择要联系的社区成员', 'TICKET_MEMBER_REQUIRED');
    await serverMember(serverId, memberId, db);
    const old = await db.ticket.findUnique({ where: { creatorId_clientId: { creatorId: req.user.id, clientId: input.clientId } } });
    if (old) {
      if (old.serverId !== serverId || old.memberId !== memberId || old.subject !== input.subject || old.category !== input.category) throw new HttpError(409, '工单标识已用于其他内容', 'TICKET_CONFLICT');
      const first = await db.message.findFirst({ where: { conversationId: old.conversationId }, orderBy: { createdAt: 'asc' } });
      if (first?.content !== input.content) throw new HttpError(409, '工单标识已用于其他内容', 'TICKET_CONFLICT');
      return old;
    }
    const c = await db.conversation.create({ data: { type: 'TICKET', name: input.subject, members: { create: [...new Set([memberId, server.ownerId])].map(userId => ({ userId, role: userId === server.ownerId ? 'OWNER' : 'MEMBER' })) } } });
    const t = await db.ticket.create({ data: { serverId, conversationId: c.id, memberId, creatorId: req.user.id, clientId: input.clientId, subject: input.subject, category: input.category } });
    const m = await db.message.create({ data: { conversationId: c.id, senderId: req.user.id, content: input.content, clientId: `ticket:${t.id}` } });
    const attachments = [...new Set(input.attachmentIds)];
    if (attachments.length) { const changed = await db.messageAttachment.updateMany({ where: { id: { in: attachments }, ownerId: req.user.id, messageId: null }, data: { messageId: m.id } }); if (changed.count !== attachments.length) throw new HttpError(400, '附件不存在、已使用或不属于你'); }
    await db.adminAction.create({ data: { actorId: req.user.id, action: 'TICKET_CREATE', targetId: t.id, reason: '' } });
    return t;
  });
  await notify(ticket.id); res.status(201).json(await info(ticket, req.user.id));
}));
router.get('/tickets/:id', asyncRoute(async (req, res) => {
  const t = await prisma.ticket.findUnique({ where: { id: validate(id, req.params.id) } });
  if (!t) throw new HttpError(404, '工单不存在', 'TICKET_NOT_FOUND');
  await ticketPermission(t.conversationId, req.user.id); res.json(await info(t, req.user.id));
}));
router.patch('/tickets/:id', asyncRoute(async (req, res) => {
  const ticketId = validate(id, req.params.id), input = validate(z.strictObject({ status: status.optional(), assigneeId: id.nullable().optional() }).refine(v => v.status !== undefined || v.assigneeId !== undefined), req.body);
  const original = await prisma.ticket.findUnique({ where: { id: ticketId } }); if (!original) throw new HttpError(404, '工单不存在', 'TICKET_NOT_FOUND');
  await ticketPermission(original.conversationId, req.user.id);
  const priorReaders = await prisma.conversationMember.findMany({ where: { conversationId: original.conversationId }, select: { userId: true } });
  const ticket = await prisma.$transaction(async db => {
    await lockServer(db, original.serverId); const t = await ticketPermission(original.conversationId, req.user.id, false, db); if (!t) throw new HttpError(404, '工单不存在', 'TICKET_NOT_FOUND');
    if (input.assigneeId !== undefined && t.server.ownerId !== req.user.id) throw new HttpError(403, '只有社区主能指派工单', 'TICKET_OWNER_REQUIRED');
    if (input.assigneeId) { await serverCapability(t.serverId, input.assigneeId, 'handleTickets', db); if (input.assigneeId === t.memberId) throw new HttpError(400, '不能将工单指派给当事成员', 'TICKET_ASSIGNEE_INVALID'); }
    const saved = await db.ticket.update({ where: { id: ticketId }, data: { ...input, ...(input.assigneeId && !input.status ? { status: 'IN_PROGRESS' } : {}) } });
    await syncTicketReaders(db, t.serverId);
    await db.adminAction.create({ data: { actorId: req.user.id, action: input.assigneeId !== undefined ? 'TICKET_ASSIGN' : 'TICKET_STATUS', targetId: ticketId, reason: '', metadata: { status: saved.status, assigneeId: saved.assigneeId } } });
    return saved;
  });
  await notify(ticket.id, priorReaders.map(m => m.userId)); res.json(await info(ticket, req.user.id));
}));
export default router;
