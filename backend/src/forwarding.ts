import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { randomUUID, createHash } from 'node:crypto';
import { copyFile, mkdir, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config, prisma, requireAuth, asyncRoute, validate, HttpError, consumeLimit } from './context.js';
import { lockConversation, membership, writable, messageInclude, serializeMessage } from './chat.js';
import { channelPermission } from './channel-policy.js';
import { emitUsers } from './realtime.js';
const router = Router(); router.use(requireAuth);
router.post('/conversations/:id/forward', asyncRoute(async (req, res) => {
 const target = validate(z.string().min(1).max(100), req.params.id);
 const input = validate(z.strictObject({ sourceIds: z.array(z.string().min(1).max(100)).min(1).max(20).refine(v => new Set(v).size === v.length), clientId: z.uuid(), mode: z.enum(['quote','copy']) }), req.body);
 await writable(target, req.user.id); await consumeLimit(`forward:${req.user.id}`, 20, 60);
 const payloadHash = createHash('sha256').update(JSON.stringify({ target, ...input })).digest('hex');
 const previous = await prisma.forwardBatch.findUnique({ where: { userId_clientId: { userId: req.user.id, clientId: input.clientId } } });
 async function existing(batch: { payloadHash: string; messageIds: unknown }) {
  if (batch.payloadHash !== payloadHash) throw new HttpError(409, '转发标识已用于其他内容', 'FORWARD_CONFLICT');
  const ids = batch.messageIds as string[];
  const messages = await prisma.message.findMany({ where: { id: { in: ids }, conversationId: target, hidden: { none: { userId: req.user.id } } }, include: messageInclude });
  res.json({ messages: ids.map(id => messages.find(m => m.id === id)).filter(m => !!m).map(serializeMessage) });
 }
 if (previous) { await existing(previous); return; }
 const copies: string[] = []; let callbackFailed = false, created = false;
 try {
  const batch = await prisma.$transaction(async tx => {
   try {
    // Lock source and target conversations in one deterministic order.
    const locations = await tx.message.findMany({ where: { id: { in: input.sourceIds } }, select: { conversationId: true } });
    for (const id of [...new Set([target, ...locations.map(m => m.conversationId)])].sort()) await lockConversation(tx, id);
    await writable(target, req.user.id, tx);
    const sources = await tx.message.findMany({ where: { id: { in: input.sourceIds }, retractedAt: null, hidden: { none: { userId: req.user.id } } }, include: { attachments: true, guestTicket: { select: { guestName: true } }, sender: { select: { displayName: true } } } });
    if (sources.length !== input.sourceIds.length) throw new HttpError(403, '部分原消息不可访问', 'FORWARD_SOURCE_UNAVAILABLE');
    for (const source of sources) await membership(source.conversationId, req.user.id, tx);
    if (sources.some(s => s.attachments.length)) { const access = await channelPermission(target, req.user.id, true, tx); if (access && !access.permissions.upload) throw new HttpError(403, '此频道不允许上传文件', 'CHANNEL_UPLOAD_FORBIDDEN'); }
    if (sources.reduce((total, m) => total + m.attachments.reduce((n, a) => n + a.size, 0), 0) > 50 * 1024 * 1024) throw new HttpError(400, '单次转发附件总量不能超过 50 MiB', 'FORWARD_TOO_LARGE');
    const duplicate = await tx.forwardBatch.findUnique({ where: { userId_clientId: { userId: req.user.id, clientId: input.clientId } } });
    if (duplicate) { if (duplicate.payloadHash !== payloadHash) throw new HttpError(409, '转发标识已使用', 'FORWARD_CONFLICT'); return duplicate; }
    await mkdir(config.uploadDir, { recursive: true, mode: 0o700 });
    const ids: string[] = [];
    for (const id of input.sourceIds) {
     const source = sources.find(m => m.id === id)!;
     const message = await tx.message.create({ data: { conversationId: target, senderId: req.user.id, content: source.content, clientId: `${input.clientId}:${id}`, ...(input.mode === 'quote' ? { forwardedFrom: { senderName: source.sender?.displayName ?? source.guestTicket?.guestName ?? '', sentAt: source.createdAt.toISOString() } } : {}) } });
     for (const attachment of source.attachments) {
      if (!/^[a-f0-9-]+\.[a-z0-9]+$/.test(attachment.storageKey)) throw new HttpError(400, '附件存储标识无效', 'FILE_INVALID');
      const storageKey = `${randomUUID()}${path.extname(attachment.storageKey)}`, destination = path.join(config.uploadDir, storageKey);
      await copyFile(path.join(config.uploadDir, attachment.storageKey), destination, constants.COPYFILE_EXCL); copies.push(destination);
      await tx.messageAttachment.create({ data: { ownerId: req.user.id, messageId: message.id, filename: attachment.filename, mimeType: attachment.mimeType, size: attachment.size, storageKey } });
     }
     ids.push(message.id);
    }
    await tx.conversation.update({ where: { id: target }, data: { updatedAt: new Date() } });
    const saved = await tx.forwardBatch.create({ data: { userId: req.user.id, clientId: input.clientId, payloadHash, messageIds: ids } });
    created = true; return saved;
   } catch (error) { callbackFailed = true; throw error; }
  }, { timeout: 30000 });
  if (!created) { await existing(batch); return; }
  const ids = batch.messageIds as string[], messages = await prisma.message.findMany({ where: { id: { in: ids } }, include: messageInclude });
  const users = (await prisma.conversationMember.findMany({ where: { conversationId: target }, select: { userId: true } })).map(m => m.userId);
  for (const id of ids) { const message = messages.find(m => m.id === id); if (message) emitUsers(users, 'message:new', serializeMessage(message)); }
  emitUsers(users, 'conversation:updated', { id: target });
  res.status(201).json({ messages: ids.map(id => serializeMessage(messages.find(m => m.id === id)!)) });
 } catch (error) {
  // Only callback failures prove rollback. Unknown commit outcomes retain copies
  // so an idempotent retry can recover without destroying committed attachments.
  if (callbackFailed) for (const file of copies) {
   try { await unlink(file); } catch (cleanupError) { if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') throw new HttpError(503, '转发附件清理失败，请联系管理员', 'FORWARD_CLEANUP_FAILED'); }
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
   const saved = await prisma.forwardBatch.findUnique({ where: { userId_clientId: { userId: req.user.id, clientId: input.clientId } } });
   if (saved) { await existing(saved); return; }
  }
  throw error;
 }
}));
export default router;
