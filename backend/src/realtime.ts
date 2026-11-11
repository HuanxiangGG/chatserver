import { guestAccess, guestCookie, secretEqual } from "./guest-access.js";
import { assertNotGroupMuted } from "./group-policy.js";
import { channelPermission } from "./channel-policy.js";
import { isTrustedOrigin } from "./context.js";
import type { Server as HttpServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { parse } from "cookie";
import { Server, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { z } from "zod";
import {
  prisma,
  redis,
  config,
  authenticateToken,
  validate,
  HttpError,
  consumeLimit,
  assertUnblocked,
} from "./context.js";

let io: Server | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let sweepTimer: ReturnType<typeof setInterval> | undefined;
const connections = new Map<
  string,
  { token: string; userId: string; sessionId: string; }
>();
let publisher: ReturnType<typeof redis.duplicate> | undefined;
let subscriber: ReturnType<typeof redis.duplicate> | undefined;
const userRoom = (id: string) => `user:${id}`;
const sessionRoom = (id: string) => `session:${id}`;
const key = (id: string) => `harbor:presence:${id}`;
const activeUsersKey = "harbor:presence:users";
const ttl = 75_000;
let stopping = false;
let closePromise: Promise<void> | undefined;
const tasks = new Set<Promise<unknown>>();
const taskFailures: unknown[] = [];
const guestExpiryTimers = new Set<ReturnType<typeof setTimeout>>();

// Socket.IO callbacks and the Redis adapter do not await their asynchronous
// work. Observe it here so shutdown can drain it before closing shared clients.
function track<T>(task: Promise<T>, operation: string): Promise<T> {
  tasks.add(task);
  void task.then(
    () => tasks.delete(task),
    (error) => {
      tasks.delete(task);
      if (stopping && taskFailures.length < 10) taskFailures.push(error);
      // Never include command arguments, payloads, credentials or raw errors.
      console.error(`Realtime ${operation} failed`);
    },
  );
  return task;
}
function trackAdapter(client: ReturnType<typeof redis.duplicate>) {
  const sendCommand = client.sendCommand.bind(client);
  client.sendCommand = (...args: Parameters<typeof client.sendCommand>) => {
    const result = sendCommand(...args);
    if (result && typeof (result as { then?: unknown; }).then === "function")
      track(Promise.resolve(result), "adapter command");
    return result;
  };
}
async function drain() {
  // An in-flight connection or disconnect may schedule further work.
  while (tasks.size) await Promise.allSettled([...tasks]);
}

function deliver(userIds: string[], event: string, payload: unknown) {
  const rooms = [...new Set(userIds)].map(userRoom);
  if (rooms.length && !stopping) io?.to(rooms).emit(event, payload);
}
// Invalidate only the current, unexpired sessions bound to these tickets.
// Callers handling community mutations invoke this after their transaction commits.
export function invalidateGuestTickets(
  conversationIds: readonly string[],
): Promise<void> {
  if (!io || stopping || !conversationIds.length) return Promise.resolve();
  return track(invalidateGuestTicketsNow(conversationIds), "guest invalidation");
}
async function invalidateGuestTicketsNow(conversationIds: readonly string[]) {
  const sessions = await prisma.guestTicketSession.findMany({
    where: {
      expiresAt: { gt: new Date() },
      ticket: { conversationId: { in: [...new Set(conversationIds)] } },
    },
    select: { id: true, ticket: { select: { conversationId: true } } },
  });
  if (!io || stopping) return;
  for (const session of sessions)
    io.of("/guest-tickets")
      .to(`guest-session:${session.id}`)
      .emit("ticket:changed", {
        conversationId: session.ticket.conversationId,
      });
}
export function deliverConversation(
  userIds: string[],
  event: string,
  payload: unknown,
  conversationId: string,
): Promise<void> {
  if (!io || stopping) return Promise.resolve();
  return track(
    deliverConversationNow(userIds, event, payload, conversationId),
    "delivery",
  );
}
async function deliverConversationNow(
  userIds: string[],
  event: string,
  payload: unknown,
  conversationId: string,
) {
  const ticket = await prisma.ticket.findUnique({
    where: { conversationId },
    select: { serverId: true },
  });
  if (ticket) {
    // Serialize delivery with assignment/revocation. A pre-revocation list of
    // recipients must never authorize a later message after the office is lost.
    await prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM "Server" WHERE id = ${ticket.serverId} FOR UPDATE`;
      const { ticketPermission } = await import("./ticket-policy.js");
      const allowed = [];
      for (const userId of [...new Set(userIds)]) {
        try {
          await ticketPermission(conversationId, userId, false, db);
          allowed.push(userId);
        } catch (e) {
          if (!(e instanceof HttpError && e.status === 403)) throw e;
        }
      }
      deliver(allowed, event, payload);
    });
  } else deliver(userIds, event, payload);
  if (
    io &&
    [
      "message:new",
      "message:updated",
      "conversation:updated",
      "ticket:updated",
    ].includes(event)
  ) {
    await invalidateGuestTickets([conversationId]);
  }
}
export function emitUsers(userIds: string[], event: string, payload: unknown) {
  if (!io || stopping) return;
  const data = payload as { conversationId?: string; id?: string; } | null;
  const conversationId =
    data?.conversationId ??
    (event === "conversation:updated" ? data?.id : undefined);
  if (conversationId && event !== "ticket:access-revoked")
    void deliverConversation(userIds, event, payload, conversationId);
  else deliver(userIds, event, payload);
}
export function disconnectUser(userId: string) {
  if (!stopping) io?.in(userRoom(userId)).disconnectSockets(true);
}
export function disconnectSession(sessionId: string) {
  if (!stopping) io?.in(sessionRoom(sessionId)).disconnectSockets(true);
}

async function audience(userId: string) {
  const [friends, members] = await Promise.all([
    prisma.friendship.findMany({
      where: { userId },
      select: { friendId: true },
    }),
    prisma.conversationMember.findMany({
      where: { conversation: { members: { some: { userId } } } },
      select: { userId: true },
    }),
  ]);
  return [
    ...new Set([
      userId,
      ...friends.map((f) => f.friendId),
      ...members.map((m) => m.userId),
    ]),
  ];
}
async function announce(userId: string, status: string, lastSeenAt: Date) {
  const targets = await audience(userId);
  const blocked = await prisma.blockedUser.findMany({
    where: { OR: [{ userId }, { blockedId: userId }] },
  });
  const excluded = new Set(
    blocked.map((b) => (b.userId === userId ? b.blockedId : b.userId)),
  );
  emitUsers(
    targets.filter((id) => !excluded.has(id)),
    "presence:updated",
    { userId, status, lastSeenAt },
  );
}
async function touch(userId: string, socketId: string) {
  await redis
    .multi()
    .zadd(key(userId), Date.now() + ttl, socketId)
    .pexpire(key(userId), ttl * 2)
    .sadd(activeUsersKey, userId)
    .exec();
}
async function markConnected(userId: string) {
  const users = await prisma.$queryRaw<
    Array<{ status: string; lastSeenAt: Date; }>
  >`
    UPDATE "User" SET "status" = CASE WHEN "status" = 'BUSY' THEN 'BUSY' ELSE 'ONLINE' END,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${userId} AND "banned" = false
    RETURNING "status", "lastSeenAt"
  `;
  return users[0];
}
async function updateOffline(userId: string) {
  const count = Number(
    await redis.eval(
      `redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1]); local n=redis.call('ZCARD', KEYS[1]); if n==0 then redis.call('SREM', KEYS[2], ARGV[2]); end; return n`,
      2,
      key(userId),
      activeUsersKey,
      Date.now(),
      userId,
    ),
  );
  if (count === 0) {
    const lastSeenAt = new Date();
    const changed = await prisma.user.updateMany({
      where: { id: userId, status: { not: "OFFLINE" } },
      data: { status: "OFFLINE", lastSeenAt },
    });
    // A concurrent fresh connection wins over this cleanup.
    if ((await redis.zcount(key(userId), Date.now(), "+inf")) > 0) {
      const connected = await markConnected(userId);
      if (connected)
        await announce(userId, connected.status, connected.lastSeenAt);
    } else if (changed.count) await announce(userId, "OFFLINE", lastSeenAt);
  }
}
async function fresh(socket: Socket) {
  const data = connections.get(socket.id);
  if (!data) throw new HttpError(401, "请重新登录");
  const auth = await authenticateToken(data.token);
  if (!auth || auth.session.id !== data.sessionId)
    throw new HttpError(401, "登录已失效");
  return auth;
}
function respond(ack: unknown, value: unknown) {
  if (typeof ack === "function") ack(value);
}
function reject(socket: Socket, error: unknown, ack?: unknown) {
  const message =
    error instanceof HttpError ? error.message : "实时连接暂时不可用";
  respond(ack, { error: message });
  socket.emit("operation:error", { error: message });
  // A denied channel operation does not revoke an otherwise valid session.
  if (error instanceof HttpError && error.status === 401)
    socket.disconnect(true);
}
async function eventMembers(conversationId: string, userId: string) {
  await channelPermission(conversationId, userId, true);
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, members: { some: { userId } } },
    include: { members: { select: { userId: true } } },
  });
  if (!conversation) throw new HttpError(403, "无权访问此会话");
  if (conversation.type === "DIRECT")
    for (const other of conversation.members)
      if (other.userId !== userId) await assertUnblocked(userId, other.userId);
  return conversation.members.map((m) => m.userId);
}

export async function initRealtime(server: HttpServer) {
  if (io) throw new Error("Realtime server already initialized");
  stopping = false;
  closePromise = undefined;
  taskFailures.length = 0;
  io = new Server(server, {
    transports: ["websocket"],
    maxHttpBufferSize: 16_384,
    cors: {
      origin: (origin, cb) => cb(null, !!origin && isTrustedOrigin(origin)),
      credentials: true,
    },
    allowRequest: (req, callback) =>
      callback(
        null,
        typeof req.headers.origin === "string" &&
        isTrustedOrigin(req.headers.origin),
      ),
  });
  publisher = redis.duplicate();
  subscriber = redis.duplicate();
  trackAdapter(publisher);
  trackAdapter(subscriber);
  publisher.on("error", () => {
    /* Health endpoint reports Redis availability. */
  });
  subscriber.on("error", () => {
    /* Do not log connection configuration. */
  });
  await Promise.all([publisher.connect(), subscriber.connect()]);
  io.adapter(createAdapter(publisher, subscriber));
  // Reconcile stale database state after a process or Redis restart.
  const stale = await prisma.user.findMany({
    where: { status: { not: "OFFLINE" } },
    select: { id: true },
  });
  await Promise.all(stale.map((user) => updateOffline(user.id)));
  io.use((socket, next) => {
    if (stopping) return next(new Error("连接正在关闭"));
    void track((async () => {
      try {
        if (!isTrustedOrigin(String(socket.handshake.headers.origin ?? "")))
          throw new HttpError(403, "不允许的来源");
        const token = parse(socket.handshake.headers.cookie ?? "")[
          config.cookieName
        ];
        if (!token) throw new HttpError(401, "请先登录");
        const auth = await authenticateToken(token);
        if (!auth) throw new HttpError(401, "登录已失效");
        const csrf = socket.handshake.auth?.csrfToken;
        if (
          typeof csrf !== "string" ||
          Buffer.byteLength(csrf) !== Buffer.byteLength(auth.session.csrfToken) ||
          !timingSafeEqual(Buffer.from(csrf), Buffer.from(auth.session.csrfToken))
        )
          throw new HttpError(403, "无效的安全令牌");
        await consumeLimit(`socket-connect:${auth.user.id}`, 60, 60);
        if ((await redis.zcount(key(auth.user.id), Date.now(), "+inf")) >= 10)
          throw new HttpError(429, "在线设备过多");
        socket.data.auth = {
          token,
          userId: auth.user.id,
          sessionId: auth.session.id,
        };
        if (stopping) throw new HttpError(503, "连接正在关闭");
        next();
      } catch (error) {
        next(
          new Error(error instanceof HttpError ? error.message : "连接不可用"),
        );
      }
    })(), "authentication");
  });
  const guests = io.of("/guest-tickets");
  guests.use((socket, next) => {
    if (stopping) return next(new Error("GUEST_ACCESS_DENIED"));
    void track((async () => {
      try {
        if (!isTrustedOrigin(String(socket.handshake.headers.origin ?? "")))
          throw new HttpError(403, "不允许的来源");
        const { serverId, ticketId, csrfToken } = validate(
          z.strictObject({
            serverId: z.string().min(1).max(100),
            ticketId: z.string().min(1).max(100),
            csrfToken: z.string().length(64),
          }),
          socket.handshake.auth,
        );
        const token = parse(socket.handshake.headers.cookie ?? "")[
          guestCookie(ticketId)
        ];
        const session = await guestAccess(serverId, ticketId, token);
        if (!secretEqual(session.csrfToken, csrfToken))
          throw new HttpError(403, "无效的安全令牌");
        await consumeLimit(`guest-socket:${session.ticketId}`, 60, 60);
        socket.data.guest = session;
        if (stopping) throw new HttpError(503, "连接正在关闭");
        next();
      } catch {
        next(new Error("GUEST_ACCESS_DENIED"));
      }
    })(), "guest authentication");
  });
  guests.on("connection", (socket) => {
    if (stopping) { socket.disconnect(true); return; }
    const session = socket.data.guest as { id: string; expiresAt: Date; };
    void track(Promise.resolve(socket.join(`guest-session:${session.id}`)), "guest room join");
    const expire = setTimeout(
      () => { guestExpiryTimers.delete(expire); socket.disconnect(true); },
      Math.min(2147483647, session.expiresAt.getTime() - Date.now()),
    );
    guestExpiryTimers.add(expire);
    socket.once("disconnect", () => {
      clearTimeout(expire);
      guestExpiryTimers.delete(expire);
    });
    socket.emit("session:ready", { serverTime: Date.now() });
  });
  io.on("connection", (socket) => {
    if (stopping) { socket.disconnect(true); return; }
    const data = socket.data.auth as {
      token: string;
      userId: string;
      sessionId: string;
    };
    connections.set(socket.id, data);
    socket.emit("session:ready", { serverTime: Date.now() });
    void track(Promise.resolve(socket.join([userRoom(data.userId), sessionRoom(data.sessionId)])), "room join");
    void track((async () => {
      await touch(data.userId, socket.id);
      if (!socket.connected) {
        await redis.zrem(key(data.userId), socket.id);
        await updateOffline(data.userId);
        return;
      }
      const connected = await markConnected(data.userId);
      if (!connected) throw new HttpError(401, "登录已失效");
      if (socket.connected)
        await announce(data.userId, connected.status, connected.lastSeenAt);
      else await updateOffline(data.userId);
    })().catch((error) => reject(socket, error)), "connection presence");
    socket.on("typing", (raw: unknown, ack?: unknown) => {
      if (stopping) { reject(socket, new HttpError(503, "连接正在关闭"), ack); return; }
      void track((async () => {
        try {
          await fresh(socket);
          const input = validate(
            z.object({
              conversationId: z.string().min(1).max(100),
              typing: z.boolean(),
            }),
            raw,
          );
          await assertNotGroupMuted(input.conversationId, data.userId);
          const users = await eventMembers(input.conversationId, data.userId);
          emitUsers(
            users.filter((id) => id !== data.userId),
            "typing",
            { ...input, userId: data.userId },
          );
          respond(ack, { ok: true });
        } catch (error) {
          reject(socket, error, ack);
        }
      })(), "typing");
    });
    socket.on("presence:set", (raw: unknown, ack?: unknown) => {
      if (stopping) { reject(socket, new HttpError(503, "连接正在关闭"), ack); return; }
      void track((async () => {
        try {
          await fresh(socket);
          await consumeLimit(`presence:${data.userId}`, 30, 60);
          const { status } = validate(
            z.object({ status: z.enum(["ONLINE", "BUSY"]) }),
            raw,
          );
          const changed = await prisma.user.updateMany({
            where: { id: data.userId, banned: false },
            data: { status },
          });
          if (!changed.count) throw new HttpError(401, "登录已失效");
          const updated = await prisma.user.findUniqueOrThrow({
            where: { id: data.userId },
            select: { lastSeenAt: true },
          });
          await announce(data.userId, status, updated.lastSeenAt);
          respond(ack, { ok: true });
        } catch (error) {
          reject(socket, error, ack);
        }
      })(), "presence change");
    });
    socket.on("disconnect", () => {
      connections.delete(socket.id);
      void track(
        redis.zrem(key(data.userId), socket.id).then(() => updateOffline(data.userId)),
        "disconnect presence",
      );
    });
  });
  timer = setInterval(() => {
    if (stopping) return;
    for (const [socketId, data] of connections) {
      const socket = io?.sockets.sockets.get(socketId);
      if (socket)
        void track(
          fresh(socket).then(() => touch(data.userId, socketId)).catch((error) => reject(socket, error)),
          "presence heartbeat",
        );
    }
  }, 20_000);
  timer.unref();
  sweepTimer = setInterval(() => {
    if (stopping) return;
    void track(
      redis.smembers(activeUsersKey).then((users) => Promise.all(users.map(updateOffline))),
      "presence sweep",
    );
  }, 30_000);
  sweepTimer.unref();
  return io;
}
export function closeRealtime(): Promise<void> {
  if (closePromise) return closePromise;
  stopping = true;
  if (timer) clearInterval(timer);
  if (sweepTimer) clearInterval(sweepTimer);
  timer = undefined;
  sweepTimer = undefined;
  for (const expire of guestExpiryTimers) clearTimeout(expire);
  guestExpiryTimers.clear();
  const current = io;
  closePromise = (async () => {
    // Disconnect locally first: each disconnect schedules presence cleanup.
    // Keep the adapter and shared Redis client available until that work drains.
    if (current) {
      for (const namespace of [current.sockets, current.of("/guest-tickets")])
        for (const socket of namespace.sockets.values()) socket.disconnect(true);
    }
    await drain();
    if (current) await current.close();
    // Adapter.close() starts unsubscribe commands without returning promises.
    await drain();
    connections.clear();
    const results = await Promise.allSettled([publisher?.quit(), subscriber?.quit()]);
    await drain();
    publisher = undefined;
    subscriber = undefined;
    io = undefined;
    const errors = [...taskFailures, ...results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map(r => r.reason)];
    taskFailures.length = 0;
    if (errors.length) throw new AggregateError(errors, "Realtime shutdown failed");
  })();
  return closePromise;
}
