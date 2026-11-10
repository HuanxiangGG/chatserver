import type { Prisma, ServerMember, ServerRole } from '@prisma/client';
import { prisma, HttpError } from './context.js';
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
export function cleanPermissions(value: unknown): Partial<Permissions> {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(capabilities.filter(key => typeof source[key] === 'boolean').map(key => [key, source[key]]));
}
export async function serverMember(serverId: string, userId: string, db: Db = prisma) {
  const member = await db.serverMember.findUnique({ where: { serverId_userId: { serverId, userId } } });
  if (!member) throw new HttpError(403, '你不是此社区的成员');
  return member;
}
// Shared pure resolver: UI eligibility, channel readers and ticket access all
// use the same ordered explicit allow/deny semantics.
export function resolveServerPermissions(member: ServerMember, assigned: Pick<ServerRole, 'id' | 'position' | 'permissions'>[], preview = false) {
  const roles = preview ? [] : [...assigned].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const role = preview ? 'MEMBER' : member.role, permissions = defaultPermissions(role);
  if (!managers.includes(role)) for (const r of roles) for (const [key, value] of Object.entries(cleanPermissions(r.permissions))) permissions[key as Capability] = value;
  return { ...member, role, permissions, position: Math.max(roleRank[role] ?? 0, ...roles.map(r => r.position)), roleIds: roles.map(r => r.id) };
}
export async function effectiveServerPermissions(serverId: string, userId: string, db: Db = prisma, preview = false) {
  const member = await serverMember(serverId, userId, db);
  const roles = preview ? [] : await db.serverRole.findMany({ where: { serverId, members: { some: { userId } } }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
  return resolveServerPermissions(member, roles, preview);
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
