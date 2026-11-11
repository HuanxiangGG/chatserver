import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
const db = process.env.TEST_DATABASE_URL, cache = process.env.TEST_REDIS_URL;
if (!db || !new URL(db).pathname.endsWith('_test') || !cache || new URL(cache).pathname !== '/9') throw Error('Dedicated _test PostgreSQL and Redis /9 required');
Object.assign(process.env, { DATABASE_URL: db, REDIS_URL: cache, NODE_ENV: 'test', APP_ORIGIN: 'https://chat.6hx9.com', COOKIE_SECURE: 'false', TRUST_PROXY: '2' });
const origin = 'https://chat.6hx9.com', prefix = `c${Date.now().toString(36)}`;
type Person = { user: { id: string }; csrfToken: string; cookie: string };
let app: any, prisma: any, redis: any, realtime: any, server: ReturnType<typeof createServer>, base: string;
let owner: Person, member: Person, outsider: Person, moderator: Person, extra: Person;
let community: string, general: string, privateChannel: any, announcement: any, inviteToken: string, attachmentId: string, messageId: string;
const sockets: Socket[] = [];
function api(person?: Person) {
  const call = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, body?: any) => {
    const r = request(app)[method](`/api${path}`).set('Origin', origin).set('Cookie', person?.cookie || '').set('X-CSRF-Token', person?.csrfToken || '');
    return body === undefined ? r : r.send(body);
  };
  return { get: (p: string) => call('get', p), post: (p: string, b: any = {}) => call('post', p, b), patch: (p: string, b: any) => call('patch', p, b), put: (p: string, b: any) => call('put', p, b), delete: (p: string, b: any = {}) => call('delete', p, b) };
}
async function register(name: string): Promise<Person> {
  const r = await api().post('/auth/register', { username: prefix + name, displayName: name, email: `${prefix}${name}@example.test`, password: 'OnlyTest-Harbor-953!' });
  expect(r.status, JSON.stringify(r.body)).toBe(201); return { ...r.body, cookie: r.headers['set-cookie'][0].split(';')[0] };
}
async function invite() {
  const r = await api(owner).post(`/servers/${community}/invites`, { hours: 24, maxUses: 20 }); expect(r.status, JSON.stringify(r.body)).toBe(201); return r.body.token;
}
async function send(p: Person, conversationId: string, content = '频道消息') { return api(p).post(`/conversations/${conversationId}/messages`, { content, clientId: randomUUID() }); }
async function connect(p: Person) {
  const socket = io(base, { transports: ['websocket'], reconnection: false, auth: { csrfToken: p.csrfToken }, extraHeaders: { Cookie: p.cookie, Origin: origin }, autoConnect: false }); sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); }); return socket;
}
beforeAll(async () => {
  ({ default: app } = await import('../src/app.js')); ({ prisma, redis } = await import('../src/context.js'));
  const keys = await redis.keys('harbor:limit:*'); if (keys.length) await redis.del(...keys);
  realtime = await import('../src/realtime.js'); server = createServer(app); await realtime.initRealtime(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${(server.address() as any).port}`;
  owner = await register('owner'); member = await register('member'); outsider = await register('outside'); moderator = await register('mod'); extra = await register('extra');
});
afterAll(async () => { sockets.forEach(s => s.disconnect()); if (realtime) await realtime.closeRealtime(); if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve())); await prisma?.$disconnect(); redis?.disconnect(); });
it('requires authenticated session, trusted Origin and CSRF for community mutations', async () => {
  expect((await api().post('/servers', { name: '无权限' })).status).toBe(401);
  expect((await request(app).post('/api/servers').set('Origin', origin).set('Cookie', owner.cookie).send({ name: '无令牌' })).status).toBe(403);
  const bad = await request(app).post('/api/servers').set('Origin', 'https://evil.example').set('Cookie', owner.cookie).set('X-CSRF-Token', owner.csrfToken).send({ name: '不可信' }); expect(bad.status).toBe(403);
});
it('creates real server, OWNER membership and a default channel backed by Conversation', async () => {
  const r = await api(owner).post('/servers', { name: '测试社区', description: '社区说明' }); expect(r.status).toBe(201); community = r.body.id;
  const detail = await api(owner).get(`/servers/${community}`); expect(detail.status).toBe(200); expect(detail.body.role).toBe('OWNER'); expect(detail.body.channels).toHaveLength(1);
  general = detail.body.channels[0].conversationId;
  expect((await prisma.conversation.findUnique({ where: { id: general } })).type).toBe('CHANNEL');
  expect((await api(outsider).get(`/servers/${community}`)).status).toBe(403);
  expect((await api(outsider).get(`/conversations/${general}/messages`)).status).toBe(403);
});
it('previews only public invitation fields and stores only token hashes', async () => {
  inviteToken = await invite(); const preview = await api().get(`/invites/${inviteToken}`); expect(preview.status).toBe(200); expect(preview.body.channels).toBeUndefined(); expect(preview.body.members).toBeUndefined();
  const row = await prisma.serverInvite.findFirst({ where: { serverId: community } }); expect(row.tokenHash).not.toBe(inviteToken);
  expect((await api(member).post(`/invites/${inviteToken}/join`)).status).toBe(200);
  expect((await api(moderator).post(`/invites/${inviteToken}/join`)).status).toBe(200);
  expect((await api(owner).get(`/servers/${community}/invites`)).body[0].tokenHash).toBeUndefined();
  expect((await api(owner).get(`/servers/${community}/invites`)).body[0].token).toBeUndefined();
});
it('rejoining is idempotent and a member cannot mint invitations or manage roles/channels', async () => {
  const count = await prisma.serverMember.count({ where: { serverId: community } }); expect((await api(member).post(`/invites/${inviteToken}/join`)).status).toBe(200); expect(await prisma.serverMember.count({ where: { serverId: community } })).toBe(count);
  expect((await api(member).post(`/servers/${community}/channels`, { name: '越权' })).status).toBe(403);
  expect((await api(member).post(`/servers/${community}/invites`)).status).toBe(403);
  expect((await api(member).patch(`/servers/${community}/members/${member.user.id}`, { role: 'ADMIN' })).status).toBe(403);
});
it('serializes concurrent invite joins so a single-use token admits only one user', async () => {
  const invite = await api(owner).post(`/servers/${community}/invites`, { hours: 1, maxUses: 1 });
  const results = await Promise.all([api(outsider).post(`/invites/${invite.body.token}/join`), api(extra).post(`/invites/${invite.body.token}/join`)]);
  expect(results.map(r => r.status).sort()).toEqual([200, 400]);
  const winner = results[0].status === 200 ? outsider : extra; expect((await api(winner).delete(`/servers/${community}/members/${winner.user.id}`)).status).toBe(200);
});
it('creates ordered categories and private channels with explicit readers; enforces isolation', async () => {
  const category = await api(owner).post(`/servers/${community}/categories`, { name: '核心讨论', position: 20 }); expect(category.status).toBe(201);
  const r = await api(owner).post(`/servers/${community}/channels`, { name: '内部讨论', categoryId: category.body.id, isPrivate: true, userIds: [member.user.id] }); expect(r.status, JSON.stringify(r.body)).toBe(201); privateChannel = r.body;
  expect((await api(member).get(`/conversations/${privateChannel.conversationId}/messages`)).status).toBe(200);
  expect((await api(moderator).get(`/conversations/${privateChannel.conversationId}`)).status).toBe(403);
  expect((await api(moderator).get(`/servers/${community}`)).body.channels.some((c: any) => c.id === privateChannel.id)).toBe(false);
  const message = await send(member, privateChannel.conversationId, '仅内部可见'); expect(message.status).toBe(201);
  expect((await api(member).get(`/conversations/${general}/messages`)).body.messages.some((m: any) => m.id === message.body.id)).toBe(false);
  // A rename must not reset omitted privacy or grants.
  expect((await api(owner).patch(`/servers/${community}/channels/${privateChannel.id}`, { name: '保密讨论' })).status).toBe(200);
  expect((await api(moderator).get(`/conversations/${privateChannel.conversationId}/messages`)).status).toBe(403);
});
it('blocks cross-server categories, grants to outsiders, and GROUP routes on CHANNEL conversations', async () => {
  const other = await api(owner).post('/servers', { name: '另一个社区' }); const category = await api(owner).post(`/servers/${other.body.id}/categories`, { name: '其他分类' });
  expect((await api(owner).post(`/servers/${community}/channels`, { name: '跨社区', categoryId: category.body.id })).status).toBe(400);
  expect((await api(owner).patch(`/servers/${community}/channels/${privateChannel.id}`, { userIds: [outsider.user.id] })).status).toBe(400);
  expect((await api(owner).patch(`/conversations/${general}`, { name: '旧接口越权' })).status).toBe(403);
  expect((await api(owner).post(`/conversations/${general}/members`, { userIds: [outsider.user.id] })).status).toBe(403);
});
it('shares read-only and mute permissions across message creation, edit and Socket.IO typing', async () => {
  const r = await api(owner).post(`/servers/${community}/channels`, { name: '公告', readOnly: true }); expect(r.status).toBe(201); announcement = r.body;
  expect((await send(member, announcement.conversationId)).status).toBe(403);
  expect((await api(owner).patch(`/servers/${community}/members/${moderator.user.id}`, { role: 'MODERATOR' })).status).toBe(200);
  expect((await send(moderator, announcement.conversationId)).status).toBe(201);
  expect((await send(owner, announcement.conversationId)).status).toBe(201);
  const socket = await connect(member); const ack: any = await socket.timeout(3000).emitWithAck('typing', { conversationId: announcement.conversationId, typing: true }); expect(ack.error).toBeTruthy(); expect(socket.connected).toBe(true);
  expect((await socket.timeout(3000).emitWithAck('typing', { conversationId: general, typing: true })).ok).toBe(true); socket.disconnect();
  const m = await send(member, general); expect(m.status).toBe(201);
  expect((await api(moderator).patch(`/servers/${community}/members/${member.user.id}`, { muteMinutes: 60 })).status).toBe(200);
  expect((await send(member, general)).status).toBe(403);
  expect((await api(member).patch(`/messages/${m.body.id}`, { content: '绕过禁言' })).status).toBe(403);
  expect((await api(owner).patch(`/servers/${community}/members/${member.user.id}`, { muteMinutes: 0 })).status).toBe(200);
});
it('delivers channel messages to eligible readers only and deduplicates retries', async () => {
  const receiver = await connect(member), outsiderSocket = await connect(outsider); const leaked: any[] = []; outsiderSocket.on('message:new', m => leaked.push(m));
  const delivered = new Promise<any>(resolve => receiver.once('message:new', resolve)); const clientId = randomUUID();
  const r = await api(owner).post(`/conversations/${privateChannel.conversationId}/messages`, { content: '私密实时事件', clientId }); expect(r.status).toBe(201); expect((await delivered).id).toBe(r.body.id);
  const retry = await api(owner).post(`/conversations/${privateChannel.conversationId}/messages`, { content: '私密实时事件', clientId }); expect(retry.body.id).toBe(r.body.id);
  // Acknowledged server round-trip is a barrier after the preceding emit.
  await outsiderSocket.timeout(3000).emitWithAck('presence:set', { status: 'ONLINE' }); expect(leaked.some(m => m.id === r.body.id)).toBe(false); receiver.disconnect(); outsiderSocket.disconnect();
});
it('revokes private history and original attachment downloads when access is removed', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKAAAAABJRU5ErkJggg==', 'base64');
  const upload = await request(app).post('/api/uploads').set('Origin', origin).set('Cookie', owner.cookie).set('X-CSRF-Token', owner.csrfToken).attach('file', png, { filename: 'private.png', contentType: 'image/png' }); expect(upload.status).toBe(201); attachmentId = upload.body.id;
  const message = await api(owner).post(`/conversations/${privateChannel.conversationId}/messages`, { content: '保密附件', attachmentIds: [attachmentId], clientId: randomUUID() }); expect(message.status).toBe(201); messageId = message.body.id;
  expect((await api(member).get(`/uploads/${attachmentId}`)).status).toBe(200);
  expect((await api(owner).patch(`/servers/${community}/channels/${privateChannel.id}`, { userIds: [] })).status).toBe(200);
  expect((await api(member).get(`/uploads/${attachmentId}`)).status).toBe(403);
  expect((await api(member).get(`/conversations/${privateChannel.conversationId}/messages`)).status).toBe(403);
  expect((await api(member).get('/conversations')).body.some((c: any) => c.id === privateChannel.conversationId)).toBe(false);
});
it('role changes recompute private readers and demotion revokes inherited access', async () => {
  expect((await api(owner).patch(`/servers/${community}/members/${moderator.user.id}`, { role: 'ADMIN' })).status).toBe(200);
  expect((await api(moderator).get(`/conversations/${privateChannel.conversationId}`)).status).toBe(200);
  expect((await api(moderator).patch(`/servers/${community}/members/${owner.user.id}`, { role: 'MEMBER' })).status).toBe(403);
  expect((await api(owner).patch(`/servers/${community}/members/${moderator.user.id}`, { role: 'MODERATOR' })).status).toBe(200);
  expect((await api(moderator).get(`/uploads/${attachmentId}`)).status).toBe(403);
});
it('kick clears private grants; rejoin cannot restore old private access; ban blocks invites', async () => {
  expect((await api(owner).patch(`/servers/${community}/channels/${privateChannel.id}`, { userIds: [member.user.id] })).status).toBe(200);
  expect((await api(owner).delete(`/servers/${community}/members/${member.user.id}`)).status).toBe(200);
  expect((await api(member).post(`/invites/${inviteToken}/join`)).status).toBe(200);
  expect((await api(member).get(`/conversations/${privateChannel.conversationId}`)).status).toBe(403);
  expect((await api(owner).delete(`/servers/${community}/members/${member.user.id}`, { ban: true, reason: '测试封禁' })).status).toBe(200);
  expect((await api(member).post(`/invites/${inviteToken}/join`)).status).toBe(403);
  expect((await api(member).get(`/conversations/${general}/messages`)).status).toBe(403);
  expect((await api(owner).delete(`/servers/${community}/bans/${member.user.id}`)).status).toBe(200);
});
it('expired and revoked invites are denied without changing memberships', async () => {
  const token = await invite(); const row = await prisma.serverInvite.findFirst({ where: { serverId: community }, orderBy: { createdAt: 'desc' } });
  expect((await api(owner).delete(`/servers/${community}/invites/${row.id}`)).status).toBe(200);
  expect((await api(member).post(`/invites/${token}/join`)).status).toBe(400);
  const expiredToken = await invite(); const expired = await prisma.serverInvite.findFirst({ where: { serverId: community }, orderBy: { createdAt: 'desc' } }); await prisma.serverInvite.update({ where: { id: expired.id }, data: { expiresAt: new Date(0) } });
  expect((await api().get(`/invites/${expiredToken}`)).status).toBe(404);
});
it('archiving a channel preserves read access and records, denies writes and audits', async () => {
  expect((await api(owner).delete(`/servers/${community}/channels/${privateChannel.id}`)).status).toBe(200);
  expect((await api(owner).get(`/conversations/${privateChannel.conversationId}/messages`)).status).toBe(200);
  expect((await send(owner, privateChannel.conversationId)).status).toBe(403);
  expect(await prisma.message.count({ where: { id: messageId } })).toBe(1); expect(await prisma.messageAttachment.count({ where: { id: attachmentId } })).toBe(1);
  expect(await prisma.adminAction.count({ where: { actorId: owner.user.id, action: 'SERVER_CHANNEL_ARCHIVE', targetId: privateChannel.id } })).toBe(1);
});

it('custom roles grant scoped channel capabilities without role escalation or cross-community references', async () => {
  await api(extra).post(`/invites/${await invite()}/join`);
  const role = await api(owner).post(`/servers/${community}/roles`, { name: '攻略作者', position: 20, permissions: { send: false, upload: false, manageMessages: true, manageChannels: true, handleTickets: true } });
  expect(role.status, JSON.stringify(role.body)).toBe(201);
  expect((await api(extra).put(`/servers/${community}/roles/${role.body.id}/members`, { userIds: [extra.user.id] })).status).toBe(403);
  expect((await api(owner).put(`/servers/${community}/roles/${role.body.id}/members`, { userIds: [owner.user.id] })).status).toBe(403);
  expect((await api(owner).put(`/servers/${community}/roles/${role.body.id}/members`, { userIds: [extra.user.id] })).status).toBe(200);
  const lower = await api(owner).post(`/servers/${community}/roles`, { name: '基础发言', position: 10, permissions: { send: true } }); expect(lower.status).toBe(201);
  expect((await api(owner).put(`/servers/${community}/roles/${lower.body.id}/members`, { userIds: [extra.user.id] })).status).toBe(200);
  expect((await send(extra, general)).status).toBe(403);
  const moderated = await send(owner, general, '待处理消息'); expect(moderated.status).toBe(201);
  expect((await api(extra).post(`/messages/${moderated.body.id}/retract`)).status).toBe(200);
  const room = await api(extra).post(`/servers/${community}/channels`, { name: '攻略', isPrivate: true, permissionOverrides: { send: false, upload: false }, roleOverrides: [{ roleId: role.body.id, permissions: { view: true, send: true } }] });
  expect(room.status, JSON.stringify(room.body)).toBe(201);
  expect((await send(extra, room.body.conversationId)).status).toBe(201);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKAAAAABJRU5ErkJggg==', 'base64');
  const upload = await request(app).post(`/api/uploads?conversationId=${room.body.conversationId}`).set('Origin', origin).set('Cookie', extra.cookie).set('X-CSRF-Token', extra.csrfToken).attach('file', png, { filename: 'blocked.png', contentType: 'image/png' }); expect(upload.status).toBe(403);
  expect((await api(moderator).get(`/conversations/${room.body.conversationId}/messages`)).status).toBe(403);
  expect((await api(extra).post(`/servers/${community}/roles`, { name: '提权', permissions: { installBots: true } })).status).toBe(403);
  const other = await api(owner).post('/servers', { name: '第二社区' }); expect(other.status).toBe(201);
  expect((await api(owner).post(`/servers/${other.body.id}/channels`, { name: '越权身份组', roleOverrides: [{ roleId: role.body.id, permissions: { view: true } }] })).status).toBe(400);
  const otherDetail = await api(owner).get(`/servers/${other.body.id}`);
  expect((await send(extra, otherDetail.body.channels[0].conversationId)).status).toBe(403);
  expect((await api(owner).patch(`/servers/${community}/channels/${room.body.id}`, { roleOverrides: [{ roleId: role.body.id, permissions: { view: true, send: true, manageChannels: false } }] })).status).toBe(200);
  expect((await api(extra).patch(`/servers/${community}/channels/${room.body.id}`, { name: '覆盖管理拒绝' })).status).toBe(403);
  expect((await api(extra).delete(`/servers/${community}/channels/${room.body.id}`)).status).toBe(403);
  const assignedTicket = await api(owner).post(`/servers/${community}/tickets`, { memberId: moderator.user.id, subject: '角色撤销验证', category: '支持', content: '处理权限即时撤销', clientId: randomUUID() }); expect(assignedTicket.status).toBe(201);
  expect((await api(owner).patch(`/tickets/${assignedTicket.body.id}`, { requestAssigneeId: extra.user.id })).status).toBe(200);
  expect((await api(moderator).patch(`/tickets/${assignedTicket.body.id}`, { handoffConsent: 'APPROVE', expectedAssigneeId: extra.user.id })).status).toBe(200);
  expect((await api(extra).get(`/tickets/${assignedTicket.body.id}`)).status).toBe(200);
  expect((await api(owner).patch(`/servers/${community}/roles/${role.body.id}`, { permissions: { view: false, send: false, upload: false, manageChannels: true } })).status).toBe(200);
  expect((await api(extra).get(`/tickets/${assignedTicket.body.id}`)).status).toBe(403);
  expect((await api(extra).get('/conversations')).body.some((c: any) => c.id === assignedTicket.body.conversationId)).toBe(false);
  expect(await prisma.conversationMember.count({ where: { conversationId: assignedTicket.body.conversationId, userId: extra.user.id } })).toBe(0);
  expect((await api(extra).get(`/conversations/${general}/messages`)).status).toBe(403);
  expect((await api(extra).get(`/servers/${community}`)).body.channels.some((c: any) => c.conversationId === general)).toBe(false);
  expect((await api(owner).delete(`/servers/${community}/roles/${lower.body.id}`)).status).toBe(200);
  expect((await api(owner).delete(`/servers/${community}/roles/${role.body.id}`)).status).toBe(200);
  expect((await api(extra).get(`/conversations/${room.body.conversationId}/messages`)).status).toBe(403);
  expect((await api(extra).post(`/servers/${community}/channels`, { name: '已撤销权限' })).status).toBe(403);
});
it('ordinary-member preview hides private channel metadata and exposes effective read-only permissions', async () => {
  const preview = await api(owner).get(`/servers/${community}/preview`); expect(preview.status).toBe(200);
  expect(preview.body.role).toBe('MEMBER'); expect(preview.body.channels.some((c: any) => c.id === privateChannel.id)).toBe(false);
  const notice = preview.body.channels.find((c: any) => c.id === announcement.id); expect(notice.permissions.view).toBe(true); expect(notice.permissions.send).toBe(false); expect(notice.permissions.upload).toBe(false);
  expect((await api(extra).get(`/servers/${community}/preview`)).status).toBe(403);
});
it('community settings and ownership transfer remain scoped and refresh inherited readers', async () => {
  expect((await api(owner).patch(`/servers/${community}`, { rules: '保持友善', description: '游戏交流社' })).status).toBe(200);
  expect((await api(extra).patch(`/servers/${community}`, { rules: '越权' })).status).toBe(403);
  expect((await api(extra).post(`/servers/${community}/transfer`, { userId: extra.user.id })).status).toBe(403);
  expect((await api(owner).post(`/servers/${community}/transfer`, { userId: outsider.user.id })).status).toBe(403);
  const ticket = await api(owner).post(`/servers/${community}/tickets`, { memberId: moderator.user.id, subject: '所有权交接', category: '支持', content: '只交接当前社区主', clientId: randomUUID() }); expect(ticket.status).toBe(201);
  expect((await api(owner).post(`/servers/${community}/transfer`, { userId: extra.user.id })).status).toBe(200);
  expect((await api(extra).get(`/tickets/${ticket.body.id}`)).status).toBe(200);
  expect((await api(owner).get(`/tickets/${ticket.body.id}`)).status).toBe(403);
  expect((await api(owner).get('/conversations')).body.some((c: any) => c.id === ticket.body.conversationId)).toBe(false);
  expect((await api(moderator).get(`/tickets/${ticket.body.id}`)).status).toBe(200);
  const detail = await api(extra).get(`/servers/${community}`); expect(detail.body.role).toBe('OWNER'); expect(detail.body.ownerId).toBe(extra.user.id); expect(detail.body.rules).toBe('保持友善');
  expect((await api(owner).post(`/servers/${community}/transfer`, { userId: owner.user.id })).status).toBe(403);
  expect(await prisma.message.count({ where: { id: messageId } })).toBe(1);
});
it('uses one handler policy for promoted moderators, assignment and immediate reader revocation', async () => {
  // Custom assignments may survive a built-in role promotion. Explicit denies
  // must keep the same meaning in settings, assignment and existing tickets.
  const role = await api(extra).post(`/servers/${community}/roles`, { name: '工单权限关闭', position: 40, permissions: { handleTickets: false } }); expect(role.status).toBe(201);
  expect((await api(extra).patch(`/servers/${community}/members/${moderator.user.id}`, { role: 'MEMBER' })).status).toBe(200);
  expect((await api(extra).put(`/servers/${community}/roles/${role.body.id}/members`, { userIds: [moderator.user.id] })).status).toBe(200);
  expect((await api(extra).patch(`/servers/${community}/members/${moderator.user.id}`, { role: 'MODERATOR' })).status).toBe(200);
  const policy = await api(moderator).get(`/servers/${community}`); expect(policy.body.role).toBe('MODERATOR'); expect(policy.body.permissions.handleTickets).toBe(false); expect(policy.body.members.find((m: any) => m.userId === moderator.user.id).ticketEligible).toBe(false);
  const ticket = await api(extra).post(`/servers/${community}/tickets`, { memberId: owner.user.id, subject: '版主处理权一致性', category: '支持', content: '此工单不属于版主', clientId: randomUUID() }); expect(ticket.status).toBe(201);
  expect((await api(extra).patch(`/tickets/${ticket.body.id}`, { assigneeId: moderator.user.id })).status).toBe(403);
  expect((await api(extra).patch(`/servers/${community}/roles/${role.body.id}`, { permissions: { handleTickets: true } })).status).toBe(200);
  expect((await api(extra).get(`/servers/${community}`)).body.members.find((m: any) => m.userId === moderator.user.id).ticketEligible).toBe(true);
  expect((await api(extra).patch(`/tickets/${ticket.body.id}`, { requestAssigneeId: moderator.user.id })).status).toBe(200);
  expect((await api(owner).patch(`/tickets/${ticket.body.id}`, { handoffConsent: 'APPROVE', expectedAssigneeId: moderator.user.id })).status).toBe(200);
  expect((await api(moderator).get(`/tickets/${ticket.body.id}`)).status).toBe(200);
  const watcher = await connect(moderator), leaked: any[] = []; watcher.on('message:new', value => leaked.push(value));
  expect((await api(extra).patch(`/servers/${community}/roles/${role.body.id}`, { permissions: { handleTickets: false } })).status).toBe(200);
  expect((await api(moderator).get(`/tickets/${ticket.body.id}`)).status).toBe(403);
  expect((await api(extra).get(`/servers/${community}`)).body.members.find((m: any) => m.userId === moderator.user.id).ticketEligible).toBe(false);
  expect((await api(moderator).get(`/servers/${community}/tickets`)).body.tickets.some((t: any) => t.id === ticket.body.id)).toBe(false);
  expect((await api(moderator).get('/conversations')).body.some((c: any) => c.id === ticket.body.conversationId)).toBe(false);
  expect(await prisma.conversationMember.count({ where: { conversationId: ticket.body.conversationId, userId: moderator.user.id } })).toBe(0);
  expect((await send(extra, ticket.body.conversationId, 'ROLE_REVOKE_TICKET')).status).toBe(201);
  await watcher.timeout(3000).emitWithAck('presence:set', { status: 'ONLINE' }); expect(leaked.some(m => m.conversationId === ticket.body.conversationId)).toBe(false); watcher.disconnect();
});
