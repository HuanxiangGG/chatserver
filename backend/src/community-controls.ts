import { Router } from "express";
import { z } from "zod";
import {
  prisma,
  requireAuth,
  asyncRoute,
  validate,
  HttpError,
} from "./context.js";
import {
  lockServer,
  serverPermission,
  effectiveServerPermissions,
} from "./channel-policy.js";
import { emitUsers } from "./realtime.js";
const router = Router(),
  id = z.string().min(1).max(100);
async function changed(serverId: string) {
  const members = await prisma.serverMember.findMany({
    where: { serverId },
    select: { userId: true },
  });
  emitUsers(
    members.map((m) => m.userId),
    "server:updated",
    { serverId },
  );
  for (const channel of await prisma.channel.findMany({
    where: { serverId },
    select: { conversationId: true },
  }))
    emitUsers(
      members.map((m) => m.userId),
      "conversation:updated",
      { id: channel.conversationId },
    );
}
router.patch(
  "/servers/:id/ticket-settings",
  requireAuth,
  asyncRoute(async (req, res) => {
    const serverId = validate(id, req.params.id),
      input = validate(
        z.strictObject({
          privateTicketsEnabled: z.boolean(),
          guestTicketsEnabled: z.boolean(),
          adminTicketClaimEnabled: z.boolean().optional(),
        }),
        req.body,
      );
    if (!input.privateTicketsEnabled && input.guestTicketsEnabled)
      throw new HttpError(400, "请先启用私密工单", "TICKETS_DISABLED");
    await prisma.$transaction(async (db) => {
      await lockServer(db, serverId);
      await serverPermission(serverId, req.user.id, ["OWNER"], db);
      await db.server.update({ where: { id: serverId }, data: input });
      await db.adminAction.create({
        data: {
          actorId: req.user.id,
          action: "TICKET_SETTINGS",
          targetId: serverId,
          reason: "",
          metadata: input,
        },
      });
    });
    await changed(serverId);
    res.json(input);
  }),
);
router.patch(
  "/servers/:id/channels-readonly",
  requireAuth,
  asyncRoute(async (req, res) => {
    const serverId = validate(id, req.params.id),
      input = validate(
        z.strictObject({
          channelIds: z.array(id).min(1).max(50),
          readOnly: z.boolean(),
        }),
        req.body,
      );
    await prisma.$transaction(async (db) => {
      await lockServer(db, serverId);
      await serverPermission(serverId, req.user.id, ["OWNER"], db);
      const ids = [...new Set(input.channelIds)];
      if (
        (await db.channel.count({ where: { serverId, id: { in: ids } } })) !==
        ids.length
      )
        throw new HttpError(400, "频道不属于此社区", "CHANNEL_SCOPE_INVALID");
      for (const c of await db.channel.findMany({
        where: { id: { in: ids } },
        orderBy: { conversationId: "asc" },
      }))
        await db.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${c.conversationId} FOR UPDATE`;
      await db.channel.updateMany({
        where: { serverId, id: { in: ids } },
        data: { readOnly: input.readOnly },
      });
      await db.adminAction.create({
        data: {
          actorId: req.user.id,
          action: "CHANNELS_READONLY",
          targetId: serverId,
          reason: "",
          metadata: { channelIds: ids, readOnly: input.readOnly },
        },
      });
    });
    await changed(serverId);
    res.json({ ok: true });
  }),
);
router.get(
  "/servers/:id/members/:userId/channel-restrictions",
  requireAuth,
  asyncRoute(async (req, res) => {
    const serverId = validate(id, req.params.id),
      userId = validate(id, req.params.userId);
    await serverPermission(serverId, req.user.id, [
      "OWNER",
      "ADMIN",
      "MODERATOR",
    ]);
    res.json(
      await prisma.channelRestriction.findMany({
        where: {
          userId,
          channel: { serverId },
          OR: [{ until: null }, { until: { gt: new Date() } }],
        },
      }),
    );
  }),
);
router.put(
  "/servers/:id/members/:userId/channel-restrictions",
  requireAuth,
  asyncRoute(async (req, res) => {
    const serverId = validate(id, req.params.id),
      userId = validate(id, req.params.userId),
      input = validate(
        z.strictObject({
          channelIds: z.array(id).min(1).max(50),
          minutes: z.union([
            z.literal(0),
            z.literal(10),
            z.literal(60),
            z.literal(1440),
            z.literal(-1),
          ]),
          reason: z.string().trim().max(300),
        }),
        req.body,
      );
    await prisma.$transaction(async (db) => {
      await lockServer(db, serverId);
      await serverPermission(
        serverId,
        req.user.id,
        ["OWNER", "ADMIN", "MODERATOR"],
        db,
      );
      const actor = await effectiveServerPermissions(serverId, req.user.id, db),
        target = await effectiveServerPermissions(serverId, userId, db);
      if (actor.position <= target.position)
        throw new HttpError(
          403,
          "不能管理同级或更高权限成员",
          "CHANNEL_RESTRICTION_RANK",
        );
      const ids = [...new Set(input.channelIds)];
      if (
        (await db.channel.count({ where: { serverId, id: { in: ids } } })) !==
        ids.length
      )
        throw new HttpError(400, "频道不属于此社区", "CHANNEL_SCOPE_INVALID");
      for (const c of await db.channel.findMany({
        where: { id: { in: ids } },
        orderBy: { conversationId: "asc" },
      }))
        await db.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${c.conversationId} FOR UPDATE`;
      for (const channelId of ids)
        if (input.minutes === 0)
          await db.channelRestriction.deleteMany({
            where: { channelId, userId },
          });
        else
          await db.channelRestriction.upsert({
            where: { channelId_userId: { channelId, userId } },
            create: {
              channelId,
              userId,
              actorId: req.user.id,
              reason: input.reason,
              until:
                input.minutes === -1
                  ? null
                  : new Date(Date.now() + input.minutes * 60000),
            },
            update: {
              actorId: req.user.id,
              reason: input.reason,
              until:
                input.minutes === -1
                  ? null
                  : new Date(Date.now() + input.minutes * 60000),
            },
          });
      await db.adminAction.create({
        data: {
          actorId: req.user.id,
          action: "CHANNEL_MEMBER_RESTRICTION",
          targetId: userId,
          reason: input.reason,
          metadata: { serverId, channelIds: ids, minutes: input.minutes },
        },
      });
    });
    await changed(serverId);
    res.json({ ok: true });
  }),
);
export default router;
