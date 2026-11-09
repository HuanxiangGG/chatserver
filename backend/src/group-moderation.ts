import { Router } from 'express';
import { z } from 'zod';
import { prisma, requireAuth, validate, asyncRoute, HttpError, publicUserSelect, consumeLimit } from './context.js';
import { membership, lockConversation } from './chat.js';
import { assertNotGroupMuted } from './group-policy.js';
import { emitUsers } from './realtime.js';
import type { Prisma } from '@prisma/client';
const router = Router(); router.use(requireAuth);
const id = z.string().min(1).max(100);
async function group(conversationId: string, userId: string, manager = false, db: Prisma.TransactionClient = prisma) {
 const member = await membership(conversationId, userId, db);
 if (member.conversation.type !== 'GROUP' || (manager && !['OWNER','ADMIN'].includes(member.role))) throw new HttpError(403, '需要群成员或管理权限', 'GROUP_FORBIDDEN');
 if (manager) await assertNotGroupMuted(conversationId, userId, db);
 return member;
}
async function announce(conversationId: string) { const members = await prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } }); emitUsers(members.map(m => m.userId), 'conversation:updated', { id: conversationId }); }
router.get('/conversations/:id/announcements', asyncRoute(async (req, res) => {
 const conversationId = validate(id, req.params.id); await group(conversationId, req.user.id);
 const rows = await prisma.groupAnnouncement.findMany({ where: { conversationId, deletedAt: null }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take: 100, include: { author: { select: publicUserSelect }, reads: { where: { userId: req.user.id } } } });
 res.json(rows.map(({ reads, ...row }) => ({ ...row, unread: reads[0]?.version !== row.version })));
}));
const announcement = z.strictObject({ title: z.string().trim().min(1).max(120), content: z.string().trim().min(1).max(10000), pinned: z.boolean().default(false) });
router.post('/conversations/:id/announcements', asyncRoute(async (req, res) => {
 const conversationId = validate(id, req.params.id); await group(conversationId, req.user.id, true);
 await consumeLimit(`announcement:${req.user.id}`, 30, 60); const input = validate(announcement, req.body);
 const row = await prisma.$transaction(async tx => {
  await lockConversation(tx, conversationId); await group(conversationId, req.user.id, true, tx);
  if (await tx.groupAnnouncement.count({ where: { conversationId, deletedAt: null } }) >= 100) throw new HttpError(400, '群公告最多 100 条');
  const created = await tx.groupAnnouncement.create({ data: { conversationId, authorId: req.user.id, ...input } });
  await tx.groupAnnouncementRead.create({ data: { announcementId: created.id, userId: req.user.id, version: created.version } });
  await tx.adminAction.create({ data: { actorId: req.user.id, action: 'GROUP_ANNOUNCEMENT_CREATE', targetId: created.id, reason: '发布群公告', metadata: { conversationId, pinned: created.pinned } } }); return created;
 }); await announce(conversationId); res.status(201).json(row);
}));
router.patch('/conversations/:id/announcements/:announcementId', asyncRoute(async (req, res) => {
 const conversationId = validate(id, req.params.id), announcementId = validate(id, req.params.announcementId); await group(conversationId, req.user.id, true);
 const input = validate(announcement.extend({ version: z.number().int().positive() }), req.body);
 await prisma.$transaction(async tx => {
  await lockConversation(tx, conversationId); await group(conversationId, req.user.id, true, tx);
  const updated = await tx.groupAnnouncement.updateMany({ where: { id: announcementId, conversationId, deletedAt: null, version: input.version }, data: { title: input.title, content: input.content, pinned: input.pinned, version: { increment: 1 } } });
  if (!updated.count) throw new HttpError(409, '公告已变更或不存在，请重新加载', 'ANNOUNCEMENT_CONFLICT');
  await tx.adminAction.create({ data: { actorId: req.user.id, action: 'GROUP_ANNOUNCEMENT_UPDATE', targetId: announcementId, reason: '编辑或置顶群公告', metadata: { conversationId, pinned: input.pinned } } });
 }); await announce(conversationId); res.json({ ok: true });
}));
router.delete('/conversations/:id/announcements/:announcementId', asyncRoute(async (req, res) => {
 const conversationId = validate(id, req.params.id), announcementId = validate(id, req.params.announcementId); await group(conversationId, req.user.id, true);
 await prisma.$transaction(async tx => {
  await lockConversation(tx, conversationId); await group(conversationId, req.user.id, true, tx);
  const deleted = await tx.groupAnnouncement.updateMany({ where: { id: announcementId, conversationId, deletedAt: null }, data: { deletedAt: new Date() } });
  if (!deleted.count) throw new HttpError(404, '公告不存在');
  await tx.adminAction.create({ data: { actorId: req.user.id, action: 'GROUP_ANNOUNCEMENT_DELETE', targetId: announcementId, reason: '删除群公告', metadata: { conversationId } } });
 }); await announce(conversationId); res.json({ ok: true });
}));
router.post('/conversations/:id/announcements/:announcementId/read', asyncRoute(async (req, res) => {
 const conversationId = validate(id, req.params.id), announcementId = validate(id, req.params.announcementId); await group(conversationId, req.user.id);
 await prisma.$transaction(async tx => {
  await lockConversation(tx, conversationId); await group(conversationId, req.user.id, false, tx);
  const row = await tx.groupAnnouncement.findFirst({ where: { id: announcementId, conversationId, deletedAt: null } }); if (!row) throw new HttpError(404, '公告不存在');
  await tx.groupAnnouncementRead.upsert({ where: { announcementId_userId: { announcementId, userId: req.user.id } }, create: { announcementId, userId: req.user.id, version: row.version }, update: { version: row.version, readAt: new Date() } });
 }); res.json({ ok: true });
}));
router.get('/conversations/:id/mutes', asyncRoute(async (req, res) => {
 const conversationId = validate(id, req.params.id), member = await group(conversationId, req.user.id);
 const rows = await prisma.groupMute.findMany({ where: { conversationId, ...(['OWNER','ADMIN'].includes(member.role) ? {} : { userId: req.user.id }) }, include: { member: { select: { role: true } } } });
 res.json(rows.map(({ member: target, ...row }) => ({ ...row, active: target.role !== 'OWNER' && (row.permanent || !!row.until && row.until > new Date()) }))); 
}));
router.put('/conversations/:id/mutes/:userId', asyncRoute(async (req, res) => {
 const conversationId = validate(id, req.params.id), userId = validate(id, req.params.userId); await group(conversationId, req.user.id, true);
 const input = validate(z.strictObject({ duration: z.enum(['10m','1h','1d','forever','off']), reason: z.string().trim().min(3).max(500) }), req.body);
 await prisma.$transaction(async tx => {
  await lockConversation(tx, conversationId); const actor = await group(conversationId, req.user.id, true, tx), target = await group(conversationId, userId, false, tx);
  if (target.role === 'OWNER' || userId === req.user.id || (actor.role === 'ADMIN' && target.role !== 'MEMBER')) throw new HttpError(403, '不能禁言群主、自己或同级及更高权限成员', 'MUTE_HIERARCHY');
  const until = input.duration === 'forever' || input.duration === 'off' ? null : new Date(Date.now() + ({ '10m': 600000, '1h': 3600000, '1d': 86400000 }[input.duration]));
  if (input.duration === 'off') await tx.groupMute.deleteMany({ where: { conversationId, userId } });
  else await tx.groupMute.upsert({ where: { conversationId_userId: { conversationId, userId } }, create: { conversationId, userId, actorId: req.user.id, reason: input.reason, until, permanent: input.duration === 'forever' }, update: { actorId: req.user.id, reason: input.reason, until, permanent: input.duration === 'forever' } });
  await tx.adminAction.create({ data: { actorId: req.user.id, action: input.duration === 'off' ? 'GROUP_UNMUTE' : 'GROUP_MUTE', targetId: userId, reason: input.reason, metadata: { conversationId, duration: input.duration, until: until?.toISOString() ?? null } } });
 }); await announce(conversationId); res.json({ ok: true });
}));
export default router;
