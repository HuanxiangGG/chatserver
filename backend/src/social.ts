import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, requireAuth, publicUserSelect, validate, HttpError, asyncRoute, consumeLimit } from './context.js';
import { emitUsers } from './realtime.js';
const router = Router();
router.use(requireAuth);
const userIdSchema = z.string().min(1).max(100);
const param = (value: string | string[] | undefined) => validate(userIdSchema, value);
async function lockPair(tx: Prisma.TransactionClient, a: string, b: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${Prisma.join([a, b].sort())}) ORDER BY id FOR UPDATE`;
}
async function assertAvailable(tx: Prisma.TransactionClient, a: string, b: string) {
  if (await tx.blockedUser.findFirst({ where: { OR: [{ userId: a, blockedId: b }, { userId: b, blockedId: a }] } })) throw new HttpError(403, '无法与该用户互动');
}
router.get('/users', asyncRoute(async (req, res) => {
  const q = validate(z.string().trim().min(2).max(64), req.query.q);
  const users = await prisma.user.findMany({ where: { id: { not: req.user.id }, banned: false, role: { not: 'BOT' }, OR: [{ username: { contains: q.toLowerCase(), mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] }, select: publicUserSelect, take: 30, orderBy: { username: 'asc' } });
  res.json(users);
}));
router.get('/users/:id', asyncRoute(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: param(req.params.id), banned: false }, select: publicUserSelect });
  if (!user) throw new HttpError(404, '用户不存在');
  res.json(user);
}));
router.get('/friends', asyncRoute(async (req, res) => {
  const friends = await prisma.friendship.findMany({ where: { userId: req.user.id }, include: { friend: { select: publicUserSelect } }, orderBy: { createdAt: 'desc' } });
  res.json(friends.map(f => f.friend));
}));
router.get('/friend-requests', asyncRoute(async (req, res) => {
  const [incoming, outgoing] = await Promise.all([
    prisma.friendRequest.findMany({ where: { toId: req.user.id, status: 'PENDING' }, include: { from: { select: publicUserSelect } }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.friendRequest.findMany({ where: { fromId: req.user.id, status: 'PENDING' }, include: { to: { select: publicUserSelect } }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);
  res.json({ incoming, outgoing });
}));
router.post('/friend-requests', asyncRoute(async (req, res) => {
  await consumeLimit(`friend-request:${req.user.id}`, 30, 3600);
  const { userId } = validate(z.object({ userId: userIdSchema }), req.body);
  if (userId === req.user.id) throw new HttpError(400, '不能添加自己');
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.banned || target.role === 'BOT') throw new HttpError(404, '用户不存在');
  const request = await prisma.$transaction(async tx => {
    await lockPair(tx, req.user.id, userId);
    await assertAvailable(tx, req.user.id, userId);
    if (await tx.friendship.findUnique({ where: { userId_friendId: { userId: req.user.id, friendId: userId } } })) throw new HttpError(409, '已经是好友');
    return tx.friendRequest.upsert({ where: { fromId_toId: { fromId: req.user.id, toId: userId } }, create: { fromId: req.user.id, toId: userId }, update: { status: 'PENDING' } });
  });
  emitUsers([userId], 'friends:updated', {});
  res.status(201).json(request);
}));
router.post('/friend-requests/:id/respond', asyncRoute(async (req, res) => {
  const id = param(req.params.id);
  const { accept } = validate(z.object({ accept: z.boolean() }), req.body);
  const request = await prisma.friendRequest.findUnique({ where: { id } });
  if (!request || request.toId !== req.user.id) throw new HttpError(404, '申请不存在');
  if (request.status !== 'PENDING') throw new HttpError(409, '申请已处理');
  await prisma.$transaction(async tx => {
    await lockPair(tx, request.fromId, request.toId);
    await assertAvailable(tx, request.fromId, request.toId);
    const result = await tx.friendRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: accept ? 'ACCEPTED' : 'REJECTED' } });
    if (result.count !== 1) throw new HttpError(409, '申请已处理');
    if (accept) {
      await tx.friendship.createMany({ data: [{ userId: request.fromId, friendId: request.toId }, { userId: request.toId, friendId: request.fromId }], skipDuplicates: true });
      await tx.friendRequest.updateMany({ where: { fromId: request.toId, toId: request.fromId, status: 'PENDING' }, data: { status: 'ACCEPTED' } });
    }
  });
  emitUsers([request.fromId, request.toId], 'friends:updated', {});
  res.json({ ok: true });
}));
router.delete('/friends/:userId', asyncRoute(async (req, res) => {
  const userId = param(req.params.userId);
  await prisma.$transaction(async tx => {
    await lockPair(tx, req.user.id, userId);
    await tx.friendship.deleteMany({ where: { OR: [{ userId: req.user.id, friendId: userId }, { userId, friendId: req.user.id }] } });
  });
  emitUsers([userId, req.user.id], 'friends:updated', {});
  res.json({ ok: true });
}));
router.get('/blocks', asyncRoute(async (req, res) => {
  const blocks = await prisma.blockedUser.findMany({ where: { userId: req.user.id }, include: { blocked: { select: publicUserSelect } } });
  res.json(blocks.map(b => b.blocked));
}));
router.post('/blocks/:userId', asyncRoute(async (req, res) => {
  const userId = param(req.params.userId);
  if (userId === req.user.id) throw new HttpError(400, '不能屏蔽自己');
  if (!await prisma.user.findUnique({ where: { id: userId } })) throw new HttpError(404, '用户不存在');
  await prisma.$transaction(async tx => {
    await lockPair(tx, req.user.id, userId);
    await tx.blockedUser.upsert({ where: { userId_blockedId: { userId: req.user.id, blockedId: userId } }, create: { userId: req.user.id, blockedId: userId }, update: {} });
    await tx.friendship.deleteMany({ where: { OR: [{ userId: req.user.id, friendId: userId }, { userId, friendId: req.user.id }] } });
    await tx.friendRequest.updateMany({ where: { status: 'PENDING', OR: [{ fromId: req.user.id, toId: userId }, { fromId: userId, toId: req.user.id }] }, data: { status: 'REJECTED' } });
  });
  emitUsers([userId, req.user.id], 'friends:updated', {});
  res.json({ ok: true });
}));
router.delete('/blocks/:userId', asyncRoute(async (req, res) => {
  const userId = param(req.params.userId);
  await prisma.$transaction(async tx => {
    await lockPair(tx, req.user.id, userId);
    await tx.blockedUser.deleteMany({ where: { userId: req.user.id, blockedId: userId } });
  });
  res.json({ ok: true });
}));
export default router;
