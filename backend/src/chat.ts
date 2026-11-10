import { ticketPermission } from './ticket-policy.js';
import { queueBotEvents } from './bots.js';
import { assertNotGroupMuted } from './group-policy.js';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, requireAuth, validate, HttpError, asyncRoute, publicUserSelect, assertUnblocked, consumeLimit } from './context.js';
import { emitUsers } from './realtime.js';
import { channelPermission } from './channel-policy.js';

const router = Router();
router.use(requireAuth);
const idSchema = z.string().min(1).max(100);
const attachmentSelect = { id: true, filename: true, mimeType: true, size: true } as const;
export const messageInclude = {
  guestTicket: { select: { id: true, guestName: true } },
  sender: { select: publicUserSelect }, attachments: { select: attachmentSelect },
  replyTo: { select: { guestTicket: { select: { id: true, guestName: true } }, id: true, content: true, retractedAt: true, attachments: { select: attachmentSelect }, sender: { select: { id: true, displayName: true } } } },
  reads: { select: { userId: true, deliveredAt: true, readAt: true } },
} as const;
type FullMessage = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;
export function serializeMessage(message: FullMessage) {
  return { ...message, senderId: message.senderId ?? `guest:${message.guestTicketId}`, sender: message.sender ?? { id: `guest:${message.guestTicketId}`, displayName: message.guestTicket?.guestName ?? '', role: 'GUEST', username: '', avatarUrl: null, bio: '', status: 'OFFLINE', lastSeenAt: message.createdAt }, guestTicket: undefined, content: message.retractedAt ? '' : message.content,
    replyTo: message.replyTo ? { ...message.replyTo, sender: message.replyTo.sender ?? { id: `guest:${message.replyTo.guestTicket?.id}`, displayName: message.replyTo.guestTicket?.guestName ?? '' }, guestTicket: undefined, content: message.replyTo.retractedAt ? '' : message.replyTo.content, attachments: message.replyTo.retractedAt ? [] : message.replyTo.attachments } : null,
    attachments: message.retractedAt ? [] : message.attachments.map(a => ({ ...a, originalName: a.filename, url: `/api/uploads/${a.id}` })) };
}
export async function membership(conversationId: string, userId: string, db: Prisma.TransactionClient = prisma) {
  await channelPermission(conversationId, userId, false, db);
  const member = await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } }, include: { conversation: true } });
  if (!member) throw new HttpError(403, '你无权访问这个会话');
  return member;
}
async function memberIds(conversationId: string, db: Prisma.TransactionClient = prisma) {
  return (await db.conversationMember.findMany({ where: { conversationId }, select: { userId: true } })).map(m => m.userId);
}
export async function messageAudience(messageId: string, conversationId: string) {
  const hidden = await prisma.messageHidden.findMany({ where: { messageId }, select: { userId: true } });
  return (await memberIds(conversationId)).filter(id => !hidden.some(h => h.userId === id));
}
export async function lockConversation(db: Prisma.TransactionClient, id: string) {
  await db.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${id} FOR UPDATE`;
}
async function notifyConversation(id: string, users?: string[]) { emitUsers(users ?? await memberIds(id), 'conversation:updated', { id }); }
async function assertGroupAdmin(id: string, userId: string, ownerOnly = false, db: Prisma.TransactionClient = prisma) {
  const member = await membership(id, userId, db);
  await assertNotGroupMuted(id, userId, db);
  if (member.conversation.type !== 'GROUP' || (ownerOnly ? member.role !== 'OWNER' : !['OWNER', 'ADMIN'].includes(member.role))) throw new HttpError(403, '需要群管理权限');
  return member;
}
async function assertFriends(userId: string, userIds: string[]) {
  for (const other of userIds) {
    await assertUnblocked(userId, other);
    const friend = await prisma.friendship.findUnique({ where: { userId_friendId: { userId, friendId: other } }, include: { friend: { select: { banned: true } } } });
    if (!friend || friend.friend.banned) throw new HttpError(403, '只能邀请未封禁的好友');
  }
}
export async function writable(id: string, userId: string, db: Prisma.TransactionClient = prisma) {
  const member = await membership(id, userId, db);
  await assertNotGroupMuted(id, userId, db);
  await channelPermission(id, userId, true, db);
  if (member.conversation.type === 'DIRECT') {
    const others = (await memberIds(id, db)).filter(u => u !== userId);
    for (const other of others) {
      await assertUnblocked(userId, other);
      const target = await db.user.findUnique({ where: { id: other }, select: { banned: true } });
      if (!target || target.banned) throw new HttpError(403, '无法向此用户发送消息');
    }
  }
  return member;
}

router.get('/conversations', asyncRoute(async (req, res) => {
  const conversations = await prisma.conversation.findMany({ where: { members: { some: { userId: req.user.id } } }, orderBy: { updatedAt: 'desc' }, take: 200,
    include: { ticket: { select: { id: true, serverId: true, memberId: true, assigneeId: true, guestName: true, subject: true, status: true } }, channel: true, members: { include: { user: { select: publicUserSelect } } }, messages: { where: { hidden: { none: { userId: req.user.id } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, include: messageInclude } } });
  res.json(await Promise.all(conversations.map(async c => {
    const unreadCount = await prisma.message.count({ where: { conversationId: c.id, OR: [{ senderId: { not: req.user.id } }, { senderId: null }], reads: { none: { userId: req.user.id, readAt: { not: null } } }, hidden: { none: { userId: req.user.id } }, retractedAt: null } });
    const { messages, ...rest } = c;
    return { ...rest, lastMessage: messages[0] ? serializeMessage(messages[0]) : null, unreadCount };
  })));
}));
router.post('/conversations/direct', asyncRoute(async (req, res) => {
  const { userId } = validate(z.object({ userId: idSchema }), req.body);
  if (userId === req.user.id) throw new HttpError(400, '不能与自己创建私聊');
  await assertFriends(req.user.id, [userId]);
  const directKey = [req.user.id, userId].sort().join(':');
  const conversation = await prisma.conversation.upsert({ where: { directKey }, update: {}, create: { type: 'DIRECT', directKey, members: { create: [{ userId: req.user.id }, { userId }] } }, include: { ticket: { select: { id: true, serverId: true, memberId: true, assigneeId: true, guestName: true, subject: true, status: true } }, channel: true, members: { include: { user: { select: publicUserSelect } } } } });
  await notifyConversation(conversation.id);
  res.status(201).json(conversation);
}));
router.post('/conversations/group', asyncRoute(async (req, res) => {
  await consumeLimit(`group-create:${req.user.id}`, 20, 3600);
  const data = validate(z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).default(''), userIds: z.array(idSchema).min(1).max(99) }), req.body);
  const userIds = [...new Set(data.userIds)].filter(id => id !== req.user.id);
  if (!userIds.length) throw new HttpError(400, '请至少邀请一位好友');
  await assertFriends(req.user.id, userIds);
  const conversation = await prisma.conversation.create({ data: { type: 'GROUP', name: data.name, description: data.description, members: { create: [{ userId: req.user.id, role: 'OWNER' }, ...userIds.map(userId => ({ userId, role: 'MEMBER' }))] } }, include: { ticket: { select: { id: true, serverId: true, memberId: true, assigneeId: true, guestName: true, subject: true, status: true } }, channel: true, members: { include: { user: { select: publicUserSelect } } } } });
  await notifyConversation(conversation.id);
  res.status(201).json(conversation);
}));
router.get('/conversations/:id', asyncRoute(async (req, res) => {
  const id = validate(idSchema, req.params.id); await membership(id, req.user.id);
  const conversation = await prisma.conversation.findUnique({ where: { id }, include: { ticket: { select: { id: true, serverId: true, memberId: true, assigneeId: true, guestName: true, subject: true, status: true } }, channel: true, members: { include: { user: { select: publicUserSelect } } } } });
  const access = await channelPermission(id, req.user.id);
  const ticket = await ticketPermission(id, req.user.id);
  const channelWritable = (!access || access.permissions.send) && ticket?.status !== 'CLOSED';
  const groupMute = conversation?.type === 'GROUP' ? await prisma.groupMute.findUnique({ where: { conversationId_userId: { conversationId: id, userId: req.user.id } }, include: { member: { select: { role: true } } } }) : null;
  const muted = !!groupMute && groupMute.member.role !== 'OWNER' && (groupMute.permanent || !!groupMute.until && groupMute.until > new Date());
  const announcements = conversation?.type === 'GROUP' ? await prisma.groupAnnouncement.findMany({ where: { conversationId: id, deletedAt: null }, select: { version: true, reads: { where: { userId: req.user.id }, select: { version: true } } } }) : [];
  const unreadAnnouncements = announcements.filter(row => row.reads[0]?.version !== row.version).length;
  res.json({ ...conversation, unreadAnnouncements, canWrite: channelWritable && !muted, permissions: access?.permissions ?? null, channelRestriction: access?.restriction ?? null, mute: muted ? { permanent: groupMute!.permanent, until: groupMute!.until, reason: groupMute!.reason } : null });
}));
router.patch('/conversations/:id', asyncRoute(async (req, res) => {
  const id = validate(idSchema, req.params.id); await assertGroupAdmin(id, req.user.id);
  const data = validate(z.object({ name: z.string().trim().min(1).max(80).optional(), description: z.string().trim().max(500).optional(), avatarUrl: z.string().regex(/^\/api\/uploads\/[a-zA-Z0-9_-]+$/).nullable().optional() }), req.body);
  if (data.avatarUrl) {
    const file = await prisma.messageAttachment.findFirst({ where: { id: data.avatarUrl.split('/').pop(), ownerId: req.user.id, mimeType: { startsWith: 'image/' } } });
    if (!file) throw new HttpError(400, '请选择自己上传的图片');
  }
  const conversation = await prisma.$transaction(async tx => {
    await lockConversation(tx, id); await assertGroupAdmin(id, req.user.id, false, tx);
    return tx.conversation.update({ where: { id }, data });
  });
  await notifyConversation(id); res.json(conversation);
}));
router.delete('/conversations/:id', asyncRoute(async (req, res) => {
  const id = validate(idSchema, req.params.id); await assertGroupAdmin(id, req.user.id, true);
  const users = await prisma.$transaction(async tx => {
    await lockConversation(tx, id); await assertGroupAdmin(id, req.user.id, true, tx);
    const users = await memberIds(id, tx); await tx.conversation.delete({ where: { id } }); return users;
  });
  await notifyConversation(id, users); res.json({ ok: true });
}));
router.post('/conversations/:id/members', asyncRoute(async (req, res) => {
  const id = validate(idSchema, req.params.id); await assertGroupAdmin(id, req.user.id);
  const { userIds } = validate(z.object({ userIds: z.array(idSchema).min(1).max(99) }), req.body);
  const uniqueIds = [...new Set(userIds)].filter(u => u !== req.user.id);
  await assertFriends(req.user.id, uniqueIds);
  await prisma.$transaction(async tx => {
    // Lock the group row so simultaneous invites cannot exceed the member limit.
    await lockConversation(tx, id); await assertGroupAdmin(id, req.user.id, false, tx);
    const existing = await tx.conversationMember.findMany({ where: { conversationId: id }, select: { userId: true } });
    const additions = uniqueIds.filter(u => !existing.some(m => m.userId === u));
    if (existing.length + additions.length > 100) throw new HttpError(400, '每个群最多 100 人');
    await tx.conversationMember.createMany({ data: additions.map(userId => ({ conversationId: id, userId })), skipDuplicates: true });
  });
  await notifyConversation(id); res.json({ ok: true });
}));
router.patch('/conversations/:id/members/:userId', asyncRoute(async (req, res) => {
  const id = validate(idSchema, req.params.id), userId = validate(idSchema, req.params.userId);
  await assertGroupAdmin(id, req.user.id, true);
  const { role } = validate(z.object({ role: z.enum(['ADMIN', 'MEMBER']) }), req.body);
  await prisma.$transaction(async tx => {
    await lockConversation(tx, id); await assertGroupAdmin(id, req.user.id, true, tx);
    const member = await membership(id, userId, tx);
    if (member.role === 'OWNER') throw new HttpError(400, '请使用转让群主操作');
    await tx.conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId } }, data: { role } });
  });
  await notifyConversation(id); res.json({ ok: true });
}));
router.post('/conversations/:id/transfer', asyncRoute(async (req, res) => {
  const id = validate(idSchema, req.params.id); await assertGroupAdmin(id, req.user.id, true);
  const { userId } = validate(z.object({ userId: idSchema }), req.body);
  if (userId === req.user.id) throw new HttpError(400, '请选择其他群成员');
  await prisma.$transaction(async tx => {
    await lockConversation(tx, id); await assertGroupAdmin(id, req.user.id, true, tx); await membership(id, userId, tx);
    const target = await tx.user.findUnique({ where: { id: userId }, select: { banned: true } });
    if (!target || target.banned) throw new HttpError(400, '不能把群主转让给已封禁的用户');
    await tx.conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId: req.user.id } }, data: { role: 'ADMIN' } });
    await tx.conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId } }, data: { role: 'OWNER' } });
  });
  await notifyConversation(id); res.json({ ok: true });
}));
router.delete('/conversations/:id/members/:userId', asyncRoute(async (req, res) => {
  const id = validate(idSchema, req.params.id), userId = validate(idSchema, req.params.userId);
  const users = await prisma.$transaction(async tx => {
    await lockConversation(tx, id);
    const acting = await membership(id, req.user.id, tx), target = await membership(id, userId, tx);
    if (acting.conversation.type !== 'GROUP') throw new HttpError(400, '私聊不能移除成员');
    if (target.role === 'OWNER') throw new HttpError(400, '群主须先转让群主或解散群聊');
    if (userId !== req.user.id && (acting.role === 'MEMBER' || (acting.role === 'ADMIN' && target.role !== 'MEMBER'))) throw new HttpError(403, '没有移除该成员的权限');
    const users = await memberIds(id, tx);
    await tx.conversationMember.delete({ where: { conversationId_userId: { conversationId: id, userId } } }); return users;
  });
  await notifyConversation(id, users); res.json({ ok: true });
}));

router.get('/conversations/:id/messages', asyncRoute(async (req, res) => {
  const id = validate(idSchema, req.params.id); await membership(id, req.user.id);
  const before = validate(z.string().max(100).optional(), req.query.before);
  let boundary: { createdAt: Date; id: string } | undefined;
  if (before) {
    const message = await prisma.message.findFirst({ where: { id: before, conversationId: id }, select: { createdAt: true, id: true } });
    if (!message) throw new HttpError(400, '无效的历史消息游标');
    boundary = message;
  }
  const messages = await prisma.message.findMany({ where: { conversationId: id, hidden: { none: { userId: req.user.id } }, ...(boundary ? { OR: [{ createdAt: { lt: boundary.createdAt } }, { createdAt: boundary.createdAt, id: { lt: boundary.id } }] } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51, include: messageInclude });
  res.json({ messages: messages.slice(0, 50).reverse().map(serializeMessage), hasMore: messages.length > 50 });
}));
router.post('/conversations/:id/messages', asyncRoute(async (req, res) => {
  const id = validate(idSchema, req.params.id); await writable(id, req.user.id);
  const data = validate(z.object({ content: z.string().trim().max(4000).default(''), replyToId: idSchema.optional(), attachmentIds: z.array(idSchema).max(5).default([]), clientId: z.string().min(8).max(100) }), req.body);
  if (!data.content && !data.attachmentIds.length) throw new HttpError(400, '消息不能为空');
  const prior = await prisma.message.findUnique({ where: { senderId_clientId: { senderId: req.user.id, clientId: data.clientId } }, include: messageInclude });
  if (prior) {
    if (prior.conversationId !== id) throw new HttpError(409, '消息标识已使用');
    res.json(serializeMessage(prior)); return;
  }
  if (data.replyToId && !await prisma.message.findFirst({ where: { id: data.replyToId, conversationId: id } })) throw new HttpError(400, '回复的消息不属于当前会话');
  const attachmentIds = [...new Set(data.attachmentIds)];
  if (attachmentIds.length) { const access = await channelPermission(id, req.user.id, true); if (access && !access.permissions.upload) throw new HttpError(403, '此频道不允许上传文件', 'CHANNEL_UPLOAD_FORBIDDEN'); }
  let message: FullMessage;
  try {
    message = await prisma.$transaction(async tx => {
      await lockConversation(tx, id); await writable(id, req.user.id, tx);
      if (attachmentIds.length) { const access = await channelPermission(id, req.user.id, true, tx); if (access && !access.permissions.upload) throw new HttpError(403, '此频道不允许上传文件', 'CHANNEL_UPLOAD_FORBIDDEN'); }
      if (data.replyToId && !await tx.message.findFirst({ where: { id: data.replyToId, conversationId: id } })) throw new HttpError(400, '回复的消息不属于当前会话');
      const newMessage = await tx.message.create({ data: { conversationId: id, senderId: req.user.id, content: data.content, clientId: data.clientId, replyToId: data.replyToId } });
      if (attachmentIds.length) {
        const attached = await tx.messageAttachment.updateMany({ where: { id: { in: attachmentIds }, ownerId: req.user.id, messageId: null }, data: { messageId: newMessage.id } });
        if (attached.count !== attachmentIds.length) throw new HttpError(400, '附件不存在、已使用或不属于你');
      }
      await tx.conversation.update({ where: { id }, data: { updatedAt: new Date() } });
      const fullMessage = await tx.message.findUniqueOrThrow({ where: { id: newMessage.id }, include: messageInclude });
      await queueBotEvents(fullMessage, tx);
      return fullMessage;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const duplicate = await prisma.message.findUnique({ where: { senderId_clientId: { senderId: req.user.id, clientId: data.clientId } }, include: messageInclude });
      if (duplicate && duplicate.conversationId === id) { res.json(serializeMessage(duplicate)); return; }
    }
    throw error;
  }
  emitUsers(await memberIds(id), 'message:new', serializeMessage(message));
  await notifyConversation(id);
  res.status(201).json(serializeMessage(message));
}));
router.patch('/messages/:id', asyncRoute(async (req, res) => {
  const id = validate(idSchema, req.params.id), data = validate(z.object({ content: z.string().trim().max(4000) }), req.body);
  const message = await prisma.message.findUnique({ where: { id } });
  if (!message) throw new HttpError(404, '消息不存在');
  await writable(message.conversationId, req.user.id);
  if (message.senderId !== req.user.id || message.retractedAt) throw new HttpError(403, '不能编辑这条消息');
  const updated = await prisma.$transaction(async tx => {
    await lockConversation(tx, message.conversationId); await writable(message.conversationId, req.user.id, tx);
    const latest = await tx.message.findUnique({ where: { id } });
    if (!latest || latest.retractedAt || latest.senderId !== req.user.id) throw new HttpError(403, '不能编辑这条消息');
    if (!data.content && await tx.messageAttachment.count({ where: { messageId: id } }) === 0) throw new HttpError(400, '消息不能为空');
    return tx.message.update({ where: { id }, data: { content: data.content, editedAt: new Date() }, include: messageInclude });
  });
  emitUsers(await messageAudience(id, message.conversationId), 'message:updated', serializeMessage(updated)); res.json(serializeMessage(updated));
}));
async function retractPermission(conversationId: string, senderId: string | null, userId: string, db: Prisma.TransactionClient = prisma) {
  if (senderId === userId) { await writable(conversationId, userId, db); return; }
  await membership(conversationId, userId, db); await assertNotGroupMuted(conversationId, userId, db);
  const access = await channelPermission(conversationId, userId, false, db);
  if (!access?.permissions.manageMessages || access.channel.archivedAt || (access.member.mutedUntil && access.member.mutedUntil > new Date())) throw new HttpError(403, '只能撤回自己发送的消息');
}
router.post('/messages/:id/retract', asyncRoute(async (req, res) => {
  const id = validate(idSchema, req.params.id), message = await prisma.message.findUnique({ where: { id } });
  if (!message) throw new HttpError(404, '消息不存在');
  await retractPermission(message.conversationId, message.senderId, req.user.id);
  const updated = await prisma.$transaction(async tx => {
    await lockConversation(tx, message.conversationId); await retractPermission(message.conversationId, message.senderId, req.user.id, tx);
    return tx.message.update({ where: { id }, data: { content: '', retractedAt: new Date() }, include: messageInclude });
  });
  emitUsers(await messageAudience(id, message.conversationId), 'message:updated', serializeMessage(updated)); await notifyConversation(message.conversationId); res.json(serializeMessage(updated));
}));
router.delete('/messages/:id', asyncRoute(async (req, res) => {
  const id = validate(idSchema, req.params.id), message = await prisma.message.findUnique({ where: { id } });
  if (!message) throw new HttpError(404, '消息不存在');
  await membership(message.conversationId, req.user.id);
  await prisma.messageHidden.upsert({ where: { messageId_userId: { messageId: id, userId: req.user.id } }, update: {}, create: { messageId: id, userId: req.user.id } });
  await notifyConversation(message.conversationId, [req.user.id]); res.json({ ok: true });
}));
for (const type of ['read', 'delivered'] as const) router.post(`/conversations/:id/${type}`, asyncRoute(async (req, res) => {
  const id = validate(idSchema, req.params.id); await membership(id, req.user.id);
  const { messageId } = validate(z.object({ messageId: idSchema }), req.body);
  const target = await prisma.message.findFirst({ where: { id: messageId, conversationId: id } });
  if (!target) throw new HttpError(400, '消息不属于当前会话');
  {
    const now = new Date();
    await prisma.$transaction(async tx => {
      // Atomic max avoids regressing a receipt when two devices acknowledge out of order.
      if (type === 'read') await tx.$executeRaw`UPDATE "ConversationMember" SET "lastReadAt" = GREATEST("lastReadAt", ${target.createdAt}), "lastDeliveredAt" = GREATEST("lastDeliveredAt", ${target.createdAt}) WHERE "conversationId" = ${id} AND "userId" = ${req.user.id}`;
      else await tx.$executeRaw`UPDATE "ConversationMember" SET "lastDeliveredAt" = GREATEST("lastDeliveredAt", ${target.createdAt}) WHERE "conversationId" = ${id} AND "userId" = ${req.user.id}`;
      await tx.$executeRaw`
        INSERT INTO "MessageRead" ("messageId", "userId", "deliveredAt", "readAt")
        SELECT "id", ${req.user.id}, ${now}::timestamp, ${type === 'read' ? now : null}::timestamp
        FROM "Message" WHERE "conversationId" = ${id} AND "senderId" <> ${req.user.id}
          AND ("createdAt" < ${target.createdAt} OR ("createdAt" = ${target.createdAt} AND "id" <= ${target.id}))
          AND NOT EXISTS (SELECT 1 FROM "MessageRead" r WHERE r."messageId" = "Message"."id" AND r."userId" = ${req.user.id}
            AND ${type === 'read' ? Prisma.sql`r."readAt" IS NOT NULL` : Prisma.sql`r."deliveredAt" IS NOT NULL`})
        ON CONFLICT ("messageId", "userId") DO UPDATE
          SET "deliveredAt" = COALESCE("MessageRead"."deliveredAt", EXCLUDED."deliveredAt"),
              "readAt" = COALESCE("MessageRead"."readAt", EXCLUDED."readAt")
      `;
    });
    emitUsers(await memberIds(id), 'receipt:updated', { conversationId: id, userId: req.user.id, messageId, type });
  }
  res.json({ ok: true });
}));

export default router;
