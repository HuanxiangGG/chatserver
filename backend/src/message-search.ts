import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma, requireAuth, validate, asyncRoute, HttpError, consumeLimit } from './context.js';
import { membership, messageInclude, serializeMessage } from './chat.js';

const router = Router(); router.use(requireAuth);
const id = z.string().min(1).max(100);
const search = z.strictObject({
  q: z.string().trim().min(1).max(100).optional(), sender: id.optional(),
  from: z.iso.datetime().optional(), to: z.iso.datetime().optional(),
  type: z.enum(['text', 'image', 'file']).optional(), cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).refine(v => !v.from || !v.to || v.from <= v.to);
const before = (m: { createdAt: Date; id: string }): Prisma.MessageWhereInput => ({ OR: [{ createdAt: { lt: m.createdAt } }, { createdAt: m.createdAt, id: { lt: m.id } }] });

router.get('/conversations/:id/search', asyncRoute(async (req, res) => {
  const conversationId = validate(id, req.params.id); await membership(conversationId, req.user.id);
  await consumeLimit(`message-search:${req.user.id}`, 60, 60);
  const input = validate(search, req.query);
  const where: Prisma.MessageWhereInput = {
    conversationId, retractedAt: null, hidden: { none: { userId: req.user.id } },
    ...(input.q ? { content: { contains: input.q.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' } } : {}),
    ...(input.sender ? { senderId: input.sender } : {}),
    ...((input.from || input.to) ? { createdAt: { ...(input.from ? { gte: new Date(input.from) } : {}), ...(input.to ? { lte: new Date(input.to) } : {}) } } : {}),
    ...(input.type === 'text' ? { content: { not: '', ...(input.q ? { contains: input.q.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' as const } : {}) }, attachments: { none: {} } } : {}),
    ...(input.type === 'image' ? { attachments: { some: { mimeType: { startsWith: 'image/' } } } } : {}),
    ...(input.type === 'file' ? { attachments: { some: { mimeType: { not: { startsWith: 'image/' } } } } } : {}),
  };
  if (input.cursor) {
    const cursor = await prisma.message.findFirst({ where: { AND: [where, { id: input.cursor }] }, select: { createdAt: true, id: true } });
    if (!cursor) throw new HttpError(400, '无效的搜索游标', 'SEARCH_CURSOR_INVALID');
    where.AND = [before(cursor)];
  }
  const rows = await prisma.message.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: input.limit + 1, include: messageInclude });
  const page = rows.slice(0, input.limit);
  res.json({ messages: page.map(serializeMessage), cursor: rows.length > input.limit ? page.at(-1)!.id : null });
}));

router.get('/conversations/:id/messages/:messageId/context', asyncRoute(async (req, res) => {
  const conversationId = validate(id, req.params.id), messageId = validate(id, req.params.messageId);
  await membership(conversationId, req.user.id);
  const visible = { conversationId, hidden: { none: { userId: req.user.id } } };
  const target = await prisma.message.findFirst({ where: { ...visible, id: messageId }, include: messageInclude });
  if (!target) throw new HttpError(404, '原消息不存在或无权访问', 'MESSAGE_UNAVAILABLE');
  const [older, newer] = await Promise.all([
    prisma.message.findMany({ where: { ...visible, ...before(target) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 26, include: messageInclude }),
    prisma.message.findMany({ where: { ...visible, OR: [{ createdAt: { gt: target.createdAt } }, { createdAt: target.createdAt, id: { gt: target.id } }] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 25, include: messageInclude }),
  ]);
  res.json({ messages: [...older.slice(0, 25).reverse(), target, ...newer].map(serializeMessage), hasMore: older.length > 25, hasNewer: newer.length === 25 });
}));
export default router;
