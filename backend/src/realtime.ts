import type { Server as HttpServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { parse } from 'cookie';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { z } from 'zod';
import { prisma, redis, config, authenticateToken, validate, HttpError, consumeLimit, assertUnblocked } from './context.js';

let io: Server | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let sweepTimer: ReturnType<typeof setInterval> | undefined;
const connections = new Map<string, { token: string; userId: string; sessionId: string }>();
let publisher: ReturnType<typeof redis.duplicate> | undefined;
let subscriber: ReturnType<typeof redis.duplicate> | undefined;
const userRoom = (id: string) => `user:${id}`;
const sessionRoom = (id: string) => `session:${id}`;
const key = (id: string) => `harbor:presence:${id}`;
const activeUsersKey = 'harbor:presence:users';
const ttl = 75_000;

export function emitUsers(userIds: string[], event: string, payload: unknown) {
  const rooms = [...new Set(userIds)].map(userRoom);
  if (rooms.length) io?.to(rooms).emit(event, payload);
}
export function disconnectUser(userId: string) { io?.in(userRoom(userId)).disconnectSockets(true); }
export function disconnectSession(sessionId: string) { io?.in(sessionRoom(sessionId)).disconnectSockets(true); }

async function audience(userId: string) {
  const [friends, members] = await Promise.all([
    prisma.friendship.findMany({ where: { userId }, select: { friendId: true } }),
    prisma.conversationMember.findMany({ where: { conversation: { members: { some: { userId } } } }, select: { userId: true } }),
  ]);
  return [...new Set([userId, ...friends.map(f => f.friendId), ...members.map(m => m.userId)])];
}
async function announce(userId: string, status: string, lastSeenAt: Date) {
  const targets = await audience(userId);
  const blocked = await prisma.blockedUser.findMany({ where: { OR: [{ userId }, { blockedId: userId }] } });
  const excluded = new Set(blocked.map(b => b.userId === userId ? b.blockedId : b.userId));
  emitUsers(targets.filter(id => !excluded.has(id)), 'presence:updated', { userId, status, lastSeenAt });
}
async function touch(userId: string, socketId: string) {
  await redis.multi().zadd(key(userId), Date.now() + ttl, socketId).pexpire(key(userId), ttl * 2).sadd(activeUsersKey, userId).exec();
}
async function updateOffline(userId: string) {
  const count = Number(await redis.eval(`redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1]); local n=redis.call('ZCARD', KEYS[1]); if n==0 then redis.call('SREM', KEYS[2], ARGV[2]); end; return n`, 2, key(userId), activeUsersKey, Date.now(), userId));
  if (count === 0) {
    const lastSeenAt = new Date();
    const changed = await prisma.user.updateMany({ where: { id: userId, status: { not: 'OFFLINE' } }, data: { status: 'OFFLINE', lastSeenAt } });
    // A concurrent fresh connection wins over this cleanup.
    if (await redis.zcount(key(userId), Date.now(), '+inf') > 0) {
      await prisma.user.updateMany({ where: { id: userId, status: 'OFFLINE' }, data: { status: 'ONLINE' } });
      await announce(userId, 'ONLINE', lastSeenAt);
    } else if (changed.count) await announce(userId, 'OFFLINE', lastSeenAt);
  }
}
async function fresh(socket: Socket) {
  const data = connections.get(socket.id);
  if (!data) throw new HttpError(401, '请重新登录');
  const auth = await authenticateToken(data.token);
  if (!auth || auth.session.id !== data.sessionId) throw new HttpError(401, '登录已失效');
  return auth;
}
function respond(ack: unknown, value: unknown) { if (typeof ack === 'function') ack(value); }
function reject(socket: Socket, error: unknown, ack?: unknown) {
  const message = error instanceof HttpError ? error.message : '实时连接暂时不可用';
  respond(ack, { error: message }); socket.emit('operation:error', { error: message });
  if (error instanceof HttpError && [401, 403].includes(error.status)) socket.disconnect(true);
}
async function eventMembers(conversationId: string, userId: string) {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, members: { some: { userId } } }, include: { members: { select: { userId: true } } } });
  if (!conversation) throw new HttpError(403, '无权访问此会话');
  if (conversation.type === 'DIRECT') for (const other of conversation.members) if (other.userId !== userId) await assertUnblocked(userId, other.userId);
  return conversation.members.map(m => m.userId);
}

export async function initRealtime(server: HttpServer) {
  io = new Server(server, { transports: ['websocket'], maxHttpBufferSize: 16_384, cors: { origin: config.origins, credentials: true },
    allowRequest: (req, callback) => callback(null, typeof req.headers.origin === 'string' && config.origins.includes(req.headers.origin)) });
  publisher = redis.duplicate(); subscriber = redis.duplicate();
  publisher.on('error', () => { /* Health endpoint reports Redis availability. */ });
  subscriber.on('error', () => { /* Do not log connection configuration. */ });
  await Promise.all([publisher.connect(), subscriber.connect()]);
  io.adapter(createAdapter(publisher, subscriber));
  // Reconcile stale database state after a process or Redis restart.
  const stale = await prisma.user.findMany({ where: { status: { not: 'OFFLINE' } }, select: { id: true } });
  await Promise.all(stale.map(user => updateOffline(user.id)));
  io.use(async (socket, next) => {
    try {
      if (!config.origins.includes(String(socket.handshake.headers.origin ?? ''))) throw new HttpError(403, '不允许的来源');
      const token = parse(socket.handshake.headers.cookie ?? '')[config.cookieName];
      if (!token) throw new HttpError(401, '请先登录');
      const auth = await authenticateToken(token);
      if (!auth) throw new HttpError(401, '登录已失效');
      const csrf = socket.handshake.auth?.csrfToken;
      if (typeof csrf !== 'string' || Buffer.byteLength(csrf) !== Buffer.byteLength(auth.session.csrfToken) || !timingSafeEqual(Buffer.from(csrf), Buffer.from(auth.session.csrfToken))) throw new HttpError(403, '无效的安全令牌');
      await consumeLimit(`socket-connect:${auth.user.id}`, 60, 60);
      if (await redis.zcount(key(auth.user.id), Date.now(), '+inf') >= 10) throw new HttpError(429, '在线设备过多');
      socket.data.auth = { token, userId: auth.user.id, sessionId: auth.session.id };
      next();
    } catch (error) { next(new Error(error instanceof HttpError ? error.message : '连接不可用')); }
  });
  io.on('connection', socket => {
    const data = socket.data.auth as { token: string; userId: string; sessionId: string };
    connections.set(socket.id, data);
    void socket.join([userRoom(data.userId), sessionRoom(data.sessionId)]);
    void (async () => {
      await touch(data.userId, socket.id);
      if (!socket.connected) { await redis.zrem(key(data.userId), socket.id); await updateOffline(data.userId); return; }
      const old = await prisma.user.findUniqueOrThrow({ where: { id: data.userId }, select: { status: true, lastSeenAt: true } });
      const status = old.status === 'BUSY' ? 'BUSY' : 'ONLINE';
      await prisma.user.update({ where: { id: data.userId }, data: { status } });
      if (socket.connected) await announce(data.userId, status, old.lastSeenAt);
      else await updateOffline(data.userId);
    })().catch(error => reject(socket, error));
    socket.on('typing', async (raw: unknown, ack?: unknown) => {
      try {
        await fresh(socket); await consumeLimit(`typing:${data.userId}`, 120, 60);
        const input = validate(z.object({ conversationId: z.string().min(1).max(100), typing: z.boolean() }), raw);
        const users = await eventMembers(input.conversationId, data.userId);
        emitUsers(users.filter(id => id !== data.userId), 'typing', { ...input, userId: data.userId }); respond(ack, { ok: true });
      } catch (error) { reject(socket, error, ack); }
    });
    socket.on('presence:set', async (raw: unknown, ack?: unknown) => {
      try {
        await fresh(socket); await consumeLimit(`presence:${data.userId}`, 30, 60);
        const { status } = validate(z.object({ status: z.enum(['ONLINE', 'BUSY']) }), raw);
        const changed = await prisma.user.updateMany({ where: { id: data.userId, banned: false }, data: { status } });
        if (!changed.count) throw new HttpError(401, '登录已失效');
        const updated = await prisma.user.findUniqueOrThrow({ where: { id: data.userId }, select: { lastSeenAt: true } });
        await announce(data.userId, status, updated.lastSeenAt); respond(ack, { ok: true });
      } catch (error) { reject(socket, error, ack); }
    });
    socket.on('disconnect', () => {
      connections.delete(socket.id);
      void redis.zrem(key(data.userId), socket.id).then(() => updateOffline(data.userId)).catch(() => { /* TTL cleanup handles temporary Redis outages. */ });
    });
  });
  timer = setInterval(() => {
    for (const [socketId, data] of connections) {
      const socket = io?.sockets.sockets.get(socketId);
      if (socket) void fresh(socket).then(() => touch(data.userId, socketId)).catch(error => reject(socket, error));
    }
  }, 20_000); timer.unref();
  sweepTimer = setInterval(() => {
    void redis.smembers(activeUsersKey).then(users => Promise.all(users.map(updateOffline))).catch(() => { /* Retry at next sweep. */ });
  }, 30_000); sweepTimer.unref();
  return io;
}
export async function closeRealtime() {
  if (timer) clearInterval(timer); if (sweepTimer) clearInterval(sweepTimer);
  if (io) await new Promise<void>(resolve => io!.close(() => resolve()));
  connections.clear();
  await Promise.all([publisher?.quit(), subscriber?.quit()]);
  io = undefined;
}
