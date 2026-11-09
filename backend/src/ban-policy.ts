import { prisma } from './context.js';
export async function expireBan(userId: string) {
 return prisma.$transaction(async tx => {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user || !user.banned || !user.bannedUntil || user.bannedUntil > new Date()) return false;
  const updated = await tx.user.updateMany({ where: { id: userId, banned: true, bannedUntil: { lte: new Date() } }, data: { banned: false, bannedUntil: null } });
  if (!updated.count) return false;
  await tx.adminAction.create({ data: { actorId: user.banActorId || userId, action: 'USER_BAN_EXPIRED', targetId: userId, reason: '临时封禁到期', metadata: { automatic: true, until: user.bannedUntil.toISOString() } } });
  // Old sessions deliberately remain revoked after expiry.
  return true;
 });
}
export async function expireDueBans() {
 const rows = await prisma.user.findMany({ where: { banned: true, bannedUntil: { lte: new Date() } }, select: { id: true }, take: 100 });
 for (const row of rows) await expireBan(row.id);
}
