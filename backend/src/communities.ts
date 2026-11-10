import { Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma, requireAuth, validate, HttpError, asyncRoute, publicUserSelect, consumeLimit } from './context.js';
import { managers, moderators, serverMember, serverPermission, lockServer, syncChannelReaders, channelPermissions, channelPermission, effectiveServerPermissions, serverCapability, capabilities } from './channel-policy.js';
import { emitUsers } from './realtime.js';
import { syncTicketReaders } from './ticket-policy.js';
import { welcomeJoined } from './bots.js';
import { Prisma } from '@prisma/client';
const router = Router();
const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(80);
const description = z.string().trim().max(500);
const position = z.number().int().min(0).max(10000);
const permissionSchema = z.object(Object.fromEntries(capabilities.map(key => [key, z.boolean().optional()])) as Record<typeof capabilities[number], z.ZodOptional<z.ZodBoolean>>).strict();
const roleOverrideSchema = z.array(z.object({ roleId: id, permissions: permissionSchema })).max(50);
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const tokenSelect = { id: true, serverId: true, expiresAt: true, maxUses: true, uses: true, revokedAt: true, createdAt: true } as const;
async function audit(db: Prisma.TransactionClient, actorId: string, action: string, targetId: string, reason = '') {
  await db.adminAction.create({ data: { actorId, action: `SERVER_${action}`, targetId, reason } });
}
async function notify(serverId: string, extra: string[] = []) {
  const members = await prisma.serverMember.findMany({ where: { serverId }, select: { userId: true } });
  emitUsers([...members.map(m => m.userId), ...extra], 'server:updated', { serverId });
}
// Only a name/description/member count is public; private channel metadata is never here.
router.get('/invites/:token', asyncRoute(async (req, res) => {
  const token = validate(tokenSchema, req.params.token);
  const invite = await prisma.serverInvite.findUnique({ where: { tokenHash: hash(token) }, include: { server: { select: { id: true, name: true, description: true, _count: { select: { members: true } } } } } });
  if (!invite || invite.revokedAt || invite.expiresAt <= new Date() || invite.uses >= invite.maxUses) throw new HttpError(404, '邀请不存在、已过期或次数已用尽');
  res.json(invite.server);
}));
router.use(requireAuth);
router.get('/servers', asyncRoute(async (req, res) => {
  const servers = await prisma.server.findMany({ where: { members: { some: { userId: req.user.id } } }, include: { members: { where: { userId: req.user.id }, select: { role: true } }, _count: { select: { members: true } } }, orderBy: { createdAt: 'asc' } });
  res.json(servers.map(({ members, ...s }) => ({ ...s, role: members[0]!.role })));
}));
router.post('/servers', asyncRoute(async (req, res) => {
  await consumeLimit(`server-create:${req.user.id}`, 10, 3600);
  const data = validate(z.object({ name, description: description.default('') }), req.body);
  const server = await prisma.$transaction(async db => {
    if (await db.serverMember.count({ where: { userId: req.user.id } }) >= 50) throw new HttpError(400, '最多加入 50 个社区');
    const s = await db.server.create({ data: { ...data, ownerId: req.user.id, members: { create: { userId: req.user.id, role: 'OWNER' } } } });
    await db.channel.create({ data: { server: { connect: { id: s.id } }, conversation: { create: { type: 'CHANNEL', name: 'general', description: '', members: { create: { userId: req.user.id, role: 'OWNER' } } } } } });
    await audit(db, req.user.id, 'CREATE', s.id); return s;
  });
  await notify(server.id); res.status(201).json(server);
}));
async function serverDetail(serverId: string, userId: string, preview = false) {
  const actor = await effectiveServerPermissions(serverId, userId, prisma, preview);
  const server = await prisma.server.findUniqueOrThrow({ where: { id: serverId }, include: {
    members: { include: { user: { select: publicUserSelect } }, orderBy: { joinedAt: 'asc' } },
    roles: { include: { members: { select: { userId: true } } }, orderBy: [{ position: 'asc' }, { id: 'asc' }] },
    categories: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
    channels: { include: { conversation: { select: { name: true, description: true } }, grants: { select: { userId: true } }, roleOverrides: true }, orderBy: [{ position: 'asc' }, { id: 'asc' }] },
  } });
  const channels = [];
  for (const channel of server.channels) { const { permissions } = await channelPermissions(channel, userId, prisma, preview); if (permissions.view) channels.push({ ...channel, permissions }); }
  return { ...server, channels, role: actor.role, permissions: actor.permissions };
}
router.get('/servers/:id', asyncRoute(async (req, res) => res.json(await serverDetail(validate(id, req.params.id), req.user.id))));
router.get('/servers/:id/preview', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id); await serverPermission(serverId, req.user.id);
  res.json(await serverDetail(serverId, req.user.id, true));
}));
router.patch('/servers/:id', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), data = validate(z.object({ name: name.optional(), description: description.optional(), rules: z.string().trim().max(5000).optional(), iconUrl: z.string().regex(/^\/api\/uploads\/[a-zA-Z0-9_-]+$/).nullable().optional() }), req.body);
  await prisma.$transaction(async db => { await lockServer(db, serverId); await serverPermission(serverId, req.user.id, managers, db); if (data.iconUrl) { const attachment = await db.messageAttachment.findUnique({ where: { id: data.iconUrl.split('/').pop()! } }); if (!attachment || attachment.ownerId !== req.user.id || attachment.messageId !== null || !attachment.mimeType.startsWith('image/')) throw new HttpError(400, '输入内容格式或长度不符合要求'); } await db.server.update({ where: { id: serverId }, data }); await audit(db, req.user.id, 'UPDATE', serverId); });
  await notify(serverId); res.json({ ok: true });
}));
router.post('/servers/:id/categories', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), data = validate(z.object({ name, position: position.default(0) }), req.body);
  const category = await prisma.$transaction(async db => { await lockServer(db, serverId); await serverCapability(serverId, req.user.id, 'manageChannels', db); if (await db.channelCategory.count({ where: { serverId } }) >= 30) throw new HttpError(400, '分类数量已达上限'); const c = await db.channelCategory.create({ data: { ...data, serverId } }); await audit(db, req.user.id, 'CATEGORY_CREATE', c.id); return c; });
  await notify(serverId); res.status(201).json(category);
}));
router.patch('/servers/:id/categories/:categoryId', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), categoryId = validate(id, req.params.categoryId), data = validate(z.object({ name: name.optional(), position: position.optional() }), req.body);
  await prisma.$transaction(async db => { await lockServer(db, serverId); await serverCapability(serverId, req.user.id, 'manageChannels', db); if (!await db.channelCategory.findFirst({ where: { id: categoryId, serverId } })) throw new HttpError(404, '分类不存在'); await db.channelCategory.update({ where: { id: categoryId }, data }); await audit(db, req.user.id, 'CATEGORY_UPDATE', categoryId); });
  await notify(serverId); res.json({ ok: true });
}));
router.delete('/servers/:id/categories/:categoryId', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), categoryId = validate(id, req.params.categoryId);
  await prisma.$transaction(async db => { await lockServer(db, serverId); await serverCapability(serverId, req.user.id, 'manageChannels', db); const result = await db.channelCategory.deleteMany({ where: { id: categoryId, serverId } }); if (!result.count) throw new HttpError(404, '分类不存在'); await audit(db, req.user.id, 'CATEGORY_DELETE', categoryId); });
  await notify(serverId); res.json({ ok: true });
}));
const channelFields = z.object({ name, description, categoryId: id.nullable(), position, isPrivate: z.boolean(), readOnly: z.boolean(), userIds: z.array(id).max(200), permissionOverrides: permissionSchema.nullable(), roleOverrides: roleOverrideSchema });
const channelData = channelFields.extend({ description: description.default(''), categoryId: id.nullable().default(null), position: position.default(0), isPrivate: z.boolean().default(false), readOnly: z.boolean().default(false), userIds: z.array(id).max(200).default([]), permissionOverrides: permissionSchema.nullable().default(null), roleOverrides: roleOverrideSchema.default([]) });
async function channelReferences(db: Prisma.TransactionClient, serverId: string, categoryId?: string | null, userIds?: string[], roleOverrides?: {roleId: string}[]) {
  if (roleOverrides && await db.serverRole.count({ where: { serverId, id: { in: [...new Set(roleOverrides.map(r => r.roleId))] } } }) !== new Set(roleOverrides.map(r => r.roleId)).size) throw new HttpError(400, '身份组不属于此社区');
  if (categoryId && !await db.channelCategory.findFirst({ where: { id: categoryId, serverId } })) throw new HttpError(400, '分类不属于此社区');
  if (userIds && await db.serverMember.count({ where: { serverId, userId: { in: [...new Set(userIds)] } } }) !== new Set(userIds).size) throw new HttpError(400, '私密频道只能添加当前社区成员');
}
router.post('/servers/:id/channels', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), data = validate(channelData, req.body);
  const channel = await prisma.$transaction(async db => {
    await lockServer(db, serverId); await serverCapability(serverId, req.user.id, 'manageChannels', db);
    if (await db.channel.count({ where: { serverId, archivedAt: null } }) >= 50) throw new HttpError(400, '最多创建 50 个频道');
    await channelReferences(db, serverId, data.categoryId, data.userIds, data.roleOverrides);
    const { name, description, userIds, categoryId, roleOverrides, permissionOverrides, ...rest } = data;
    const c = await db.channel.create({ data: { ...rest, ...(permissionOverrides ? { permissionOverrides } : {}), roleOverrides: { create: roleOverrides }, server: { connect: { id: serverId } }, ...(categoryId ? { category: { connect: { id: categoryId } } } : {}), conversation: { create: { type: 'CHANNEL', name, description } }, grants: { create: [...new Set(userIds)].map(userId => ({ userId })) } } });
    await syncChannelReaders(db, serverId); await audit(db, req.user.id, 'CHANNEL_CREATE', c.id); return c;
  });
  await notify(serverId); res.status(201).json(channel);
}));
router.patch('/servers/:id/channels/:channelId', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), channelId = validate(id, req.params.channelId), data = validate(channelFields.partial(), req.body);
  await prisma.$transaction(async db => {
    await lockServer(db, serverId);
    const c = await db.channel.findFirst({ where: { id: channelId, serverId, archivedAt: null } }); if (!c) throw new HttpError(404, '频道不存在');
    const access = await channelPermission(c.conversationId, req.user.id, false, db); if (!access?.permissions.manageChannels) throw new HttpError(403, '没有执行此社区操作的权限');
    await channelReferences(db, serverId, data.categoryId, data.userIds, data.roleOverrides);
    const { name, description, userIds, roleOverrides, permissionOverrides, ...rest } = data;
    await db.channel.update({ where: { id: channelId }, data: { ...rest, ...(permissionOverrides !== undefined ? { permissionOverrides: permissionOverrides ?? Prisma.DbNull } : {}), ...(roleOverrides ? { roleOverrides: { deleteMany: {}, create: roleOverrides } } : {}), ...(userIds ? { grants: { deleteMany: {}, create: [...new Set(userIds)].map(userId => ({ userId })) } } : {}) } });
    await db.conversation.update({ where: { id: c.conversationId }, data: { name, description } });
    await syncChannelReaders(db, serverId); await audit(db, req.user.id, 'CHANNEL_UPDATE', channelId);
  });
  await notify(serverId); res.json({ ok: true });
}));
router.delete('/servers/:id/channels/:channelId', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), channelId = validate(id, req.params.channelId);
  await prisma.$transaction(async db => { await lockServer(db, serverId); const channel = await db.channel.findFirst({ where: { id: channelId, serverId, archivedAt: null } }); if (!channel) throw new HttpError(404, '频道不存在'); const access = await channelPermission(channel.conversationId, req.user.id, false, db); if (!access?.permissions.manageChannels) throw new HttpError(403, '没有执行此社区操作的权限'); const changed = await db.channel.updateMany({ where: { id: channelId, serverId, archivedAt: null }, data: { archivedAt: new Date() } }); if (!changed.count) throw new HttpError(404, '频道不存在'); await syncChannelReaders(db, serverId); await audit(db, req.user.id, 'CHANNEL_ARCHIVE', channelId); });
  await notify(serverId); res.json({ ok: true });
}));
router.post('/servers/:id/invites', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), data = validate(z.object({ hours: z.number().int().min(1).max(168).default(24), maxUses: z.number().int().min(1).max(200).default(20) }), req.body);
  await consumeLimit(`invite-create:${req.user.id}`, 30, 3600);
  const token = randomBytes(32).toString('hex');
  const invite = await prisma.$transaction(async db => { await lockServer(db, serverId); await serverPermission(serverId, req.user.id, moderators, db); const i = await db.serverInvite.create({ data: { serverId, tokenHash: hash(token), expiresAt: new Date(Date.now() + data.hours * 3600000), maxUses: data.maxUses }, select: tokenSelect }); await audit(db, req.user.id, 'INVITE_CREATE', i.id); return i; });
  res.status(201).json({ ...invite, token });
}));
router.get('/servers/:id/invites', asyncRoute(async (req, res) => { const serverId = validate(id, req.params.id); await serverPermission(serverId, req.user.id, moderators); res.json(await prisma.serverInvite.findMany({ where: { serverId }, select: tokenSelect, orderBy: { createdAt: 'desc' }, take: 100 })); }));
router.delete('/servers/:id/invites/:inviteId', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), inviteId = validate(id, req.params.inviteId);
  await prisma.$transaction(async db => { await lockServer(db, serverId); await serverPermission(serverId, req.user.id, moderators, db); const result = await db.serverInvite.updateMany({ where: { id: inviteId, serverId }, data: { revokedAt: new Date() } }); if (!result.count) throw new HttpError(404, '邀请不存在'); await audit(db, req.user.id, 'INVITE_REVOKE', inviteId); });
  res.json({ ok: true });
}));
router.post('/invites/:token/join', asyncRoute(async (req, res) => {
  await consumeLimit(`invite-join:${req.user.id}`, 30, 3600);
  const token = validate(tokenSchema, req.params.token);
  const invite = await prisma.serverInvite.findUnique({ where: { tokenHash: hash(token) } }); if (!invite) throw new HttpError(404, '邀请不存在');
  await prisma.$transaction(async db => {
    await lockServer(db, invite.serverId);
    const current = await db.serverInvite.findUniqueOrThrow({ where: { id: invite.id } });
    if (current.revokedAt || current.expiresAt <= new Date() || current.uses >= current.maxUses) throw new HttpError(400, '邀请已过期、撤销或次数已用尽');
    if (await db.serverBan.findUnique({ where: { serverId_userId: { serverId: invite.serverId, userId: req.user.id } } })) throw new HttpError(403, '你已被此社区封禁');
    if (await db.serverMember.findUnique({ where: { serverId_userId: { serverId: invite.serverId, userId: req.user.id } } })) return;
    if (await db.serverMember.count({ where: { serverId: invite.serverId } }) >= 200 || await db.serverMember.count({ where: { userId: req.user.id } }) >= 50) throw new HttpError(400, '社区成员或已加入社区数量达到上限');
    await db.serverMember.create({ data: { serverId: invite.serverId, userId: req.user.id } });
    await db.serverInvite.update({ where: { id: current.id }, data: { uses: { increment: 1 } } });
    await syncChannelReaders(db, invite.serverId); await audit(db, req.user.id, 'JOIN', invite.serverId);
  });
  await welcomeJoined(invite.serverId, req.user.id);
  await notify(invite.serverId); res.json({ serverId: invite.serverId });
}));
router.patch('/servers/:id/members/:userId', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), userId = validate(id, req.params.userId), data = validate(z.object({ role: z.enum(['ADMIN', 'MODERATOR', 'MEMBER']).optional(), muteMinutes: z.number().int().min(0).max(10080).optional() }), req.body);
  await prisma.$transaction(async db => {
    await lockServer(db, serverId); const actor = await serverPermission(serverId, req.user.id, moderators, db), target = await serverMember(serverId, userId, db);
    if (actor.userId === userId || target.role === 'OWNER' || (actor.role !== 'OWNER' && (target.role !== 'MEMBER' || data.role !== undefined))) throw new HttpError(403, '不能修改自己、所有者或更高权限成员');
    await db.serverMember.update({ where: { serverId_userId: { serverId, userId } }, data: { role: data.role, ...(data.muteMinutes !== undefined ? { mutedUntil: data.muteMinutes ? new Date(Date.now() + data.muteMinutes * 60000) : null } : {}) } });
    await syncChannelReaders(db, serverId); await syncTicketReaders(db, serverId); await audit(db, req.user.id, 'MEMBER_UPDATE', userId);
  });
  await notify(serverId); res.json({ ok: true });
}));
router.delete('/servers/:id/members/:userId', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), userId = validate(id, req.params.userId), data = validate(z.object({ ban: z.boolean().default(false), reason: z.string().trim().max(500).default('') }), req.body ?? {});
  await prisma.$transaction(async db => {
    await lockServer(db, serverId); const actor = await serverMember(serverId, req.user.id, db), target = await serverMember(serverId, userId, db);
    if (target.role === 'OWNER') throw new HttpError(400, '所有者不能退出或被移除');
    if (userId !== req.user.id && (!moderators.includes(actor.role) || (actor.role !== 'OWNER' && target.role !== 'MEMBER'))) throw new HttpError(403, '没有移除此成员的权限');
    if (data.ban && (userId === req.user.id || !managers.includes(actor.role))) throw new HttpError(403, '没有封禁权限');
    if (data.ban) await db.serverBan.upsert({ where: { serverId_userId: { serverId, userId } }, create: { serverId, userId, reason: data.reason }, update: { reason: data.reason } });
    await db.serverMember.delete({ where: { serverId_userId: { serverId, userId } } });
    // Private grants must not survive leave/kick and grant access on a future rejoin.
    await db.channelGrant.deleteMany({ where: { userId, channel: { serverId } } });
    await db.serverRoleMember.deleteMany({ where: { userId, role: { serverId } } });
    await syncTicketReaders(db, serverId);
    await syncChannelReaders(db, serverId); await audit(db, req.user.id, data.ban ? 'BAN' : 'LEAVE_OR_KICK', userId, data.reason);
  });
  await notify(serverId, [userId]); res.json({ ok: true });
}));
router.delete('/servers/:id/bans/:userId', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), userId = validate(id, req.params.userId);
  await prisma.$transaction(async db => { await lockServer(db, serverId); await serverPermission(serverId, req.user.id, managers, db); await db.serverBan.deleteMany({ where: { serverId, userId } }); await audit(db, req.user.id, 'UNBAN', userId); }); res.json({ ok: true });
}));
router.post('/servers/:id/transfer', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), { userId } = validate(z.object({ userId: id }), req.body);
  await prisma.$transaction(async db => {
    await lockServer(db, serverId); const actor = await serverPermission(serverId, req.user.id, ['OWNER'], db);
    await serverMember(serverId, userId, db); if (userId === actor.userId) throw new HttpError(400, '不能转让给自己');
    await db.serverMember.update({ where: { serverId_userId: { serverId, userId: req.user.id } }, data: { role: 'ADMIN' } });
    await db.serverMember.update({ where: { serverId_userId: { serverId, userId } }, data: { role: 'OWNER' } });
    await db.server.update({ where: { id: serverId }, data: { ownerId: userId } });
    await syncChannelReaders(db, serverId); await syncTicketReaders(db, serverId); await audit(db, req.user.id, 'TRANSFER', userId);
  }); await notify(serverId); res.json({ ok: true });
}));
router.get('/servers/:id/roles', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id); await serverMember(serverId, req.user.id);
  res.json(await prisma.serverRole.findMany({ where: { serverId }, include: { members: { select: { userId: true } } }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }));
}));
router.post('/servers/:id/roles', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), data = validate(z.object({ name, position: z.number().int().min(1).max(49).default(10), permissions: permissionSchema }), req.body);
  const role = await prisma.$transaction(async db => {
    await lockServer(db, serverId); await serverPermission(serverId, req.user.id, ['OWNER'], db);
    if (await db.serverRole.count({ where: { serverId } }) >= 50) throw new HttpError(400, '身份组数量已达上限');
    const role = await db.serverRole.create({ data: { ...data, serverId } }); await audit(db, req.user.id, 'ROLE_CREATE', role.id); return role;
  }); await notify(serverId); res.status(201).json(role);
}));
router.patch('/servers/:id/roles/:roleId', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), roleId = validate(id, req.params.roleId), data = validate(z.object({ name: name.optional(), position: z.number().int().min(1).max(49).optional(), permissions: permissionSchema.optional() }), req.body);
  await prisma.$transaction(async db => {
    await lockServer(db, serverId); await serverPermission(serverId, req.user.id, ['OWNER'], db);
    if (!await db.serverRole.findFirst({ where: { id: roleId, serverId } })) throw new HttpError(404, '身份组不存在');
    await db.serverRole.update({ where: { id: roleId }, data }); await syncChannelReaders(db, serverId); await syncTicketReaders(db, serverId); await audit(db, req.user.id, 'ROLE_UPDATE', roleId);
  }); await notify(serverId); res.json({ ok: true });
}));
router.put('/servers/:id/roles/:roleId/members', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), roleId = validate(id, req.params.roleId), { userIds } = validate(z.object({ userIds: z.array(id).max(200) }), req.body);
  await prisma.$transaction(async db => {
    await lockServer(db, serverId); await serverPermission(serverId, req.user.id, ['OWNER'], db);
    if (!await db.serverRole.findFirst({ where: { id: roleId, serverId } })) throw new HttpError(404, '身份组不存在');
    await channelReferences(db, serverId, undefined, userIds);
    if (await db.serverMember.count({ where: { serverId, userId: { in: userIds }, role: { not: 'MEMBER' } } })) throw new HttpError(403, '不能修改自己、所有者或更高权限成员');
    await db.serverRoleMember.deleteMany({ where: { roleId } }); await db.serverRoleMember.createMany({ data: [...new Set(userIds)].map(userId => ({ userId, roleId })) });
    await syncChannelReaders(db, serverId); await syncTicketReaders(db, serverId); await audit(db, req.user.id, 'ROLE_MEMBERS', roleId);
  }); await notify(serverId); res.json({ ok: true });
}));
router.delete('/servers/:id/roles/:roleId', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), roleId = validate(id, req.params.roleId);
  await prisma.$transaction(async db => { await lockServer(db, serverId); await serverPermission(serverId, req.user.id, ['OWNER'], db); const changed = await db.serverRole.deleteMany({ where: { id: roleId, serverId } }); if (!changed.count) throw new HttpError(404, '身份组不存在'); await syncChannelReaders(db, serverId); await syncTicketReaders(db, serverId); await audit(db, req.user.id, 'ROLE_DELETE', roleId); });
  await notify(serverId); res.json({ ok: true });
}));
export default router;
