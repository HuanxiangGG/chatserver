import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
const db = process.env.TEST_DATABASE_URL, cache = process.env.TEST_REDIS_URL;
if (!db || !new URL(db).pathname.endsWith('_test') || !cache || new URL(cache).pathname !== '/9') throw Error('Dedicated test database required');
Object.assign(process.env, { DATABASE_URL: db, REDIS_URL: cache, NODE_ENV: 'test', APP_ORIGIN: 'https://chat.6hx9.com', COOKIE_SECURE: 'false', TRUST_PROXY: '2' });
const origin = 'https://chat.6hx9.com', ip = '198.51.100.77', prefix = 'r' + randomBytes(5).toString('hex'), password = 'TrafficOnly-Password-951!';
const headers = { Origin: origin, 'X-Forwarded-For': `${ip}, 127.0.0.1`, 'X-Forwarded-Proto': 'https' };
let app: any, prisma: any, redis: any, realtime: any, server: ReturnType<typeof createServer>, base: string, conversation: string;
type Person = { user: { id: string; username: string }; csrfToken: string; cookie: string };
let alice: Person, bob: Person, outsider: Person;
const sockets: Socket[] = [];
const budget = `harbor:limit:http:${ip}`;
function api(person?: Person) {
  const call = (method: 'get' | 'post', path: string, body?: unknown) => {
    const r = request(app)[method](`/api${path}`).set(headers).set('Cookie', person?.cookie || '').set('X-CSRF-Token', person?.csrfToken || '');
    return body === undefined ? r : r.send(body);
  };
  return { get: (path: string) => call('get', path), post: (path: string, body: unknown = {}) => call('post', path, body) };
}
async function register(name: string): Promise<Person> {
  const r = await api().post('/auth/register', { username: prefix + name, email: `${prefix}${name}@example.test`, displayName: name, password });
  expect(r.status).toBe(201); return { ...r.body, cookie: r.headers['set-cookie'][0].split(';')[0] };
}
beforeAll(async () => {
  ({ default: app } = await import('../src/app.js')); ({ prisma, redis } = await import('../src/context.js'));
  await redis.del(budget, `harbor:limit:register:ip:${ip}`, `harbor:limit:login:ip:${ip}`);
  alice = await register('alice'); bob = await register('bob'); outsider = await register('outsider');
  const invite = await api(alice).post('/friend-requests', { userId: bob.user.id }); expect(invite.status).toBe(201);
  expect((await api(bob).post(`/friend-requests/${invite.body.id}/respond`, { accept: true })).status).toBe(200);
  const c = await api(alice).post('/conversations/direct', { userId: bob.user.id }); expect(c.status).toBe(201); conversation = c.body.id;
  realtime = await import('../src/realtime.js'); server = createServer(app); await realtime.initRealtime(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => {
  sockets.forEach(s => s.disconnect()); if (realtime) await realtime.closeRealtime(); if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  await redis?.del(budget); await prisma?.$disconnect(); redis?.disconnect();
});
it('authenticated chat and two users sharing an IP do not consume the anonymous IP budget', async () => {
  await redis.set(budget, 600, 'EX', 60);
  try {
    expect((await api(alice).get(`/conversations/${conversation}/messages`)).status).toBe(200);
    expect((await api(bob).get('/conversations')).status).toBe(200);
    expect((await api(outsider).get(`/conversations/${conversation}/messages`)).status).toBe(403);
    expect((await api(alice).get('/friends')).status).toBe(200);
    expect((await api(alice).get('/servers')).status).toBe(200);
    expect((await api(alice).get('/friend-requests')).status).toBe(200);
    const csrf = await request(app).post(`/api/conversations/${conversation}/messages`).set(headers).set('Cookie', alice.cookie).send({ content: '缺少令牌', clientId: randomUUID() });
    expect(csrf.status).toBe(403); expect(csrf.body.code).toBe('CSRF_INVALID');
    expect(await redis.get(budget)).toBe('600');
  } finally { await redis.del(budget); }
});
it('continues past the old 60 messages/minute cap and retains idempotent retries', async () => {
  const oldKey = `harbor:limit:message:${alice.user.id}`;
  await redis.set(oldKey, 60, 'EX', 60);
  try {
    for (let i = 0; i < 65; i++) {
      const clientId = randomUUID(); const body = { content: `连续聊天 ${i}`, clientId };
      const sent = await api(alice).post(`/conversations/${conversation}/messages`, body); expect(sent.status, JSON.stringify(sent.body)).toBe(201);
      if (i === 64) { const retry = await api(alice).post(`/conversations/${conversation}/messages`, body); expect(retry.status).toBe(200); expect(retry.body.id).toBe(sent.body.id); }
    }
    expect(await prisma.message.count({ where: { conversationId: conversation, senderId: alice.user.id } })).toBe(65);
    expect(await redis.get(oldKey)).toBe('60');
  } finally { await redis.del(oldKey); }
});
it('accepts typing past the old 120/minute cap without operation:error, preserving socket permissions', async () => {
  const oldKey = `harbor:limit:typing:${alice.user.id}`; await redis.set(oldKey, 120, 'EX', 60);
  const socket = io(base, { transports: ['websocket'], reconnection: false, autoConnect: false, auth: { csrfToken: alice.csrfToken }, extraHeaders: { Cookie: alice.cookie, Origin: origin } }); sockets.push(socket);
  const errors: unknown[] = []; socket.on('operation:error', e => errors.push(e));
  try {
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
    for (let i = 0; i < 130; i++) expect((await socket.timeout(3000).emitWithAck('typing', { conversationId: conversation, typing: i < 129 })).ok).toBe(true);
    expect(errors).toEqual([]); expect(socket.connected).toBe(true); expect(await redis.get(oldKey)).toBe('120');
    const denied = await socket.timeout(3000).emitWithAck('typing', { conversationId: randomUUID(), typing: true }); expect(denied.error).toBeTruthy();
  } finally { socket.disconnect(); await redis.del(oldKey); }
});
it('retains anonymous IP throttling and permits login with a stale cookie', async () => {
  await redis.set(budget, 600, 'EX', 60);
  try {
    expect((await api().get('/conversations')).status).toBe(429);
    const forged = await request(app).get('/api/conversations').set(headers).set('Cookie', `harbor_session=${randomBytes(32).toString('hex')}`);
    expect(forged.status).toBe(429);
  } finally { await redis.del(budget); }
  const login = await request(app).post('/api/auth/login').set(headers).set('Cookie', `harbor_session=${randomBytes(32).toString('hex')}`).send({ username: alice.user.username, password });
  expect(login.status).toBe(200);
});
