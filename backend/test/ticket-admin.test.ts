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
  expect(created.status).toBe(201);
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
  const ack = await watcher.timeout(3000).emitWithAck("typing", {
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

it("invalidates the bound online guest after a handler loses the community admin role", async () => {
  expect((await role(first, "ADMIN")).status).toBe(200);
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
  const socket = io(`${base}/guest-tickets`, {
    forceNew: true,
    autoConnect: false,
    transports: ["websocket"],
    reconnection: false,
    auth: { serverId: a.id, ticketId: guestTicket.id, csrfToken: guestCsrf },
    extraHeaders: { Origin: origin, Cookie: guestCookie },
  });
  sockets.push(socket);
  const ready = new Promise<void>((resolve, reject) => {
    socket.once("session:ready", resolve);
    socket.once("connect_error", reject);
  });
  socket.connect();
  await ready;
  expect((await guest("get", "")).body.ticket.assigneeId).toBe(first.user.id);
  // Fence the asynchronous invalidations from the preceding handoff before
  // observing a role-only change; no message should be sent to make it refresh.
  const fence = new Promise<void>((resolve) =>
    socket.once("ticket:changed", () => resolve()),
  );
  await realtime.deliverConversation(
    [],
    "ticket:updated",
    { conversationId: guestTicket.conversationId },
    guestTicket.conversationId,
  );
  await fence;
  await new Promise((resolve) => setTimeout(resolve, 250));
  const changed = new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      socket.off("ticket:changed", listener);
      resolve(false);
    }, 1000);
    function listener(v: any) {
      if (v.conversationId === guestTicket.conversationId) {
        clearTimeout(timeout);
        socket.off("ticket:changed", listener);
        resolve(true);
      }
    }
    socket.on("ticket:changed", listener);
  });
  expect((await role(first, "MEMBER")).status).toBe(200);
  expect((await guest("get", "")).body.ticket.assigneeId).toBeNull();
  expect(await changed).toBe(true);
  socket.disconnect();
});

it("refreshes only affected guest tickets after role capability changes, role grants/deletion and member removal", async () => {
  // Reset the first handler's custom-role assignments from the earlier test.
  const roles = (await call(owner, "get", `/servers/${a.id}/roles`)).body;
  for (const r of roles)
    if (r.members.some((m: any) => m.userId === first.user.id))
      expect(
        (
          await call(owner, "put", `/servers/${a.id}/roles/${r.id}/members`, {
            userIds: r.members
              .filter((m: any) => m.userId !== first.user.id)
              .map((m: any) => m.userId),
          })
        ).status,
      ).toBe(200);
  const allow = (
    await call(owner, "post", `/servers/${a.id}/roles`, {
      name: "Guest support",
      position: 10,
      permissions: { handleTickets: true },
    })
  ).body;
  const deny = (
    await call(owner, "post", `/servers/${a.id}/roles`, {
      name: "No guest support",
      position: 40,
      permissions: { handleTickets: false },
    })
  ).body;
  expect(
    (
      await call(owner, "put", `/servers/${a.id}/roles/${allow.id}/members`, {
        userIds: [first.user.id],
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call(owner, "patch", `/servers/${b.id}/ticket-settings`, {
        privateTicketsEnabled: true,
        guestTicketsEnabled: true,
      })
    ).status,
  ).toBe(200);
  async function observer(serverId: string) {
    const created = await call(null, "post", `/guest/${serverId}/tickets`, {
      clientId: randomUUID(),
      displayName: "Unrelated guest",
      subject: "Unrelated private ticket",
      content: "Do not invalidate this ticket",
      recoveryCode: randomBytes(32).toString("hex"),
    });
    expect(created.status).toBe(201);
    return openGuest(
      serverId,
      created.body.ticket,
      created.headers["set-cookie"][0].split(";")[0],
      created.body.csrfToken,
    );
  }
  const primary = await openGuest(a.id, guestTicket, guestCookie, guestCsrf),
    otherA = await observer(a.id),
    otherB = await observer(b.id);
  await fence(primary);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const unrelated: any[] = [];
  otherA.on("ticket:changed", (v) => unrelated.push(v));
  otherB.on("ticket:changed", (v) => unrelated.push(v));
  const attachment = (await guest("get", "/messages")).body.messages
    .flatMap((m: any) => m.attachments)
    .find((file: any) => file.filename === "private.png");
  expect(attachment).toBeTruthy();
  async function assign() {
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
    await fence(primary);
  }
  async function invalidates(action: () => Promise<any>) {
    const changed = nextChanged(primary);
    expect((await action()).status).toBe(200);
    expect(await changed).toEqual({
      conversationId: guestTicket.conversationId,
    });
    expect((await guest("get", "")).body.ticket.assigneeId).toBeNull();
    expect(
      (await call(first, "get", `/tickets/${guestTicket.id}`)).status,
    ).toBe(403);
    expect((await call(first, "get", `/uploads/${attachment.id}`)).status).toBe(
      403,
    );
    expect(
      (await send(first, guestTicket, "Denied after capability change")).status,
    ).toBe(403);
    expect(unrelated).toEqual([]);
  }
  await assign();
  await invalidates(() =>
    call(owner, "patch", `/servers/${a.id}/roles/${allow.id}`, {
      permissions: { handleTickets: false },
    }),
  );
  await call(owner, "patch", `/servers/${a.id}/roles/${allow.id}`, {
    permissions: { handleTickets: true },
  });
  await assign();
  await invalidates(() =>
    call(owner, "put", `/servers/${a.id}/roles/${deny.id}/members`, {
      userIds: [first.user.id],
    }),
  );
  await call(owner, "put", `/servers/${a.id}/roles/${deny.id}/members`, {
    userIds: [],
  });
  await assign();
  await invalidates(() =>
    call(owner, "put", `/servers/${a.id}/roles/${allow.id}/members`, {
      userIds: [],
    }),
  );
  await call(owner, "put", `/servers/${a.id}/roles/${allow.id}/members`, {
    userIds: [first.user.id],
  });
  await assign();
  await invalidates(() =>
    call(owner, "delete", `/servers/${a.id}/roles/${allow.id}`),
  );
  await role(first, "ADMIN");
  await assign();
  await invalidates(() =>
    call(owner, "delete", `/servers/${a.id}/members/${first.user.id}`),
  );
  expect((await call(first, "get", `/servers/${b.id}`)).body.role).toBe(
    "MEMBER",
  );
  for (const socket of [primary, otherA, otherB]) socket.disconnect();
});

it("returns real permission-scoped queue previews and reply direction without resurfacing hidden or retracted attachments", async () => {
  const t = await create(true);
  const firstView = await call(owner, "get", `/tickets/${t.id}`);
  expect(firstView.body.lastMessage.content).toBe("Private first message");
  expect(firstView.body.waitingFor).toBe("STAFF");
  const reply = await send(owner, t, "The handler has replied");
  expect(reply.status).toBe(201);
  const list = await call(member, "get", `/servers/${a.id}/tickets`);
  const row = list.body.tickets.find((item: any) => item.id === t.id);
  expect(row.lastMessage.content).toBe("The handler has replied");
  expect(row.waitingFor).toBe("MEMBER");
  expect(new Date(row.lastActivityAt).getTime()).toBeGreaterThanOrEqual(new Date(reply.body.createdAt).getTime());
  expect(row.unreadCount).toBeGreaterThan(0);
  expect((await call(second, "get", `/servers/${a.id}/tickets`)).body.tickets.some((item: any) => item.id === t.id)).toBe(false);
  expect((await call(second, "get", `/tickets/${t.id}`)).status).toBe(403);
  expect((await call(member, "delete", `/messages/${reply.body.id}`)).status).toBe(200);
  const hidden = (await call(member, "get", `/tickets/${t.id}`)).body;
  expect(hidden.lastMessage.content).toBe("Private first message");
  expect(hidden.waitingFor).toBe("MEMBER");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKAAAAABJRU5ErkJggg==", "base64");
  const upload = await request(app).post("/api/uploads").set("Origin", origin).set("Cookie", owner.cookie).set("X-CSRF-Token", owner.csrfToken).attach("file", png, {filename: "evidence-private.png", contentType: "image/png"});
  expect(upload.status).toBe(201);
  const image = await call(owner, "post", `/conversations/${t.conversationId}/messages`, { content: "", attachmentIds: [upload.body.id], clientId: randomUUID() });
  expect(image.status).toBe(201);
  const withImage = (await call(member, "get", `/tickets/${t.id}`)).body;
  expect(withImage.lastMessage.kind).toBe("IMAGE");
  expect(withImage.lastMessage.filename).toBe("evidence-private.png");
  expect((await call(owner, "post", `/messages/${image.body.id}/retract`, {})).status).toBe(200);
  const withdrawn = (await call(member, "get", `/tickets/${t.id}`)).body;
  expect(withdrawn.lastMessage.kind).toBe("RETRACTED");
  expect(withdrawn.lastMessage.content).toBe("");
  expect(withdrawn.lastMessage.filename).toBeUndefined();
  expect((await call(owner, "patch", `/tickets/${t.id}`, {status: "CLOSED"})).status).toBe(200);
  expect((await call(member, "get", `/tickets/${t.id}`)).body.waitingFor).toBeNull();
  const queue = await call(second, "get", `/servers/${a.id}/tickets/claimable`);
  expect(queue.status).toBe(200);
  for (const pending of queue.body.tickets) expect(Object.keys(pending).sort()).toEqual(["category", "createdAt", "id", "number"]);
});

async function openGuest(
  serverId: string,
  ticket: any,
  cookie: string,
  csrfToken: string,
) {
  const socket = io(`${base}/guest-tickets`, {
    forceNew: true,
    autoConnect: false,
    transports: ["websocket"],
    reconnection: false,
    auth: { serverId, ticketId: ticket.id, csrfToken },
    extraHeaders: { Origin: origin, Cookie: cookie },
  });
  sockets.push(socket);
  const ready = new Promise<void>((resolve, reject) => {
    socket.once("session:ready", resolve);
    socket.once("connect_error", reject);
  });
  socket.connect();
  await ready;
  return socket;
}
function nextChanged(socket: Socket) {
  return new Promise<any>((resolve) => {
    const timer = setTimeout(() => {
      socket.off("ticket:changed", onChanged);
      resolve(null);
    }, 1000);
    function onChanged(value: any) {
      clearTimeout(timer);
      socket.off("ticket:changed", onChanged);
      resolve(value);
    }
    socket.on("ticket:changed", onChanged);
  });
}
async function fence(socket: Socket) {
  const changed = nextChanged(socket);
  await realtime.deliverConversation(
    [],
    "ticket:updated",
    { conversationId: guestTicket.conversationId },
    guestTicket.conversationId,
  );
  expect(await changed).toEqual({ conversationId: guestTicket.conversationId });
}
