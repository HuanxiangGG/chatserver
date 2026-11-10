import { beforeAll, afterAll, it, expect } from "vitest";
import request from "supertest";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
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
  prefix = `cc${Date.now().toString(36)}`;
let app: any,
  prisma: any,
  redis: any,
  realtime: any,
  http: ReturnType<typeof createServer>,
  base: string,
  owner: any,
  a: any,
  b: any,
  s1: any,
  s2: any,
  hall: any,
  guide: any,
  trade: any,
  ticket: any,
  csrf: string,
  cookie: string,
  memberTicket: any,
  attachment: any;
const sockets: Socket[] = [];
const recovery = randomBytes(32).toString("hex");
function api(p?: any) {
  const call = (method: string, path: string, body?: any) => {
    const r = (request(app) as any)
      [method](`/api${path}`)
      .set("Origin", origin)
      .set("Cookie", p?.cookie || "")
      .set("X-CSRF-Token", p?.csrfToken || "");
    return body === undefined ? r : r.send(body);
  };
  return {
    get: (p: string) => call("get", p),
    post: (p: string, b: any = {}) => call("post", p, b),
    patch: (p: string, b: any) => call("patch", p, b),
    put: (p: string, b: any) => call("put", p, b),
    delete: (p: string) => call("delete", p),
  };
}
function guest(
  path: string,
  method = "get",
  body?: any,
  c = cookie,
  token = csrf,
) {
  const r = (request(app) as any)
    [method](`/api/guest${path}`)
    .set("Origin", origin)
    .set("Cookie", c || "")
    .set("X-CSRF-Token", token || "");
  return body === undefined ? r : r.send(body);
}
async function register(name: string) {
  const r = await api().post("/auth/register", {
    username: prefix + name,
    email: `${prefix}${name}@example.test`,
    password: "Controls-test-123!safe",
    displayName: name,
  });
  expect(r.status).toBe(201);
  return { ...r.body, cookie: r.headers["set-cookie"][0].split(";")[0] };
}
async function send(p: any, conv: string, content = "hello") {
  return api(p).post(`/conversations/${conv}/messages`, {
    content,
    clientId: randomUUID(),
  });
}
async function connectGuest(
  serverId = s1.id,
  ticketId = ticket.id,
  c = cookie,
  token = csrf,
) {
  const s = io(`${base}/guest-tickets`, {
    forceNew: true,
    transports: ["websocket"],
    reconnection: false,
    auth: { serverId, ticketId, csrfToken: token },
    extraHeaders: { Origin: origin, Cookie: c },
  });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once("connect", resolve);
    s.once("connect_error", reject);
  });
  return s;
}
async function settings(enabled = true, guests = true, server = s1, p = owner) {
  return api(p).patch(`/servers/${server.id}/ticket-settings`, {
    privateTicketsEnabled: enabled,
    guestTicketsEnabled: guests,
  });
}
beforeAll(async () => {
  ({ default: app } = await import("../src/app.js"));
  ({ prisma, redis } = await import("../src/context.js"));
  const keys = await redis.keys("harbor:limit:*");
  if (keys.length) await redis.del(...keys);
  realtime = await import("../src/realtime.js");
  http = createServer(app);
  await realtime.initRealtime(http);
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(http.address() as any).port}`;
  owner = await register("owner");
  a = await register("a");
  b = await register("b");
  s1 = (await api(owner).post("/servers", { name: "Community A" })).body;
  s2 = (await api(owner).post("/servers", { name: "Community B" })).body;
  hall = (await api(owner).get(`/servers/${s1.id}`)).body.channels[0];
  guide = (
    await api(owner).post(`/servers/${s1.id}/channels`, { name: "攻略" })
  ).body;
  trade = (
    await api(owner).post(`/servers/${s1.id}/channels`, { name: "交易" })
  ).body;
  const invite = (
    await api(owner).post(`/servers/${s1.id}/invites`, {
      hours: 1,
      maxUses: 10,
    })
  ).body;
  for (const p of [a, b])
    expect((await api(p).post(`/invites/${invite.token}/join`)).status).toBe(
      200,
    );
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await realtime?.closeRealtime();
  if (http?.listening) await new Promise<void>((r) => http.close(() => r()));
  await prisma?.$disconnect();
  redis?.disconnect();
});
it("preserves member tickets by default and never automatically enables guests", async () => {
  expect(s1.privateTicketsEnabled).toBe(true);
  expect(s1.guestTicketsEnabled).toBe(false);
  const r = await api(a).post(`/servers/${s1.id}/tickets`, {
    clientId: randomUUID(),
    subject: "Existing",
    category: "GENERAL",
    content: "keep history",
  });
  expect(r.status).toBe(201);
  memberTicket = r.body;
  expect((await guest(`/${s1.id}`)).body.canCreate).toBe(false);
  expect((await settings(true, true, s1, a)).status).toBe(403);
});
it("owner controls creation only, while existing participants can still work", async () => {
  expect((await settings(false, false)).status).toBe(200);
  expect(
    (
      await api(a).post(`/servers/${s1.id}/tickets`, {
        clientId: randomUUID(),
        subject: "blocked",
        category: "GENERAL",
        content: "blocked",
      })
    ).status,
  ).toBe(403);
  expect((await send(a, memberTicket.conversationId)).status).toBe(201);
  expect(
    (
      await api(owner).patch(`/tickets/${memberTicket.id}`, {
        status: "CLOSED",
      })
    ).status,
  ).toBe(200);
  expect(
    (await api(owner).patch(`/tickets/${memberTicket.id}`, { status: "OPEN" }))
      .status,
  ).toBe(200);
  expect((await settings(false, true)).status).toBe(400);
  expect((await settings()).status).toBe(200);
  expect(
    (await api(owner).get(`/servers/${s1.id}`)).body.guestTicketsEnabled,
  ).toBe(true);
  expect((await guest(`/${s2.id}`)).body.canCreate).toBe(false);
});
it("creates one guest ticket with no User or ServerMember and hashes its recovery code", async () => {
  const users = await prisma.user.count(),
    members = await prisma.serverMember.count();
  const body = {
    clientId: randomUUID(),
    displayName: "临时小林",
    subject: "Guest secret title",
    content: "GUEST_SECRET_FIRST",
    recoveryCode: recovery,
  };
  const first = await guest(`/${s1.id}/tickets`, "post", body, "", "");
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  ticket = first.body.ticket;
  csrf = first.body.csrfToken;
  cookie = first.headers["set-cookie"][0].split(";")[0];
  expect(first.headers["set-cookie"][0]).toContain("HttpOnly");
  expect(first.headers["set-cookie"][0]).toContain("SameSite=Lax");
  expect(first.headers["cache-control"]).toBe("no-store");
  const again = await guest(`/${s1.id}/tickets`, "post", body);
  expect(again.body.ticket.id).toBe(ticket.id);
  expect(await prisma.user.count()).toBe(users);
  expect(await prisma.serverMember.count()).toBe(members);
  const stored = await prisma.ticket.findUnique({ where: { id: ticket.id } });
  expect(stored.memberId).toBeNull();
  expect(stored.recoveryHash).not.toBe(recovery);
  expect(stored.recoveryHash).toHaveLength(64);
  expect(JSON.stringify(first.body)).not.toContain("recovery");
});
it("ID alone is not authorization and A credentials cannot access B, channels, users or human APIs", async () => {
  const sameName = await guest(`/${s1.id}/tickets`, "post", {
    clientId: randomUUID(), displayName: "临时小林", subject: "Another visitor",
    content: "A separate identity", recoveryCode: randomBytes(32).toString("hex"),
  }, "", "");
  expect(sameName.status).toBe(201);
  expect(sameName.body.ticket.id).not.toBe(ticket.id);
  expect((await guest(`/${s1.id}/tickets/${sameName.body.ticket.id}`)).status).toBe(404);
  const denied = await guest(
    `/${s1.id}/tickets/${ticket.id}`,
    "get",
    undefined,
    "",
    "",
  );
  expect(denied.status).toBe(404);
  expect((await guest(`/${s2.id}/tickets/${ticket.id}`)).status).toBe(404);
  expect((await guest(`/${s1.id}/tickets/not-a-ticket`)).body).toEqual(
    denied.body,
  );
  expect(
    (
      await api({ cookie }).get(
        `/conversations/${hall.conversationId}/messages`,
      )
    ).status,
  ).toBe(401);
  expect((await api({ cookie }).get(`/servers/${s1.id}`)).status).toBe(401);
  expect((await api({ cookie }).get("/users?q=owner")).status).toBe(401);
  expect((await api(b).get(`/tickets/${ticket.id}`)).status).toBe(403);
  expect(
    (await api(b).get(`/servers/${s1.id}/tickets?q=Guest`)).body.tickets,
  ).toHaveLength(0);
  expect(
    (await api(b).get(`/conversations/${ticket.conversationId}/messages`))
      .status,
  ).toBe(403);
});
it("recovers the original history on another device, with generic errors for invalid credentials", async () => {
  const bad = await guest(
    `/${s1.id}/recover`,
    "post",
    { ticketId: ticket.id, recoveryCode: "0".repeat(64) },
    "",
    "",
  );
  expect(bad.status).toBe(404);
  expect(
    (
      await guest(
        `/${s2.id}/recover`,
        "post",
        { ticketId: ticket.id, recoveryCode: recovery },
        "",
        "",
      )
    ).body,
  ).toEqual(bad.body);
  const r = await guest(
    `/${s1.id}/recover`,
    "post",
    { ticketId: ticket.id, recoveryCode: recovery },
    "",
    "",
  );
  expect(r.status).toBe(200);
  expect(r.body.ticket.id).toBe(ticket.id);
  cookie = r.headers["set-cookie"][0].split(";")[0];
  csrf = r.body.csrfToken;
  expect(
    (await guest(`/${s1.id}/tickets/${ticket.id}/messages`)).body.messages[0]
      .content,
  ).toBe("GUEST_SECRET_FIRST");
});
it("guest writes enforce CSRF and Origin while owner lists contain no recovery hashes", async () => {
  expect(
    (
      await guest(
        `/${s1.id}/tickets/${ticket.id}/messages`,
        "post",
        { content: "x", clientId: randomUUID() },
        cookie,
        "wrong",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .post(`/api/guest/${s1.id}/recover`)
        .set("Origin", "https://evil.test")
        .send({ ticketId: ticket.id, recoveryCode: recovery })
    ).status,
  ).toBe(403);
  const list = await api(owner).get(`/servers/${s1.id}/tickets`);
  expect(JSON.stringify(list.body)).not.toContain("recovery");
  expect(
    JSON.stringify((await api(owner).get("/conversations")).body),
  ).not.toContain("recovery");
});
it("guest and owner share one real message stream, duplicate retry is idempotent and reply works", async () => {
  const ownerSocket = io(base, {
    transports: ["websocket"],
    auth: { csrfToken: owner.csrfToken },
    extraHeaders: { Origin: origin, Cookie: owner.cookie },
    reconnection: false,
  });
  sockets.push(ownerSocket);
  await new Promise<void>((r, j) => {
    ownerSocket.once("connect", r);
    ownerSocket.once("connect_error", j);
  });
  const guestSocket = await connectGuest();
  const ownerEvent = new Promise<any>((r) =>
    ownerSocket.once("message:new", r),
  );
  const input = { clientId: randomUUID(), content: "guest live" };
  const sent = await guest(
    `/${s1.id}/tickets/${ticket.id}/messages`,
    "post",
    input,
  );
  expect(sent.status).toBe(201);
  expect((await ownerEvent).id).toBe(sent.body.id);
  expect(
    (await guest(`/${s1.id}/tickets/${ticket.id}/messages`, "post", input)).body
      .id,
  ).toBe(sent.body.id);
  const changed = new Promise<any>((r) =>
    guestSocket.once("ticket:changed", r),
  );
  const reply = await api(owner).post(
    `/conversations/${ticket.conversationId}/messages`,
    { content: "owner live", clientId: randomUUID(), replyToId: sent.body.id },
  );
  expect(reply.status, JSON.stringify(reply.body)).toBe(201);
  await changed;
  const history = await guest(`/${s1.id}/tickets/${ticket.id}/messages`);
  expect(
    history.body.messages.some(
      (m: any) =>
        m.id === reply.body.id && m.replyTo.sender.displayName === "临时小林",
    ),
  ).toBe(true);
  const foreign = await send(owner, hall.conversationId);
  expect(
    (
      await guest(`/${s1.id}/tickets/${ticket.id}/messages`, "post", {
        content: "bad reply",
        clientId: randomUUID(),
        replyToId: foreign.body.id,
      })
    ).status,
  ).toBe(404);
  await expect(connectGuest(s2.id)).rejects.toBeDefined();
  await expect(connectGuest(s1.id, ticket.id, "", csrf)).rejects.toBeDefined();
});
it("validates real MIME and keeps attachment downloads private for both author types", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nb8AAAAASUVORK5CYII=",
    "base64",
  );
  const upload = () =>
    request(app)
      .post(`/api/guest/${s1.id}/tickets/${ticket.id}/uploads`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf);
  expect(
    (
      await upload().attach("file", Buffer.from("<svg/>"), {
        filename: "x.png",
        contentType: "image/png",
      })
    ).status,
  ).toBe(400);
  const r = await upload().attach("file", png, {
    filename: "safe.png",
    contentType: "image/png",
  });
  expect(r.status).toBe(201);
  attachment = r.body;
  expect(
    (
      await guest(`/${s1.id}/tickets/${ticket.id}/messages`, "post", {
        clientId: randomUUID(),
        content: "image",
        attachmentIds: [attachment.id],
      })
    ).status,
  ).toBe(201);
  expect(
    (await guest(`/${s1.id}/tickets/${ticket.id}/files/${attachment.id}`))
      .status,
  ).toBe(200);
  expect(
    (await guest(`/${s2.id}/tickets/${ticket.id}/files/${attachment.id}`))
      .status,
  ).toBe(404);
  expect(
    (
      await guest(
        `/${s1.id}/tickets/${ticket.id}/files/${attachment.id}`,
        "get",
        undefined,
        "",
      )
    ).status,
  ).toBe(404);
  expect((await api(owner).get(`/uploads/${attachment.id}`)).status).toBe(200);
  expect((await api(b).get(`/uploads/${attachment.id}`)).status).toBe(403);
});
it("closing disables guest writes, disabling new guests preserves history and reopening preserves original ID/files", async () => {
  expect(
    (await api(owner).patch(`/tickets/${ticket.id}`, { status: "CLOSED" }))
      .status,
  ).toBe(200);
  expect(
    (
      await guest(`/${s1.id}/tickets/${ticket.id}/messages`, "post", {
        content: "no",
        clientId: randomUUID(),
      })
    ).status,
  ).toBe(403);
  expect((await settings(false, false)).status).toBe(200);
  expect(
    (await guest(`/${s1.id}/tickets/${ticket.id}/files/${attachment.id}`))
      .status,
  ).toBe(200);
  expect(
    (
      await guest(
        `/${s1.id}/recover`,
        "post",
        { ticketId: ticket.id, recoveryCode: recovery },
        "",
        "",
      )
    ).status,
  ).toBe(200);
  expect(
    (await api(owner).patch(`/tickets/${ticket.id}`, { status: "OPEN" }))
      .status,
  ).toBe(200);
  expect(
    (
      await guest(`/${s1.id}/tickets/${ticket.id}/messages`, "post", {
        content: "same original",
        clientId: randomUUID(),
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await guest(`/${s1.id}/tickets`, "post", {
        clientId: randomUUID(),
        displayName: "visitor",
        subject: "blocked",
        content: "blocked",
        recoveryCode: randomBytes(32).toString("hex"),
      })
    ).status,
  ).toBe(403);
});
it("restricts multiple channels, enforces Socket typing, upload and forwarding; other channels and tickets remain writable", async () => {
  const r = await api(owner).put(
    `/servers/${s1.id}/members/${a.user.id}/channel-restrictions`,
    { channelIds: [hall.id, trade.id], minutes: 60, reason: "频道内刷屏" },
  );
  expect(r.status).toBe(200);
  expect((await send(a, hall.conversationId)).status).toBe(403);
  expect((await send(a, trade.conversationId)).status).toBe(403);
  expect((await send(a, guide.conversationId)).status).toBe(201);
  expect((await send(a, memberTicket.conversationId)).status).toBe(201);
  const source = await send(a, guide.conversationId, "Forward source");
  expect(
    (
      await api(a).post(`/conversations/${hall.conversationId}/forward`, {
        sourceIds: [source.body.id],
        clientId: randomUUID(),
        mode: "quote",
      })
    ).status,
  ).toBe(403);
  const original = await send(owner, hall.conversationId, "Reply source");
  expect(
    (
      await api(a).post(`/conversations/${hall.conversationId}/messages`, {
        content: "Reply blocked",
        clientId: randomUUID(),
        replyToId: original.body.id,
      })
    ).status,
  ).toBe(403);
  const detail = await api(a).get(`/conversations/${hall.conversationId}`);
  expect(detail.body.canWrite).toBe(false);
  expect(detail.body.channelRestriction.reason).toBe("频道内刷屏");
  const upload = await request(app)
    .post(`/api/uploads?conversationId=${hall.conversationId}`)
    .set("Origin", origin)
    .set("Cookie", a.cookie)
    .set("X-CSRF-Token", a.csrfToken);
  expect(upload.status).toBe(403);
  const socket = io(base, {
    transports: ["websocket"],
    reconnection: false,
    auth: { csrfToken: a.csrfToken },
    extraHeaders: { Origin: origin, Cookie: a.cookie },
  });
  sockets.push(socket);
  await new Promise<void>((r, j) => {
    socket.once("connect", r);
    socket.once("connect_error", j);
  });
  const ack = await new Promise<any>((r) =>
    socket.emit(
      "typing",
      { conversationId: hall.conversationId, typing: true },
      r,
    ),
  );
  expect(ack.error).toBeDefined();
});
it("removes only selected restrictions and expires restrictions without deleting history", async () => {
  expect(
    (
      await api(owner).put(
        `/servers/${s1.id}/members/${a.user.id}/channel-restrictions`,
        { channelIds: [hall.id], minutes: 0, reason: "" },
      )
    ).status,
  ).toBe(200);
  expect((await send(a, hall.conversationId)).status).toBe(201);
  expect((await send(a, trade.conversationId)).status).toBe(403);
  await prisma.channelRestriction.update({
    where: { channelId_userId: { channelId: trade.id, userId: a.user.id } },
    data: { until: new Date(Date.now() - 1000) },
  });
  expect((await send(a, trade.conversationId)).status).toBe(201);
  expect(
    (
      await api(a).put(
        `/servers/${s1.id}/members/${owner.user.id}/channel-restrictions`,
        { channelIds: [hall.id], minutes: 60, reason: "" },
      )
    ).status,
  ).toBe(403);
});
it("bulk readonly is owner-only, overrides member allow grants and preview has no hidden channels", async () => {
  const role = (
    await api(owner).post(`/servers/${s1.id}/roles`, {
      name: "Can send",
      position: 1,
      permissions: { send: true },
    })
  ).body;
  await api(owner).put(`/servers/${s1.id}/roles/${role.id}/members`, {
    userIds: [a.user.id],
  });
  expect(
    (
      await api(owner).patch(`/servers/${s1.id}/channels-readonly`, {
        channelIds: [hall.id, trade.id],
        readOnly: true,
      })
    ).status,
  ).toBe(200);
  expect((await send(a, hall.conversationId)).status).toBe(403);
  expect((await send(a, guide.conversationId)).status).toBe(201);
  const preview = await api(owner).get(`/servers/${s1.id}/preview`);
  expect(
    preview.body.channels.find((c: any) => c.id === hall.id).permissions.send,
  ).toBe(false);
  expect(
    (
      await api(a).patch(`/servers/${s1.id}/channels-readonly`, {
        channelIds: [hall.id],
        readOnly: false,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await api(owner).patch(`/servers/${s1.id}/channels-readonly`, {
        channelIds: [hall.id],
        readOnly: false,
      })
    ).status,
  ).toBe(200);
  expect((await send(a, hall.conversationId)).status).toBe(201);
  expect((await send(a, trade.conversationId)).status).toBe(403);
});
it("bot install retries are idempotent, members are denied, uninstall revokes all further sends", async () => {
  const bot = (await api(owner).get("/bots/catalog")).body.find(
    (b: any) => b.builtin,
  );
  const input = {
    botId: bot.id,
    channelIds: [hall.id],
    permissions: ["SEND_MESSAGES", "COMMANDS"],
    config: { welcome: "Hello {name}" },
  };
  expect((await api(a).post(`/servers/${s1.id}/bots`, input)).status).toBe(403);
  const first = await api(owner).post(`/servers/${s1.id}/bots`, input),
    again = await api(owner).post(`/servers/${s1.id}/bots`, input);
  expect(first.status).toBe(201);
  expect(again.status).toBe(201);
  expect(again.body.id).toBe(first.body.id);
  expect(
    await prisma.botInstallation.count({
      where: { serverId: s1.id, botId: bot.id },
    }),
  ).toBe(1);
  expect(
    (await api(owner).delete(`/servers/${s1.id}/bots/${first.body.id}`)).status,
  ).toBe(200);
  expect((await api(owner).get(`/servers/${s1.id}/bots`)).body).toHaveLength(0);
  expect(
    (
      await api(owner).get(
        `/servers/${s1.id}/commands?conversationId=${ticket.conversationId}`,
      )
    ).status,
  ).toBe(403);
});
it("guest session expiry revokes reads and realtime even with a valid recovery identity", async () => {
  await prisma.guestTicketSession.updateMany({
    where: { ticketId: ticket.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  expect((await guest(`/${s1.id}/tickets/${ticket.id}`)).status).toBe(404);
  await expect(connectGuest()).rejects.toBeDefined();
});
it("rate limits public recovery without disclosing whether a ticket exists", async () => {
  const statuses:number[]=[];
  for(let i=0;i<12;i++)statuses.push((await guest(`/${s1.id}/recover`, "post", {
    ticketId: i%2 ? ticket.id : "not-a-ticket", recoveryCode:"0".repeat(64),
  }, "", "")).status);
  expect(statuses).toContain(404);
  expect(statuses).toContain(429);
  expect((await guest(`/${s1.id}/recover`, "post", {ticketId:ticket.id,recoveryCode:recovery}, "", "")).status).toBe(429);
});
