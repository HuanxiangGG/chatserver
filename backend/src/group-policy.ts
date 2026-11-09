import { Prisma } from '@prisma/client';
import { prisma, HttpError } from './context.js';
export async function assertNotGroupMuted(conversationId: string, userId: string, db: Prisma.TransactionClient = prisma) {
 const mute = await db.groupMute.findUnique({ where: { conversationId_userId: { conversationId, userId } }, include: { member: { select: { role: true } } } });
 if (mute?.member.role === 'OWNER') return;
 if (mute && (mute.permanent || (mute.until && mute.until > new Date()))) throw new HttpError(403, '你正在此群中被禁言', 'GROUP_MUTED');
}
