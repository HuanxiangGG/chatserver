import { expireDueBans } from './ban-policy.js';
import { Router } from 'express';
import { z } from 'zod';
import { prisma, requireAuth, requireAdmin, validate, HttpError, asyncRoute, publicUserSelect, consumeLimit } from './context.js';
import { disconnectUser, emitUsers } from './realtime.js';
import { messageInclude, serializeMessage, messageAudience, lockConversation } from './chat.js';

const router = Router(); router.use('/admin', requireAuth, requireAdmin);
router.get('/admin/stats', asyncRoute(async (_req, res) => {
  await expireDueBans();
  const [users, conversations, messages, activeSessions, bannedUsers] = await Promise.all([
    prisma.user.count(), prisma.conversation.count(), prisma.message.count({ where: { retractedAt: null } }),
    prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }), prisma.user.count({ where: { banned: true } }),
  ]);
  res.json({ users, conversations, messages, activeSessions, bannedUsers });
}));
router.get('/admin/users', asyncRoute(async (req, res) => {
  await expireDueBans();
  const q = validate(z.string().trim().max(80).default(''), req.query.q);
  const users = await prisma.user.findMany({ where: q ? { OR: [{ username: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] } : {}, orderBy: { createdAt: 'desc' }, take: 100, select: { ...publicUserSelect, banned: true, bannedUntil: true, banReason: true, createdAt: true } });
  res.json(users);
}));
router.post('/admin/users/:id/ban', asyncRoute(async (req, res) => {
  await consumeLimit(`admin:${req.user.id}`, 60, 60);
  const id = validate(z.string().min(1).max(100), req.params.id), data = validate(z.object({ banned: z.boolean(), reason: z.string().trim().min(3).max(500), until: z.iso.datetime().nullable().optional() }), req.body);
  if (data.banned && data.until && new Date(data.until) <= new Date()) throw new HttpError(400, '封禁到期时间必须在未来');
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw new HttpError(404, '用户不存在');
  if (id === req.user.id || target.role === 'ADMIN') throw new HttpError(403, '不能通过此接口封禁管理员');
  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id }, data: { banned: data.banned, bannedUntil: data.banned && data.until ? new Date(data.until) : null, banReason: data.reason, banActorId: req.user.id, ...(data.banned ? { status: 'OFFLINE', lastSeenAt: new Date() } : {}) } });
    if (data.banned) await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.adminAction.create({ data: { actorId: req.user.id, action: data.banned ? 'USER_BAN' : 'USER_UNBAN', targetId: id, reason: data.reason, metadata: { until: data.banned ? data.until ?? null : null } } });
  });
  if (data.banned) await disconnectUser(id);
  res.json({ ok: true });
}));
router.delete('/admin/messages/:id', asyncRoute(async (req, res) => {
  await consumeLimit(`admin:${req.user.id}`, 60, 60);
  const id = validate(z.string().min(1).max(100), req.params.id), { reason } = validate(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
  const message = await prisma.message.findUnique({ where: { id } });
  if (!message) throw new HttpError(404, '消息不存在');
  const updated = await prisma.$transaction(async tx => {
    await lockConversation(tx, message.conversationId);
    const removed = await tx.message.update({ where: { id }, data: { content: '', retractedAt: new Date() }, include: messageInclude });
    await tx.adminAction.create({ data: { actorId: req.user.id, action: 'MESSAGE_DELETE', targetId: id, reason, metadata: { conversationId: message.conversationId } } });
    return removed;
  });
  const users = (await prisma.conversationMember.findMany({ where: { conversationId: message.conversationId }, select: { userId: true } })).map(m => m.userId);
  emitUsers(await messageAudience(id, message.conversationId), 'message:updated', serializeMessage(updated));
  emitUsers(users, 'conversation:updated', { id: message.conversationId });
  res.json({ ok: true });
}));
router.get('/admin/actions', asyncRoute(async (_req, res) => {
  res.json(await prisma.adminAction.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { actor: { select: publicUserSelect } } }));
}));
export default router;
