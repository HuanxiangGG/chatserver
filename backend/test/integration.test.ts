import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from 'node:http';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';

// Refuse production or implicit database targets. Tests need dedicated PG/Redis.
const db = process.env.TEST_DATABASE_URL;
const cache = process.env.TEST_REDIS_URL;
if (!db || !new URL(db).pathname.endsWith('_test') || !cache || new URL(cache).pathname !== '/9') {
  throw new Error('Set TEST_DATABASE_URL with database name ending _test and TEST_REDIS_URL with dedicated Redis database /9.');
}
process.env.DATABASE_URL = db;
process.env.REDIS_URL = cache;
process.env.NODE_ENV = 'test';
process.env.APP_ORIGIN = ' https://CHAT.6HX9.COM/, https://second.example ';
process.env.COOKIE_SECURE = 'false';
process.env.TRUST_PROXY = '2';
const origin = 'https://chat.6hx9.com';
const password = 'TestOnly-Harbor-9347!';
const prefix = `t${Date.now().toString(36)}`;
let app: any, prisma: any, redis: any, realtime: any, server: ReturnType<typeof createServer>, base: string;
type Person = { user: { id: string; username: string }; cookie: string; csrfToken: string };
let alice: Person, bob: Person, carol: Person, admin: Person;
let direct: string, group: string, message: string, attachment: string;
const sockets: Socket[] = [];
function api(p?: Person) {
  return {
    get: (path: string) => request(app).get(`/api${path}`).set('Origin', origin).set('Cookie', p?.cookie ?? ''),
    post: (path: string, body: unknown = {}) => request(app).post(`/api${path}`).set('Origin', origin).set('Cookie', p?.cookie ?? '').set('X-CSRF-Token', p?.csrfToken ?? '').send(body),
    patch: (path: string, body: unknown) => request(app).patch(`/api${path}`).set('Origin', origin).set('Cookie', p?.cookie ?? '').set('X-CSRF-Token', p?.csrfToken ?? '').send(body),
    delete: (path: string, body: unknown = {}) => request(app).delete(`/api${path}`).set('Origin', origin).set('Cookie', p?.cookie ?? '').set('X-CSRF-Token', p?.csrfToken ?? '').send(body),
  };
}
async function register(name: string): Promise<Person> {
  const r = await api().post('/auth/register', { username: prefix + name, email: `${prefix}${name}@example.test`, password, displayName: name });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { ...r.body, cookie: r.headers['set-cookie'][0].split(';')[0] };
}
async function friend(from: Person, to: Person) {
  const r = await api(from).post('/friend-requests', { userId: to.user.id }); expect(r.status).toBe(201);
  expect((await api(to).post(`/friend-requests/${r.body.id}/respond`, { accept: true })).status).toBe(200);
}
function once(socket: Socket, event: string) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`Timeout waiting for ${event}`)); }, 4000);
    function listener(data: unknown) { clearTimeout(timer); resolve(data); }
    socket.once(event, listener);
  });
}
async function connect(person: Person, csrf = person.csrfToken) {
  const socket = io(base, { transports: ['websocket'], reconnection: false, auth: { csrfToken: csrf }, extraHeaders: { Cookie: person.cookie, Origin: origin }, autoConnect: false });
  sockets.push(socket);
  const ready = once(socket, 'connect'); socket.connect(); await ready; return socket;
}
beforeAll(async () => {
  ({ default: app } = await import('../src/app.js'));
  ({ prisma, redis } = await import('../src/context.js'));
  // This is isolated database 9, enforced above. Only clear Harbor limiter keys.
  const keys = await redis.keys('harbor:limit:*'); if (keys.length) await redis.del(...keys);
  server = createServer(app);
  realtime = await import('../src/realtime.js');
  await realtime.initRealtime(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  alice = await register('alice'); bob = await register('bob'); carol = await register('carol'); admin = await register('admin');
  await prisma.user.update({ where: { id: admin.user.id }, data: { role: 'ADMIN' } });
}, 30000);
afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  if (realtime?.closeRealtime) await realtime.closeRealtime();
  if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  if (prisma) await prisma.$disconnect(); if (redis) redis.disconnect();
}, 15000);

describe('Real PostgreSQL + Redis integration', () => {
  it('health checks both data services', async () => { expect((await api().get('/health')).status).toBe(200); });
  it('registration stores bcrypt hash and hashed opaque session; safe public fields', async () => {
    const row = await prisma.user.findUnique({ where: { id: alice.user.id } });
    expect(row.passwordHash).toMatch(/^\$2[aby]\$/); expect(row.passwordHash).not.toContain(password);
    const session = await prisma.session.findFirst({ where: { userId: alice.user.id } });
    expect(session.tokenHash).not.toBe(alice.cookie.split('=')[1]);
    const me = await api(alice).get('/auth/me'); expect(me.body.user.passwordHash).toBeUndefined(); expect(me.body.user.email).toBeUndefined();
  });
  it('rejects duplicate accounts, weak password, and wrong password', async () => {
    expect((await api().post('/auth/register', { username: alice.user.username, email: `${prefix}dup@example.test`, password, displayName: 'dup' })).status).toBe(409);
    expect((await api().post('/auth/register', { username: prefix+'weak', email: `${prefix}weak@example.test`, password: '123', displayName: 'weak' })).status).toBe(400);
    expect((await api().post('/auth/login', { username: alice.user.username, password: 'wrong' })).status).toBe(401);
    const login = await api().post('/auth/login', { username: alice.user.username, password }); expect(login.status).toBe(200);
    expect(login.headers['set-cookie'][0]).toContain('HttpOnly'); expect(login.headers['set-cookie'][0]).toContain('SameSite=Lax');
  });
  it('enforces authentication, CSRF token, and trusted Origin', async () => {
    expect((await api().get('/conversations')).status).toBe(401);
    expect((await request(app).patch('/api/users/me').set('Cookie', alice.cookie).set('Origin', origin).send({ bio: 'x' })).status).toBe(403);
    expect((await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').send({ username: alice.user.username, password })).status).toBe(403);
    expect((await api(alice).patch('/users/me', { bio: '<script>alert(1)</script>', displayName: 'Alice' })).status).toBe(200);
  });
  it('searches safely without exposing password or email', async () => {
    const r = await api(alice).get(`/users?q=${prefix}`); expect(r.status).toBe(200);
    expect(r.body.some((u: any) => u.id === bob.user.id)).toBe(true);
    expect(r.body[0].passwordHash).toBeUndefined(); expect(r.body[0].email).toBeUndefined();
  });
  it('friend request can only be accepted by recipient; acceptance is mutual', async () => {
    const r = await api(alice).post('/friend-requests', { userId: bob.user.id }); expect(r.status).toBe(201);
    expect((await api(carol).post(`/friend-requests/${r.body.id}/respond`, { accept: true })).status).toBe(404);
    const incoming = await api(bob).get('/friend-requests'); expect(incoming.body.incoming.some((f: any) => f.id === r.body.id)).toBe(true);
    expect((await api(bob).post(`/friend-requests/${r.body.id}/respond`, { accept: true })).status).toBe(200);
    expect((await api(alice).get('/friends')).body.some((u: any) => u.id === bob.user.id)).toBe(true);
    expect((await api(bob).get('/friends')).body.some((u: any) => u.id === alice.user.id)).toBe(true);
  });
  it('rejects friend request and disallows self friendship', async () => {
    const r = await api(carol).post('/friend-requests', { userId: bob.user.id });
    expect((await api(bob).post(`/friend-requests/${r.body.id}/respond`, { accept: false })).status).toBe(200);
    expect((await api(bob).post('/friend-requests', { userId: bob.user.id })).status).toBe(400);
    await friend(alice, carol);
  });
  it('creates one idempotent direct conversation for friends only', async () => {
    const r = await api(alice).post('/conversations/direct', { userId: bob.user.id }); expect(r.status).toBe(201); direct = r.body.id;
    const second = await api(bob).post('/conversations/direct', { userId: alice.user.id }); expect(second.body.id).toBe(direct);
    expect((await api(admin).post('/conversations/direct', { userId: alice.user.id })).status).toBe(403);
  });
  it('denies unauthorized reading, sending, and conversation metadata', async () => {
    for (const suffix of ['', '/messages']) expect((await api(carol).get(`/conversations/${direct}${suffix}`)).status).toBe(403);
    expect((await api(carol).post(`/conversations/${direct}/messages`, { content: 'intrusion', clientId: randomUUID() })).status).toBe(403);
  });
  it('authenticates WebSocket sessions, CSRF, and Origin', async () => {
    const bad = io(base, { transports: ['websocket'], reconnection: false, auth: { csrfToken: 'invalid' }, extraHeaders: { Origin: origin, Cookie: alice.cookie }, autoConnect: false }); sockets.push(bad);
    const failed = once(bad, 'connect_error'); bad.connect(); expect(await failed).toBeTruthy(); expect(bad.connected).toBe(false);
    const missing = io(base, { transports: ['websocket'], reconnection: false, extraHeaders: { Origin: origin }, autoConnect: false }); sockets.push(missing);
    const rejected = once(missing, 'connect_error'); missing.connect(); await rejected; expect(missing.connected).toBe(false);
  });
  it('delivers persisted messages over Socket.IO; deduplicates retries', async () => {
    const socket = await connect(bob); const notification = once(socket, 'message:new');
    const clientId = randomUUID(); const r = await api(alice).post(`/conversations/${direct}/messages`, { content: 'Hello 实时 🌊', clientId }); expect(r.status).toBe(201); message = r.body.id;
    expect((await notification).id).toBe(message);
    const retry = await api(alice).post(`/conversations/${direct}/messages`, { content: 'Hello 实时 🌊', clientId }); expect([200,201]).toContain(retry.status); expect(retry.body.id).toBe(message);
    const history = await api(bob).get(`/conversations/${direct}/messages`); expect(history.body.messages.filter((m: any) => m.id === message)).toHaveLength(1);
    const conv = await api(bob).get('/conversations'); expect(conv.body.find((c: any) => c.id === direct).unreadCount).toBeGreaterThan(0);
  });
  it('records delivered/read receipts and clears unread count', async () => {
    expect((await api(bob).post(`/conversations/${direct}/delivered`, { messageId: message })).status).toBe(200);
    expect((await api(bob).post(`/conversations/${direct}/read`, { messageId: message })).status).toBe(200);
    const history = await api(alice).get(`/conversations/${direct}/messages`); const m=history.body.messages.find((m: any)=>m.id===message);
    expect(m.reads.some((r: any) => r.userId === bob.user.id && r.readAt && r.deliveredAt)).toBe(true);
    expect((await api(bob).get('/conversations')).body.find((c: any) => c.id === direct).unreadCount).toBe(0);
  });
  it('paginates tied timestamps without duplicates or missing messages', async () => {
    const at=new Date();
    await prisma.message.createMany({data:Array.from({length:55},(_,i)=>({conversationId:direct,senderId:alice.user.id,content:`history ${i}`,clientId:randomUUID(),createdAt:at}))});
    const first=await api(bob).get(`/conversations/${direct}/messages`); expect(first.body.messages).toHaveLength(50); expect(first.body.hasMore).toBe(true);
    const second=await api(bob).get(`/conversations/${direct}/messages?before=${first.body.messages[0].id}`);
    const ids=[...first.body.messages,...second.body.messages].map((m:any)=>m.id); expect(new Set(ids).size).toBe(56); expect(second.body.hasMore).toBe(false);
  });
  it('keeps another device online and shares BUSY presence across devices', async () => {
    const one=await connect(bob), two=await connect(bob);
    const busy=await new Promise<any>(resolve=>two.emit('presence:set',{status:'BUSY'},resolve)); expect(busy.ok).toBe(true);
    one.disconnect(); await new Promise(resolve=>setTimeout(resolve,80));
    expect((await prisma.user.findUnique({where:{id:bob.user.id}})).status).toBe('BUSY');
    const online=await new Promise<any>(resolve=>two.emit('presence:set',{status:'ONLINE'},resolve)); expect(online.ok).toBe(true);
  });
  it('supports replies, author-only edits, and personal message hiding', async () => {
    const reply = await api(bob).post(`/conversations/${direct}/messages`, { content: 'reply', replyToId: message, clientId: randomUUID() }); expect(reply.status).toBe(201); expect(reply.body.replyTo.id).toBe(message);
    expect((await api(bob).patch(`/messages/${message}`, { content: 'forbidden edit' })).status).toBe(403);
    expect((await api(alice).patch(`/messages/${message}`, { content: 'Edited hello' })).status).toBe(200);
    expect((await api(alice).delete(`/messages/${reply.body.id}`)).status).toBe(200);
    expect((await api(alice).get(`/conversations/${direct}/messages`)).body.messages.some((m: any) => m.id === reply.body.id)).toBe(false);
    expect((await api(bob).get(`/conversations/${direct}/messages`)).body.messages.some((m: any) => m.id === reply.body.id)).toBe(true);
  });
  it('creates groups and enforces owner/admin/member permissions', async () => {
    const r = await api(alice).post('/conversations/group', { name: 'Test group', description: 'real group', userIds: [bob.user.id, carol.user.id] }); expect(r.status).toBe(201); group = r.body.id;
    expect((await api(bob).patch(`/conversations/${group}`, { name: 'not allowed' })).status).toBe(403);
    expect((await api(bob).delete(`/conversations/${group}`)).status).toBe(403);
    expect((await api(alice).patch(`/conversations/${group}/members/${bob.user.id}`, { role: 'ADMIN' })).status).toBe(200);
    expect((await api(bob).patch(`/conversations/${group}`, { name: 'Renamed by admin' })).status).toBe(200);
    expect((await api(bob).delete(`/conversations/${group}/members/${alice.user.id}`)).status).toBeGreaterThanOrEqual(400);
    const sent = await api(carol).post(`/conversations/${group}/messages`, { content: 'group hello', clientId: randomUUID() }); expect(sent.status).toBe(201);
    expect((await api(alice).get(`/conversations/${group}/messages`)).body.messages.some((m: any) => m.id===sent.body.id)).toBe(true);
  });
  it('serializes simultaneous ownership transfers and preserves exactly one owner', async () => {
    const created=await api(alice).post('/conversations/group',{name:'Concurrent ownership',userIds:[bob.user.id,carol.user.id]}); expect(created.status).toBe(201);
    const id=created.body.id;
    const outcomes=await Promise.all([api(alice).post(`/conversations/${id}/transfer`,{userId:bob.user.id}),api(alice).post(`/conversations/${id}/transfer`,{userId:carol.user.id})]);
    expect(outcomes.map(r=>r.status).sort()).toEqual([200,403]);
    expect(await prisma.conversationMember.count({where:{conversationId:id,role:'OWNER'}})).toBe(1);
  });
  it('removing a group member immediately denies history and socket typing', async () => {
    expect((await api(bob).delete(`/conversations/${group}/members/${carol.user.id}`)).status).toBe(200);
    expect((await api(carol).get(`/conversations/${group}/messages`)).status).toBe(403);
    const s = await connect(carol); const result = await new Promise<any>(resolve => s.emit('typing', { conversationId: group, typing: true }, resolve));
    expect(result?.ok).not.toBe(true);
  });
  it('validates file signatures, MIME and extensions, rejecting disguised executable content', async () => {
    const upload=(bytes: Buffer,filename: string,type: string)=>request(app).post('/api/uploads').set('Origin',origin).set('Cookie',alice.cookie).set('X-CSRF-Token',alice.csrfToken).attach('file',bytes,{filename,contentType:type});
    expect((await upload(Buffer.from('<svg onload="alert(1)"></svg>'),'bad.svg','image/svg+xml')).status).toBe(400);
    expect((await upload(Buffer.from('MZ executable'),'fake.png','image/png')).status).toBe(400);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII=','base64');
    expect((await upload(png,'bad.exe','image/png')).status).toBe(400);
    const good = await upload(png,'pixel.png','image/png'); expect(good.status,JSON.stringify(good.body)).toBe(201); attachment=good.body.id;
    expect((await api(carol).get(`/uploads/${attachment}`)).status).toBeGreaterThanOrEqual(400);
    const sent=await api(alice).post(`/conversations/${direct}/messages`,{content:'image',attachmentIds:[attachment],clientId:randomUUID()}); expect(sent.status).toBe(201);
    expect((await api(bob).get(`/uploads/${attachment}`)).status).toBe(200);
    expect((await api(carol).get(`/uploads/${attachment}`)).status).toBeGreaterThanOrEqual(400);
    const stolen=await api(bob).post(`/conversations/${direct}/messages`,{content:'stolen',attachmentIds:[attachment],clientId:randomUUID()}); expect(stolen.status).toBeGreaterThanOrEqual(400);
  });
  it('rejects oversize files and cross-conversation reply references', async () => {
    const large = await request(app).post('/api/uploads').set('Origin',origin).set('Cookie',alice.cookie).set('X-CSRF-Token',alice.csrfToken).attach('file',Buffer.alloc(10*1024*1024+1),{filename:'large.pdf',contentType:'application/pdf'}); expect([400,413]).toContain(large.status);
    expect((await api(alice).post(`/conversations/${group}/messages`,{content:'bad reply',replyToId:message,clientId:randomUUID()})).status).toBeGreaterThanOrEqual(400);
    expect((await api(bob).get(`/conversations/${group}/messages?before=${message}`)).status).toBe(400);
  });
  it('retraction hides content and ordinary users cannot use admin APIs', async () => {
    expect((await api(alice).post(`/messages/${message}/retract`)).status).toBe(200);
    let history=(await api(bob).get(`/conversations/${direct}/messages`)).body; let m=history.messages.find((m: any)=>m.id===message); if(!m&&history.hasMore){history=(await api(bob).get(`/conversations/${direct}/messages?before=${history.messages[0].id}`)).body;m=history.messages.find((m:any)=>m.id===message);} expect(m.content).toBe(''); expect(m.retractedAt).toBeTruthy();
    expect((await api(alice).get('/admin/users')).status).toBe(403); expect((await api(alice).get('/admin/stats')).status).toBe(403);
  });
  it('blocks users, prevents direct messages and can unblock', async () => {
    expect((await api(bob).post(`/blocks/${alice.user.id}`)).status).toBe(200);
    expect((await api(alice).post(`/conversations/${direct}/messages`,{content:'blocked',clientId:randomUUID()})).status).toBe(403);
    expect((await api(alice).post('/friend-requests',{userId:bob.user.id})).status).toBe(403);
    expect((await api(bob).get('/blocks')).body.some((u: any)=>u.id===alice.user.id)).toBe(true);
    expect((await api(bob).delete(`/blocks/${alice.user.id}`)).status).toBe(200);
  });
  it('admin moderation is authorized, logged and ban revokes HTTP and WebSocket sessions', async () => {
    expect((await api(admin).get('/admin/stats')).status).toBe(200);
    const s=await connect(carol); const disconnected=once(s,'disconnect');
    const ban=await api(admin).post(`/admin/users/${carol.user.id}/ban`,{banned:true,reason:'Integration test'}); expect(ban.status).toBe(200); await disconnected;
    expect((await api(carol).get('/auth/me')).status).toBe(401);
    expect((await api().post('/auth/login',{username:carol.user.username,password})).status).toBe(401);
    const gm=await api(alice).post(`/conversations/${group}/messages`,{content:'moderated',clientId:randomUUID()});
    expect((await api(admin).delete(`/admin/messages/${gm.body.id}`,{reason:'Test moderation'})).status).toBe(200);
    const logs=await api(admin).get('/admin/actions'); expect(logs.status).toBe(200); expect(Array.isArray(logs.body)?logs.body.length:logs.body.actions?.length).toBeGreaterThan(0);
    expect((await api(admin).post(`/admin/users/${carol.user.id}/ban`,{banned:false,reason:'Test completed'})).status).toBe(200);
  });
  it('password recovery responses reveal no account existence or token', async () => {
    const a=await api().post('/auth/forgot-password',{email:`${prefix}alice@example.test`}); const b=await api().post('/auth/forgot-password',{email:'absent@example.test'});
    expect(a.status).toBe(202); expect(a.body).toEqual(b.body); expect(a.body.token).toBeUndefined();
    expect((await api().post('/auth/reset-password',{token:'a'.repeat(64),newPassword:password})).status).toBe(400);
  });
  it('accepts a valid one-time reset and invalidates all old sessions and token reuse', async () => {
    const token=randomBytes(32).toString('hex');
    await prisma.passwordReset.create({data:{userId:bob.user.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+60000)}});
    expect((await api().post('/auth/reset-password',{token,newPassword:'RecoveredTestPassword!'})).status).toBe(200);
    expect((await api().post('/auth/reset-password',{token,newPassword:password})).status).toBe(400);
    expect((await api(bob).get('/auth/me')).status).toBe(401);
    expect((await api().post('/auth/login',{username:bob.user.username,password:'RecoveredTestPassword!'})).status).toBe(200);
  });
  it('logging out one device retains the other; password change revokes all', async () => {
    const login=await api().post('/auth/login',{username:alice.user.username,password}); const other: Person={...login.body,cookie:login.headers['set-cookie'][0].split(';')[0]};
    const s=await connect(other); const disconnected=once(s,'disconnect');
    expect((await api(other).post('/auth/logout')).status).toBe(200); await disconnected;
    expect((await api(other).get('/auth/me')).status).toBe(401); expect((await api(alice).get('/auth/me')).status).toBe(200);
    expect((await api(alice).post('/auth/password',{currentPassword:password,newPassword:'NewTestOnly-Password!'})).status).toBe(200);
    expect((await api(alice).get('/auth/me')).status).toBe(401);
    expect((await api().post('/auth/login',{username:alice.user.username,password:'NewTestOnly-Password!'})).status).toBe(200);
  });
  it('distributed account rate limiting stops brute force', async () => {
    const name=prefix+'unknown'; let last=0;
    for(let i=0;i<11;i++) last=(await api().post('/auth/login',{username:name,password:'wrong'})).status;
    expect(last).toBe(429);
  });
});
