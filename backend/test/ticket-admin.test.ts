import { beforeAll, afterAll, it, expect } from "vitest";
import request from "supertest";
import { createServer } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { io, type Socket } from "socket.io-client";

const db = process.env.TEST_DATABASE_URL,
  cache = process.env.TEST_REDIS_URL;
if (
  !db ||
  !new URL(db).pathname.endsWith("_test") ||
  !cache ||
  new URL(cache).pathname !== "/9"
)
  throw Error("Dedicated _test database and Redis /9 required");
Object.assign(process.env, {
  DATABASE_URL: db,
  REDIS_URL: cache,
  NODE_ENV: "test",
  APP_ORIGIN: "https://chat.6hx9.com",
  COOKIE_SECURE: "false",
  TRUST_PROXY: "0",
});
const origin = "https://chat.6hx9.com",
  prefix = `ta${Date.now().toString(36)}`;
let app: any,
  prisma: any,
  redis: any,
  realtime: any,
  http: ReturnType<typeof createServer>,
  base: string;
let owner: any,
  first: any,
  second: any,
  member: any,
  a: any,
  b: any,
  guestTicket: any,
  guestCookie: string,
  guestCsrf: string;
const sockets: Socket[] = [];
function call(p: any, method: string, path: string, data?: any) {
  const r = (request(app) as any)
    [method](`/api${path}`)
    .set("Origin", origin)
    .set("Cookie", p?.cookie || "")
    .set("X-CSRF-Token", p?.csrfToken || "");
  return data === undefined ? r : r.send(data);
}
function guest(method: string, path: string, data?: any) {
  return call(
    { cookie: guestCookie, csrfToken: guestCsrf },
    method,
    `/guest/${a.id}/tickets/${guestTicket.id}${path}`,
    data,
  );
}
async function register(name: string) {
  const r = await call(null, "post", "/auth/register", {
    username: prefix + name,
    email: `${prefix}${name}@example.test`,
    password: "Admin-tickets-Test-123!",
    displayName: name,
  });
  expect(r.status).toBe(201);
  return { ...r.body, cookie: r.headers["set-cookie"][0].split(";")[0] };
}
async function role(p: any, value: string) {
  return call(owner, "patch", `/servers/${a.id}/members/${p.user.id}`, {
    role: value,
  });
}
async function create(ownerOnly = false) {
  const r = await call(member, "post", `/servers/${a.id}/tickets`, {
    clientId: randomUUID(),
    ownerOnly,
    subject: "Private subject never in claim queue",
    category: "Support",
    content: "Private first message",
  });
  expect(r.status).toBe(201);
  return r.body;
}
async function send(p: any, t: any, content: string) {
  return call(p, "post", `/conversations/${t.conversationId}/messages`, {
    content,
    clientId: randomUUID(),
  });
}
async function connect(p: any) {
  const s = io(base, {
    transports: ["websocket"],
    reconnection: false,
    auth: { csrfToken: p.csrfToken },
    extraHeaders: { Origin: origin, Cookie: p.cookie },
  });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once("connect", resolve);
    s.once("connect_error", reject);
  });
  await s.timeout(3000).emitWithAck("presence:set", { status: "ONLINE" });
  return s;
}
beforeAll(async () => {
  ({ default: app } = await import("../src/app.js"));
  ({ prisma, redis } = await import("../src/context.js"));
  const keys = await redis.keys("harbor:limit:*");
  if (keys.length) await redis.del(...keys);
  realtime = await import("../src/realtime.js");
  http = createServer(app);
  await realtime.initRealtime(http);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(http.address() as any).port}`;
  owner = await register("owner");
  first = await register("first");
  second = await register("second");
  member = await register("member");
  a = (
    await call(owner, "post", "/servers", { name: "Admin test community A" })
  ).body;
  b = (
    await call(owner, "post", "/servers", { name: "Admin test community B" })
  ).body;
  for (const server of [a, b]) {
    const invite = await call(owner, "post", `/servers/${server.id}/invites`, {
      hours: 1,
      maxUses: 10,
    });
    for (const p of [first, second, member])
      expect(
        (await call(p, "post", `/invites/${invite.body.token}/join`, {}))
          .status,
      ).toBe(200);
  }
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await realtime?.closeRealtime();
  if (http?.listening)
    await new Promise<void>((resolve) => http.close(() => resolve()));
  await prisma?.$disconnect();
  redis?.disconnect();
});

it("appoints community-local admins, denies self-promotion and global access, and audits both decisions", async () => {
  const s = await connect(first),
    changed: any[] = [];
  s.on("server:updated", (x) => changed.push(x));
  expect((await role(first, "ADMIN")).status).toBe(200);
  expect((await role(second, "ADMIN")).status).toBe(200);
  expect((await call(first, "get", `/servers/${a.id}`)).body.role).toBe(
    "ADMIN",
  );
  expect((await call(first, "get", `/servers/${b.id}`)).body.role).toBe(
    "MEMBER",
  );
  expect(
    (
      await call(first, "patch", `/servers/${a.id}/members/${second.user.id}`, {
        role: "ADMIN",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(first, "patch", `/servers/${a.id}/members/${first.user.id}`, {
        role: "ADMIN",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(first, "patch", `/servers/${a.id}/members/${owner.user.id}`, {
        role: "MEMBER",
      })
    ).status,
  ).toBe(403);
  expect((await call(first, "get", "/admin/users")).status).toBe(403);
  await s.timeout(3000).emitWithAck("presence:set", { status: "ONLINE" });
  expect(changed.some((x) => x.id === a.id || x.serverId === a.id)).toBe(true);
  expect(
    await prisma.adminAction.count({
      where: {
        actorId: owner.user.id,
        targetId: first.user.id,
        action: "SERVER_ADMIN_APPOINT",
      },
    }),
  ).toBe(1);
});
it("requires owner opt-in, exposes only redacted claim metadata, and atomically awards one of two claims", async () => {
  const open = await create(),
    privateOnly = await create(true);
  expect(
    (await call(first, "get", `/servers/${a.id}/tickets/claimable`)).status,
  ).toBe(403);
  expect(
    (
      await call(first, "patch", `/servers/${a.id}/ticket-settings`, {
        privateTicketsEnabled: true,
        guestTicketsEnabled: false,
        adminTicketClaimEnabled: true,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(owner, "patch", `/servers/${a.id}/ticket-settings`, {
        privateTicketsEnabled: true,
        guestTicketsEnabled: true,
        adminTicketClaimEnabled: true,
      })
    ).status,
  ).toBe(200);
  const queue = await call(
    first,
    "get",
    `/servers/${a.id}/tickets/claimable?limit=1`,
  );
  expect(queue.status).toBe(200);
  expect(queue.body.tickets[0].id).toBe(open.id);
  expect(Object.keys(queue.body.tickets[0]).sort()).toEqual([
    "category",
    "createdAt",
    "id",
    "number",
  ]);
  expect(JSON.stringify(queue.body)).not.toContain("Private");
  expect((await call(first, "get", `/tickets/${open.id}`)).status).toBe(403);
  expect(
    (await call(first, "post", `/tickets/${privateOnly.id}/claim`, {})).status,
  ).toBe(404);
  const results = await Promise.all([
    call(first, "post", `/tickets/${open.id}/claim`, {}),
    call(second, "post", `/tickets/${open.id}/claim`, {}),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const winner = results[0].status === 200 ? first : second,
    loser = winner === first ? second : first;
  expect((await call(winner, "get", `/tickets/${open.id}`)).status).toBe(200);
  expect((await call(loser, "get", `/tickets/${open.id}`)).status).toBe(403);
  expect(
    (await call(first, "get", `/servers/${b.id}/tickets/claimable`)).status,
  ).toBe(403);
  expect(
    (await call(first, "get", `/servers/${b.id}/tickets?assigned=1`)).body
      .tickets,
  ).toEqual([]);
  expect(
    (
      await call(first, "get", `/servers/${a.id}/tickets/claimable`)
    ).body.tickets.some((t: any) => t.id === privateOnly.id),
  ).toBe(false);
});
it("requires the participant to approve the exact handler before an owner-only handoff", async () => {
  const t = await create(true);
  expect(
    (
      await call(owner, "patch", `/tickets/${t.id}`, {
        assigneeId: first.user.id,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(owner, "patch", `/tickets/${t.id}`, {
        requestAssigneeId: first.user.id,
      })
    ).status,
  ).toBe(200);
  expect((await call(first, "get", `/tickets/${t.id}`)).status).toBe(403);
  expect(
    (
      await call(owner, "patch", `/tickets/${t.id}`, {
        handoffConsent: "APPROVE",
        expectedAssigneeId: first.user.id,
      })
    ).status,
  ).toBe(403);
  await call(owner, "patch", `/tickets/${t.id}`, {
    requestAssigneeId: second.user.id,
  });
  expect(
    (
      await call(member, "patch", `/tickets/${t.id}`, {
        handoffConsent: "APPROVE",
        expectedAssigneeId: first.user.id,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(member, "patch", `/tickets/${t.id}`, {
        handoffConsent: "APPROVE",
        expectedAssigneeId: second.user.id,
      })
    ).status,
  ).toBe(200);
  expect((await send(second, t, "Assigned handler reply")).status).toBe(201);
  expect((await call(first, "get", `/tickets/${t.id}`)).status).toBe(403);
  expect(
    await prisma.ticketHandoffConsent.count({
      where: {
        ticketId: t.id,
        userId: member.user.id,
        assigneeId: second.user.id,
        approved: true,
      },
    }),
  ).toBe(1);
  expect(
    (
      await call(first, "get", `/servers/${a.id}/tickets/claimable`)
    ).body.tickets.some((q: any) => q.id === t.id),
  ).toBe(false);
});
it("assigns a guest ticket, persists replies after refresh, and closes/reopens the original history", async () => {
  const recoveryCode = randomBytes(32).toString("hex");
  const created = await call(null, "post", `/guest/${a.id}/tickets`, {
    clientId: randomUUID(),
    displayName: "Temporary guest",
    subject: "Guest test",
    content: "Guest opening",
    recoveryCode,
    ownerOnly: true,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  guestTicket = created.body.ticket;
  guestCsrf = created.body.csrfToken;
  guestCookie = created.headers["set-cookie"][0].split(";")[0];
  expect(
    (
      await call(owner, "patch", `/tickets/${guestTicket.id}`, {
        requestAssigneeId: first.user.id,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await guest("post", "/handoff", {
        decision: "APPROVE",
        expectedAssigneeId: first.user.id,
      })
    ).status,
  ).toBe(200);
  expect(
    (await send(first, guestTicket, "Administrator response to guest")).status,
  ).toBe(201);
  const before = await guest("get", "/messages");
  expect(before.status).toBe(200);
  expect(JSON.stringify(before.body)).toContain(
    "Administrator response to guest",
  );
  expect((await guest("get", "")).body.ticket.id).toBe(guestTicket.id);
  expect(
    (
      await call(first, "get", `/servers/${a.id}/tickets?assigned=1`)
    ).body.tickets.some((t: any) => t.id === guestTicket.id),
  ).toBe(true);
  expect(
    (
      await call(first, "patch", `/tickets/${guestTicket.id}`, {
        status: "CLOSED",
      })
    ).status,
  ).toBe(200);
  expect((await send(first, guestTicket, "Closed denied")).status).toBe(403);
  const reopened = await call(first, "patch", `/tickets/${guestTicket.id}`, {
    status: "OPEN",
  });
  expect(reopened.body.status).toBe("IN_PROGRESS");
  expect(reopened.body.conversationId).toBe(guestTicket.conversationId);
  expect((await guest("get", "/messages")).body.messages).toHaveLength(
    before.body.messages.length,
  );
});
it("revokes active delivery, search, files and sends even when a custom role still grants ticket handling", async () => {
  await role(first, "MEMBER");
  const custom = await call(owner, "post", `/servers/${a.id}/roles`, {
    name: "Additional ticket handler",
    permissions: { handleTickets: true },
  });
  expect(custom.status).toBe(201);
  expect(
    (
      await call(
        owner,
        "put",
        `/servers/${a.id}/roles/${custom.body.id}/members`,
        { userIds: [first.user.id] },
      )
    ).status,
  ).toBe(200);
  await role(first, "ADMIN");
  await call(owner, "patch", `/tickets/${guestTicket.id}`, {
    requestAssigneeId: first.user.id,
  });
  await guest("post", "/handoff", {
    decision: "APPROVE",
    expectedAssigneeId: first.user.id,
  });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKAAAAABJRU5ErkJggg==",
    "base64",
  );
  const upload = await request(app)
    .post(`/api/uploads?conversationId=${guestTicket.conversationId}`)
    .set("Origin", origin)
    .set("Cookie", first.cookie)
    .set("X-CSRF-Token", first.csrfToken)
    .attach("file", png, { filename: "private.png", contentType: "image/png" });
  expect(upload.status).toBe(201);
  await call(
    first,
    "post",
    `/conversations/${guestTicket.conversationId}/messages`,
    {
      content: "Handler attachment",
      attachmentIds: [upload.body.id],
      clientId: randomUUID(),
    },
  );
  const watcher = await connect(first),
    seen: any[] = [];
  watcher.on("message:new", (v) => seen.push(v));
  expect((await role(first, "MEMBER")).status).toBe(200);
  expect((await call(first, "get", `/tickets/${guestTicket.id}`)).status).toBe(
    403,
  );
  expect(
    (
      await call(
        first,
        "get",
        `/conversations/${guestTicket.conversationId}/search?q=Handler`,
      )
    ).status,
  ).toBe(403);
  expect((await call(first, "get", `/uploads/${upload.body.id}`)).status).toBe(
    403,
  );
  expect((await send(first, guestTicket, "Revoked denied")).status).toBe(403);
  const ack = await watcher
    .timeout(3000)
    .emitWithAck("typing", {
      conversationId: guestTicket.conversationId,
      typing: true,
    });
  expect(ack.error).toBeTruthy();
  expect(
    (await send(owner, guestTicket, "Owner continues after revocation")).status,
  ).toBe(201);
  // Wait for the same real delivery path on an authorized recipient, then fence
  // the revoked connection; a stale captured recipient list must not win.
  const { deliverConversation } = await import("../src/realtime.js");
  await deliverConversation(
    [first.user.id],
    "message:new",
    { conversationId: guestTicket.conversationId, id: "stale-recipient-test" },
    guestTicket.conversationId,
  );
  await watcher.timeout(3000).emitWithAck("presence:set", { status: "ONLINE" });
  expect(
    seen.some((m) => m.conversationId === guestTicket.conversationId),
  ).toBe(false);
  const stored = await prisma.ticket.findUnique({
    where: { id: guestTicket.id },
  });
  expect(stored.assigneeId).toBeNull();
  expect(stored.status).toBe("OPEN");
  expect(
    (await guest("get", "/messages")).body.messages.some(
      (m: any) => m.content === "Owner continues after revocation",
    ),
  ).toBe(true);
  expect(
    await prisma.adminAction.count({
      where: { targetId: first.user.id, action: "SERVER_ADMIN_REVOKE" },
    }),
  ).toBeGreaterThan(0);
});
