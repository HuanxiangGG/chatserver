import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { z } from 'zod';
import { prisma, config, validate, requireAuth, publicUser, passwordSchema, usernameSchema, HttpError, asyncRoute, consumeLimit, hashToken } from './context.js';
import { disconnectUser, disconnectSession, emitUsers } from './realtime.js';

const router = Router();
const dummyHash = hash('HarborDummyPassword-NotAnAccount', 12);
const emailSchema = z.email().trim().toLowerCase().max(254);
const cookieOptions = { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax' as const, path: '/' };
async function newSession(userId: string, tx: Pick<typeof prisma, 'session'> = prisma) {
  const token = randomBytes(32).toString('hex');
  const session = await tx.session.create({ data: { userId, tokenHash: hashToken(token), csrfToken: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + config.sessionDays * 86400000) } });
  return { token, session };
}
router.post('/auth/register', asyncRoute(async (req, res) => {
  await consumeLimit(`register:ip:${req.ip}`, 10, 3600);
  const input = validate(z.object({ username: usernameSchema, email: emailSchema, password: passwordSchema, displayName: z.string().trim().min(1).max(64) }), req.body);
  const user = await prisma.user.create({ data: { username: input.username, email: input.email, passwordHash: await hash(input.password, 12), displayName: input.displayName } });
  const { token, session } = await newSession(user.id);
  res.cookie(config.cookieName, token, { ...cookieOptions, expires: session.expiresAt }).status(201).json({ user: publicUser(user), csrfToken: session.csrfToken });
}));
router.post('/auth/login', asyncRoute(async (req, res) => {
  await consumeLimit(`login:ip:${req.ip}`, 30, 900);
  const input = validate(z.object({ username: z.string().trim().toLowerCase().min(3).max(254), password: z.string().min(1).max(256) }), req.body);
  await consumeLimit(`login:account:${hashToken(input.username)}`, 10, 900);
  const user = await prisma.user.findFirst({ where: { OR: [{ username: input.username }, { email: input.username }] } });
  const correct = await compare(input.password, user?.passwordHash ?? await dummyHash);
  if (!user || !correct || user.banned) throw new HttpError(401, '用户名或密码错误，或账户不可用');
  const { token, session } = await prisma.$transaction(async tx => {
    // Serialize with password changes and bans so a login checked against an old
    // password cannot create a fresh session after all sessions were revoked.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: user.id } });
    if (!current || current.banned || current.passwordHash !== user.passwordHash) throw new HttpError(401, '账户状态已改变，请重新登录');
    await tx.session.deleteMany({ where: { userId: user.id, OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null } }] } });
    return newSession(user.id, tx);
  });
  res.cookie(config.cookieName, token, { ...cookieOptions, expires: session.expiresAt }).json({ user: publicUser(user), csrfToken: session.csrfToken });
}));
router.get('/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user), csrfToken: req.session.csrfToken }));
router.post('/auth/logout', requireAuth, asyncRoute(async (req, res) => {
  await prisma.session.update({ where: { id: req.session.id }, data: { revokedAt: new Date() } });
  await disconnectSession(req.session.id);
  res.clearCookie(config.cookieName, cookieOptions).json({ ok: true });
}));
router.patch('/users/me', requireAuth, asyncRoute(async (req, res) => {
  const input = validate(z.object({ displayName: z.string().trim().min(1).max(64).optional(), bio: z.string().trim().max(500).optional(), avatarUrl: z.string().regex(/^\/api\/uploads\/[a-zA-Z0-9_-]+$/).nullable().optional(), status: z.enum(['ONLINE', 'BUSY', 'OFFLINE']).optional() }), req.body);
  if (input.avatarUrl) {
    const attachment = await prisma.messageAttachment.findUnique({ where: { id: input.avatarUrl.split('/').pop()! } });
    if (!attachment || attachment.ownerId !== req.user.id || !attachment.mimeType.startsWith('image/')) throw new HttpError(400, '请选择自己上传的图片');
  }
  const user = await prisma.user.update({ where: { id: req.user.id }, data: input });
  if (input.status) {
    const ids = (await prisma.friendship.findMany({ where: { userId: user.id }, select: { friendId: true } })).map(f => f.friendId);
    emitUsers([user.id, ...ids], 'presence:updated', { userId: user.id, status: user.status, lastSeenAt: user.lastSeenAt });
  }
  res.json(publicUser(user));
}));
router.post('/auth/password', requireAuth, asyncRoute(async (req, res) => {
  await consumeLimit(`password:${req.user.id}`, 8, 900);
  const input = validate(z.object({ currentPassword: z.string().min(1).max(256), newPassword: passwordSchema }), req.body);
  if (!await compare(input.currentPassword, req.user.passwordHash)) throw new HttpError(400, '当前密码错误');
  const passwordHash = await hash(input.newPassword, 12);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${req.user.id} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: req.user.id } });
    if (!current || current.passwordHash !== req.user.passwordHash || current.banned) throw new HttpError(409, '账户状态已改变，请重新登录');
    await tx.user.update({ where: { id: req.user.id }, data: { passwordHash } });
    await tx.session.updateMany({ where: { userId: req.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.passwordReset.updateMany({ where: { userId: req.user.id, usedAt: null }, data: { usedAt: new Date() } });
  });
  await disconnectUser(req.user.id);
  res.clearCookie(config.cookieName, cookieOptions).json({ ok: true, message: '密码已更新，请重新登录' });
}));
router.post('/auth/forgot-password', asyncRoute(async (req, res) => {
  await consumeLimit(`recovery:ip:${req.ip}`, 5, 3600);
  validate(z.object({ email: emailSchema }), req.body);
  // A mail adapter is intentionally not configured. Recovery requires the trusted
  // recovery CLI after the operator verifies the user's identity out of band.
  // Never reveal account existence or return a reset token from this public route.
  res.status(202).json({ ok: true, message: '如需恢复账户，请联系管理员完成身份验证。' });
}));
router.post('/auth/reset-password', asyncRoute(async (req, res) => {
  await consumeLimit(`reset:ip:${req.ip}`, 10, 3600);
  const input = validate(z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), newPassword: passwordSchema }), req.body);
  const reset = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(input.token) } });
  if (!reset || reset.usedAt || reset.expiresAt <= new Date()) throw new HttpError(400, '重置链接无效或已过期');
  const passwordHash = await hash(input.newPassword, 12);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${reset.userId} FOR UPDATE`;
    const used = await tx.passwordReset.updateMany({ where: { id: reset.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw new HttpError(400, '重置链接无效或已过期');
    await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
    await tx.session.updateMany({ where: { userId: reset.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.passwordReset.updateMany({ where: { userId: reset.userId, usedAt: null }, data: { usedAt: new Date() } });
  });
  await disconnectUser(reset.userId);
  res.json({ ok: true, message: '密码已重置，请重新登录' });
}));
export default router;
