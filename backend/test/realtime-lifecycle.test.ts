import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { setImmediate as nextTurn } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { io as connect, type Socket } from "socket.io-client";

const database = process.env.TEST_DATABASE_URL;
const cache = process.env.TEST_REDIS_URL;
if (!database || !new URL(database).pathname.endsWith("_test") || !cache || new URL(cache).pathname !== "/9")
  throw new Error("Dedicated _test PostgreSQL and Redis /9 required");
Object.assign(process.env, {
  DATABASE_URL: database, REDIS_URL: cache, NODE_ENV: "test",
  APP_ORIGIN: "https://chat.6hx9.com", COOKIE_SECURE: "false",
});
const origin = "https://chat.6hx9.com";
let app: any, prisma: any, redis: any, realtime: any, person: any;
let http: ReturnType<typeof createServer> | undefined;
let expectedShutdownFailure = false;
const sockets: Socket[] = [];

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function start(intercept?: (client: any) => void) {
  if (intercept) {
    const duplicate = redis.duplicate.bind(redis);
    vi.spyOn(redis, "duplicate").mockImplementation((...args: any[]) => {
      const client = duplicate(...args);
      intercept(client);
      return client;
    });
  }
  http = createServer(app);
  const server = await realtime.initRealtime(http);
  await new Promise<void>(resolve => http!.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${(http.address() as any).port}` };
}
beforeAll(async () => {
  ({ default: app } = await import("../src/app.js"));
  ({ prisma, redis } = await import("../src/context.js"));
  realtime = await import("../src/realtime.js");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const response = await request(app).post("/api/auth/register").set("Origin", origin).send({
    username: `lifecycle_${suffix}`, email: `lifecycle_${suffix}@example.test`,
    displayName: "Lifecycle test", password: `Test-${randomUUID()}-A9!`,
  });
  expect(response.status).toBe(201);
  person = { ...response.body, cookie: response.headers["set-cookie"][0].split(";")[0] };
});
afterEach(async () => {
  try {
    if (expectedShutdownFailure) await expect(realtime.closeRealtime()).rejects.toThrow("Realtime shutdown failed");
    else await realtime.closeRealtime();
  } finally {
    expectedShutdownFailure = false;
    sockets.splice(0).forEach(socket => socket.disconnect());
    vi.restoreAllMocks();
    if (http?.listening) await new Promise<void>(resolve => http!.close(() => resolve()));
    http = undefined;
  }
});
afterAll(async () => {
  await prisma?.$disconnect();
  await redis?.quit();
});

it("drains an adapter publication before closing its clients and shares repeated shutdown calls", async () => {
  const entered = deferred(), release = deferred();
  const marker = `lifecycle-${randomUUID()}`;
  const clients: any[] = [];
  await start(client => {
    clients.push(client);
    const send = client.sendCommand.bind(client);
    client.sendCommand = (command: any, ...args: any[]) => {
      if (command.name === "publish" && Buffer.from(command.args[1]).includes(Buffer.from(marker))) {
        entered.resolve();
        return release.promise.then(() => send(command, ...args));
      }
      return send(command, ...args);
    };
  });
  const quit = clients.map(client => vi.spyOn(client, "quit"));
  realtime.emitUsers([person.user.id], "lifecycle:test", { marker });
  await entered.promise;
  const closing = realtime.closeRealtime();
  let completed = false;
  void closing.then(() => { completed = true; });
  try {
    expect(realtime.closeRealtime()).toBe(closing);
    // An event-loop barrier, not a duration-based sleep: the publication remains
    // deliberately unresolved until this test releases it.
    await nextTurn();
    expect(completed).toBe(false);
    quit.forEach(spy => expect(spy).not.toHaveBeenCalled());
  } finally { release.resolve(); }
  await closing;
  quit.forEach(spy => expect(spy).toHaveBeenCalledOnce());
});

it("waits for disconnect presence cleanup before releasing shared database and cache dependencies", async () => {
  const { url } = await start();
  const socket = connect(url, {
    transports: ["websocket"], reconnection: false, autoConnect: false,
    auth: { csrfToken: person.csrfToken }, extraHeaders: { Cookie: person.cookie, Origin: origin },
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); socket.connect(); });
  expect((await socket.timeout(3000).emitWithAck("presence:set", { status: "ONLINE" })).ok).toBe(true);
  const entered = deferred(), release = deferred();
  const remove = redis.zrem.bind(redis);
  vi.spyOn(redis, "zrem").mockImplementation((...args: any[]) => {
    if (args[0] === `harbor:presence:${person.user.id}`) {
      entered.resolve();
      return release.promise.then(() => remove(...args));
    }
    return remove(...args);
  });
  const closing = realtime.closeRealtime();
  let completed = false;
  void closing.then(() => { completed = true; });
  try {
    await entered.promise;
    await nextTurn();
    expect(completed).toBe(false);
  } finally { release.resolve(); }
  await closing;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: person.user.id } });
  expect(user.status).toBe("OFFLINE");
  expect(await redis.zcard(`harbor:presence:${person.user.id}`)).toBe(0);
});

it("drains a pending conversation authorization read instead of letting it outlive shutdown", async () => {
  await start();
  const entered = deferred(), release = deferred();
  const conversationId = `lifecycle-${randomUUID()}`;
  const read = prisma.ticket.findUnique.bind(prisma.ticket);
  vi.spyOn(prisma.ticket, "findUnique").mockImplementation((input: any) => {
    if (input.where.conversationId === conversationId) {
      entered.resolve();
      return release.promise.then(() => read(input));
    }
    return read(input);
  });
  realtime.emitUsers([person.user.id], "message:new", { id: randomUUID(), conversationId });
  await entered.promise;
  const closing = realtime.closeRealtime();
  let completed = false;
  void closing.then(() => { completed = true; });
  try { await nextTurn(); expect(completed).toBe(false); }
  finally { release.resolve(); }
  await closing;
});

it("reports adapter failure through shutdown without leaking command arguments or leaving a rejected promise unhandled", async () => {
  const entered = deferred(), release = deferred();
  const marker = `lifecycle-failure-${randomUUID()}`;
  await start(client => {
    const send = client.sendCommand.bind(client);
    client.sendCommand = (command: any, ...args: any[]) => {
      if (command.name === "publish" && Buffer.from(command.args[1]).includes(Buffer.from(marker))) {
        entered.resolve();
        return release.promise;
      }
      return send(command, ...args);
    };
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => { });
  realtime.emitUsers([person.user.id], "lifecycle:test", { marker });
  await entered.promise;
  expectedShutdownFailure = true;
  const closing = realtime.closeRealtime();
  const observed = expect(closing).rejects.toThrow("Realtime shutdown failed");
  release.reject(new Error(`Controlled publication failure ${marker}`));
  await observed;
  expect(log).toHaveBeenCalledWith("Realtime adapter command failed");
  expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
});
