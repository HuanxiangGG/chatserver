import { Prisma } from '@prisma/client';
import { prisma, HttpError } from './context.js';
import { ticketPermission } from './ticket-policy.js';

type Db = Prisma.TransactionClient;
export const managers = ['OWNER', 'ADMIN'];
export const moderators = ['OWNER', 'ADMIN', 'MODERATOR'];
export const capabilities = ['view', 'send', 'upload', 'manageMessages', 'manageChannels', 'installBots', 'handleTickets'] as const;
export type Capability = typeof capabilities[number];
export type Permissions = Record<Capability, boolean>;
export const roleRank: Record<string, number> = { OWNER: 100, ADMIN: 90, MODERATOR: 50, MEMBER: 0 };
export function defaultPermissions(role: string): Permissions {
  const manage = managers.includes(role), moderate = moderators.includes(role);
  return { view: true, send: true, upload: true, manageMessages: moderate, manageChannels: manage, installBots: manage, handleTickets: moderate };
}
function cleanPermissions(value: unknown): Partial<Permissions> {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(capabilities.filter(key => typeof source[key] === 'boolean').map(key => [key, source[key]]));
}
export async function serverMember(serverId: string, userId: string, db: Db = prisma) {
  const member = await db.serverMember.findUnique({ where: { serverId_userId: { serverId, userId } } });
  if (!member) throw new HttpError(403, '你不是此社区的成员');
  return member;
}
export async function effectiveServerPermissions(serverId: string, userId: string, db: Db = prisma, preview = false) {
  const member = await serverMember(serverId, userId, db);
  const roles = preview ? [] : await db.serverRole.findMany({ where: { serverId, members: { some: { userId } } }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
  const role = preview ? 'MEMBER' : member.role, permissions = defaultPermissions(role);
  if (!managers.includes(role)) for (const r of roles) for (const [key, value] of Object.entries(cleanPermissions(r.permissions))) permissions[key as Capability] = value;
  return { ...member, role, permissions, position: Math.max(roleRank[role] ?? 0, ...roles.map(r => r.position)), roleIds: roles.map(r => r.id) };
}
export async function serverCapability(serverId: string, userId: string, capability: Capability, db: Db = prisma) {
  const member = await effectiveServerPermissions(serverId, userId, db);
  if (!member.permissions[capability]) throw new HttpError(403, '没有执行此社区操作的权限');
  return member;
}
export async function serverPermission(serverId: string, userId: string, roles = managers, db: Db = prisma) {
  const member = await serverMember(serverId, userId, db);
  if (!roles.includes(member.role)) throw new HttpError(403, '没有执行此社区操作的权限');
  return member;
}
type PolicyChannel = { serverId: string; isPrivate: boolean; readOnly: boolean; archivedAt: Date | null; permissionOverrides: unknown; grants: {userId: string}[]; roleOverrides: { roleId: string; permissions: unknown }[] };
function evaluateChannel(channel: PolicyChannel, userId: string, member: Awaited<ReturnType<typeof effectiveServerPermissions>>, preview = false) {
  const permissions = { ...member.permissions };
  if (!managers.includes(member.role)) {
    permissions.view = channel.isPrivate ? !preview && channel.grants.some(g => g.userId === userId) : permissions.view;
    if (channel.readOnly && !moderators.includes(member.role)) permissions.send = permissions.upload = false;
    Object.assign(permissions, cleanPermissions(channel.permissionOverrides));
    for (const roleId of member.roleIds) {
      const override = channel.roleOverrides.find(r => r.roleId === roleId);
      if (override) Object.assign(permissions, cleanPermissions(override.permissions));
    }
  }
  if (channel.archivedAt || (member.mutedUntil && member.mutedUntil > new Date())) permissions.send = permissions.upload = false;
  return { member, permissions };
}
export async function channelPermissions(channel: PolicyChannel, userId: string, db: Db = prisma, preview = false) {
  return evaluateChannel(channel, userId, await effectiveServerPermissions(channel.serverId, userId, db, preview), preview);
}
// Shared by HTTP messages, typing, downloads, search, and materialized Socket readers.
export async function channelPermission(conversationId: string, userId: string, write = false, db: Db = prisma) {
  await ticketPermission(conversationId, userId, write, db);
  const channel = await db.channel.findUnique({ where: { conversationId }, include: { grants: true, roleOverrides: true } });
  if (!channel) return null;
  const { member, permissions } = await channelPermissions(channel, userId, db);
  if (!permissions.view) throw new HttpError(403, '你无权查看此频道');
  if (write && !permissions.send) throw new HttpError(403, '此频道只读，或你正在被禁言');
  return { channel, member, permissions };
}
export async function lockServer(db: Db, serverId: string) {
  await db.$queryRaw`SELECT id FROM "Server" WHERE id = ${serverId} FOR UPDATE`;
}
// ConversationMember is the existing delivery/search/unread authorization boundary.
export async function syncChannelReaders(db: Db, serverId: string) {
  const channels = await db.channel.findMany({ where: { serverId }, include: { grants: true, roleOverrides: true }, orderBy: { conversationId: 'asc' } });
  const members = await db.serverMember.findMany({ where: { serverId } });
  const roles = await db.serverRole.findMany({ where: { serverId }, include: { members: true }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
  const policies = new Map(members.map(member => {
    const assigned = roles.filter(role => role.members.some(m => m.userId === member.userId)), permissions = defaultPermissions(member.role);
    if (!managers.includes(member.role)) for (const role of assigned) for (const [key, value] of Object.entries(cleanPermissions(role.permissions))) permissions[key as Capability] = value;
    return [member.userId, { ...member, permissions, position: Math.max(roleRank[member.role] ?? 0, ...assigned.map(r => r.position)), roleIds: assigned.map(r => r.id) }];
  }));
  for (const channel of channels) {
    await db.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${channel.conversationId} FOR UPDATE`;
    const readers = [];
    for (const member of members) if (evaluateChannel(channel, member.userId, policies.get(member.userId)!).permissions.view) readers.push(member);
    await db.conversationMember.deleteMany({ where: { conversationId: channel.conversationId, userId: { notIn: readers.map(m => m.userId) } } });
    for (const role of new Set(readers.map(m => m.role))) await db.conversationMember.updateMany({ where: { conversationId: channel.conversationId, userId: { in: readers.filter(m => m.role === role).map(m => m.userId) }, role: { not: role } }, data: { role } });
    await db.conversationMember.createMany({ data: readers.map(m => ({ conversationId: channel.conversationId, userId: m.userId, role: m.role })), skipDuplicates: true });
  }
}
