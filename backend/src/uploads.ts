import { upload, storeUpload, sendAttachment } from './attachment-storage.js';
import { writable } from './chat.js';
import { channelPermission } from './channel-policy.js';
import { Router } from 'express';
import { unlink } from 'node:fs/promises';
import { prisma, config, requireAuth, consumeLimit, HttpError, asyncRoute, validate } from './context.js';
import { z } from 'zod';

const router = Router(); router.use(requireAuth);
router.post('/uploads', asyncRoute(async (req, _res, next) => { await consumeLimit(`upload:${req.user.id}`, 20, 60); const conversationId = validate(z.string().min(1).max(100).optional(), req.query.conversationId);
 if (conversationId) { await writable(conversationId, req.user.id); const access = await channelPermission(conversationId, req.user.id, true); if (access && !access.permissions.upload) throw new HttpError(403, '此频道不允许上传文件', 'CHANNEL_UPLOAD_FORBIDDEN'); }
 else if (await prisma.groupMute.findFirst({ where: { userId: req.user.id, OR: [{ permanent: true }, { until: { gt: new Date() } }] } })) throw new HttpError(403, '禁言期间上传需要指定可写会话', 'GROUP_MUTED');
 next(); }), upload.single('file'), asyncRoute(async (req, res) => {
  const { filepath, ...data } = await storeUpload(req.file);
  try {
    const attachment = await prisma.messageAttachment.create({ data: { ownerId: req.user.id, ...data } });
    res.status(201).json({ id: attachment.id, filename: attachment.filename, originalName: attachment.filename, mimeType: attachment.mimeType, size: attachment.size, url: `/api/uploads/${attachment.id}` });
  } catch (error) { await unlink(filepath).catch(() => undefined); throw error; }
}));
router.get('/uploads/:id', asyncRoute(async (req, res) => {
  const id = validate(z.string().min(1).max(100), req.params.id);
  const attachment = await prisma.messageAttachment.findUnique({ where: { id }, include: { message: { include: { conversation: { select: { members: { where: { userId: req.user.id }, select: { userId: true } } } } } } } });
  if (!attachment) throw new HttpError(404, '文件不存在');
  const avatarPath = `/api/uploads/${id}`;
  const isAvatar = attachment.mimeType.startsWith('image/') && (await prisma.user.count({ where: { avatarUrl: avatarPath } }) > 0 || await prisma.server.count({ where: { iconUrl: avatarPath, members: { some: { userId: req.user.id } } } }) > 0 || await prisma.conversation.count({ where: { avatarUrl: avatarPath, members: { some: { userId: req.user.id } } } }) > 0);
  const permitted = attachment.ownerId === req.user.id || isAvatar || (attachment.message && !attachment.message.retractedAt && attachment.message.conversation.members.length > 0);
  if (attachment.message) await channelPermission(attachment.message.conversationId, req.user.id);
  if (!permitted) throw new HttpError(403, '无权读取这个文件');
  sendAttachment(res, attachment);
}));
export default router;
