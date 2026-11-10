import { writable } from './chat.js';
import { channelPermission } from './channel-policy.js';
import { Router } from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { prisma, config, requireAuth, consumeLimit, HttpError, asyncRoute, validate } from './context.js';
import { z } from 'zod';

const router = Router(); router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 1 }, preservePath: true });
const allowed: Record<string, string[]> = { 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/gif': ['.gif'], 'image/webp': ['.webp'], 'application/pdf': ['.pdf'] };
router.post('/uploads', asyncRoute(async (req, _res, next) => { await consumeLimit(`upload:${req.user.id}`, 20, 60); const conversationId = validate(z.string().min(1).max(100).optional(), req.query.conversationId);
 if (conversationId) { await writable(conversationId, req.user.id); const access = await channelPermission(conversationId, req.user.id, true); if (access && !access.permissions.upload) throw new HttpError(403, '此频道不允许上传文件', 'CHANNEL_UPLOAD_FORBIDDEN'); }
 else if (await prisma.groupMute.findFirst({ where: { userId: req.user.id, OR: [{ permanent: true }, { until: { gt: new Date() } }] } })) throw new HttpError(403, '禁言期间上传需要指定可写会话', 'GROUP_MUTED');
 next(); }), upload.single('file'), asyncRoute(async (req, res) => {
  const file = req.file;
  if (!file || !file.buffer.length) throw new HttpError(400, '请选择文件');
  // Multipart's legacy Latin-1 parameter decoding can otherwise corrupt UTF-8 filenames.
  const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
  const filename = (Buffer.from(decoded, 'utf8').toString('latin1') === file.originalname ? decoded : file.originalname).normalize('NFC');
  if (filename.length > 180 || /[\\/\x00-\x1f\x7f]/.test(filename) || filename.startsWith('.') || /\.(exe|html?|svg|js|mjs|php|sh|bat|cmd|com|scr|ps1)(\.|$)/i.test(filename)) throw new HttpError(400, '不安全的文件名');
  const actual = await fileTypeFromBuffer(file.buffer).catch(() => undefined);
  if (!actual || !allowed[actual.mime]?.includes(path.extname(filename).toLowerCase())) throw new HttpError(400, '文件内容与扩展名不符，或类型不受支持');
  if (file.mimetype !== actual.mime && file.mimetype !== 'application/octet-stream') throw new HttpError(400, '文件 MIME 类型不匹配');
  const storageKey = `${randomUUID()}.${actual.ext}`;
  const directory = path.resolve(config.uploadDir);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filepath = path.join(directory, storageKey);
  await writeFile(filepath, file.buffer, { flag: 'wx', mode: 0o600 });
  try {
    const attachment = await prisma.messageAttachment.create({ data: { ownerId: req.user.id, filename, mimeType: actual.mime, size: file.size, storageKey } });
    res.status(201).json({ id: attachment.id, filename, originalName: filename, mimeType: actual.mime, size: file.size, url: `/api/uploads/${attachment.id}` });
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
  if (!/^[a-f0-9-]+\.[a-z0-9]+$/.test(attachment.storageKey)) throw new HttpError(404, '文件不存在');
  res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `${attachment.mimeType.startsWith('image/') ? 'inline' : 'attachment'}; filename="download.${path.extname(attachment.filename).slice(1)}"; filename*=UTF-8''${encodeURIComponent(attachment.filename).replace(/'/g, '%27')}`);
  res.sendFile(attachment.storageKey, { root: path.resolve(config.uploadDir), dotfiles: 'deny' }, error => { if (error && !res.headersSent) res.status(404).json({ error: '文件不存在' }); });
}));
export default router;
