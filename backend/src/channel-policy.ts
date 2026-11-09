import { Prisma } from '@prisma/client';
import { prisma, HttpError } from './context.js';

type Db = Prisma.TransactionClient;
export const managers = ['OWNER', 'ADMIN'];
export const moderators = ['OWNER', 'ADMIN', 'MODERATOR'];
export async function serverMember(serverId: string, userId: string, db: Db = prisma) {
  const member = await db.serverMember.findUnique({ where: { serverId_userId: { serverId, userId } } });
  if (!member) throw new HttpError(403, '你不是此社区的成员');
  return member;
}
export async function serverPermission(serverId: string, userId: string, roles = managers, db: Db = prisma) {
  const member = await serverMember(serverId, userId, db);
  if (!roles.includes(member.role)) throw new HttpError(403, '没有执行此社区操作的权限');
  return member;
}
// This policy is shared by HTTP messages, Socket.IO typing, and private downloads.
export async function channelPermission(conversationId: string, userId: string, write = false, db: Db = prisma) {
  const channel = await db.channel.findUnique({ where: { conversationId }, include: { grants: { where: { userId } } } });
  if (!channel) return null;
  const member = await serverMember(channel.serverId, userId, db);
  if (channel.archivedAt || (channel.isPrivate && !managers.includes(member.role) && !channel.grants.length)) throw new HttpError(403, '你无权查看此频道');
  if (write && ((channel.readOnly && !moderators.includes(member.role)) || (member.mutedUntil && member.mutedUntil > new Date()))) throw new HttpError(403, '此频道只读，或你正在被禁言');
  return { channel, member };
}
export async function lockServer(db: Db, serverId: string) {
  await db.$queryRaw`SELECT id FROM "Server" WHERE id = ${serverId} FOR UPDATE`;
}
// Materialize eligible readers into the existing ConversationMember table. Keep receipt
// state for unchanged readers. Lock message rows' parent conversations before revoking
// access, using a deterministic order shared with the existing message transactions.
export async function syncChannelReaders(db: Db, serverId: string) {
  const channels = await db.channel.findMany({ where: { serverId }, include: { grants: true }, orderBy: { conversationId: 'asc' } });
  const members = await db.serverMember.findMany({ where: { serverId } });
  for (const channel of channels) {
    await db.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${channel.conversationId} FOR UPDATE`;
    const readers = channel.archivedAt ? [] : members.filter(m => !channel.isPrivate || managers.includes(m.role) || channel.grants.some(g => g.userId === m.userId));
    await db.conversationMember.deleteMany({ where: { conversationId: channel.conversationId, userId: { notIn: readers.map(m => m.userId) } } });
    for (const role of new Set(readers.map(m => m.role))) await db.conversationMember.updateMany({ where: { conversationId: channel.conversationId, userId: { in: readers.filter(m => m.role === role).map(m => m.userId) }, role: { not: role } }, data: { role } });
    await db.conversationMember.createMany({ data: readers.map(m => ({ conversationId: channel.conversationId, userId: m.userId, role: m.role })), skipDuplicates: true });
  }
}
