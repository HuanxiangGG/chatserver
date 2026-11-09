import { Router } from 'express';
import { z } from 'zod';
import { prisma, requireAuth, requireAdmin, validate, asyncRoute, HttpError, consumeLimit, publicUserSelect } from './context.js';
import { membership } from './chat.js';
const router = Router(); router.use(requireAuth);
const identifier = z.string().min(1).max(100), statuses = z.enum(['OPEN','REVIEWING','RESOLVED','REJECTED']);
router.post('/reports', asyncRoute(async (req, res) => {
 await consumeLimit(`report:${req.user.id}`, 10, 3600);
 const input = validate(z.strictObject({ targetType: z.enum(['USER','MESSAGE','IMAGE','FILE','GROUP']), targetId: identifier, reason: z.enum(['SPAM','HARASSMENT','ILLEGAL','SEXUAL','VIOLENCE','OTHER']), details: z.string().trim().min(5).max(2000) }), req.body);
 if (input.targetType === 'USER') { if (!await prisma.user.findUnique({ where: { id: input.targetId }, select: { id: true } })) throw new HttpError(404, '用户不存在'); }
 else if (input.targetType === 'GROUP') { const member = await membership(input.targetId, req.user.id); if (member.conversation.type !== 'GROUP') throw new HttpError(400, '举报对象不是群聊'); }
 else {
  let messageId = input.targetId;
  if (input.targetType !== 'MESSAGE') {
   const file = await prisma.messageAttachment.findUnique({ where: { id: input.targetId } });
   if (!file || !file.messageId || (input.targetType === 'IMAGE') !== file.mimeType.startsWith('image/')) throw new HttpError(404, '附件不存在或类型不符');
   messageId = file.messageId;
  }
  const message = await prisma.message.findFirst({ where: { id: messageId, retractedAt: null, hidden: { none: { userId: req.user.id } } } });
  if (!message) throw new HttpError(403, '无权举报此消息'); await membership(message.conversationId, req.user.id);
 }
 const row = await prisma.report.create({ data: { ...input, reporterId: req.user.id } }); res.status(201).json({ id: row.id, status: row.status });
}));
router.get('/reports/mine', asyncRoute(async (req, res) => { res.json(await prisma.report.findMany({ where: { reporterId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, targetType: true, targetId: true, reason: true, status: true, resolution: true, createdAt: true } })); }));
router.get('/admin/reports', requireAdmin, asyncRoute(async (req, res) => {
 const input = validate(z.strictObject({ status: statuses.optional(), reason: z.enum(['SPAM','HARASSMENT','ILLEGAL','SEXUAL','VIOLENCE','OTHER']).optional(), cursor: identifier.optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }), req.query);
 const where = { ...(input.status ? { status: input.status } : {}), ...(input.reason ? { reason: input.reason } : {}) };
 const rows = await prisma.report.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}), take: input.limit + 1, include: { reporter: { select: publicUserSelect }, handler: { select: publicUserSelect } } });
 res.json({ reports: rows.slice(0, input.limit), cursor: rows.length > input.limit ? rows[input.limit - 1]!.id : null });
}));
router.patch('/admin/reports/:id', requireAdmin, asyncRoute(async (req, res) => {
 const id = validate(identifier, req.params.id), input = validate(z.strictObject({ status: statuses, resolution: z.string().trim().min(3).max(500) }), req.body);
 await prisma.$transaction(async tx => {
  if (!await tx.report.findUnique({ where: { id } })) throw new HttpError(404, '举报不存在');
  await tx.report.update({ where: { id }, data: { status: input.status, resolution: input.resolution, handlerId: req.user.id } });
  await tx.adminAction.create({ data: { actorId: req.user.id, action: 'REPORT_HANDLE', targetId: id, reason: input.resolution, metadata: { status: input.status } } });
 }); res.json({ ok: true });
}));
export default router;
