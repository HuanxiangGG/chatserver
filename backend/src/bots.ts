import { Router, type Request } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, hashToken, requireAuth, asyncRoute, validate, HttpError, consumeLimit, publicUserSelect } from './context.js';
import { serverCapability, serverMember, lockServer, channelPermission } from './channel-policy.js';
import { messageInclude, serializeMessage } from './chat.js';
import { emitUsers } from './realtime.js';
const router = Router();
const id = z.string().min(1).max(100);
const permissions = z.array(z.enum(['SEND_MESSAGES','READ_MESSAGES','COMMANDS'])).max(3).refine(v => new Set(v).size === v.length);
const settings = z.strictObject({ welcome: z.string().trim().min(1).max(1000).optional(), commands: z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,20}$/)).max(10).optional() });
const safeBot = { id: true, name: true, builtin: true } as const;
const installationSelect = { id: true, botId: true, serverId: true, enabled: true, channelIds: true, permissions: true, config: true, createdAt: true, updatedAt: true, bot: { select: safeBot } } as const;
const asStrings = (value: unknown) => Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string') : [];
async function audit(db: Prisma.TransactionClient, actorId: string, action: string, targetId: string) { await db.adminAction.create({ data: { actorId, action: `BOT_${action}`, targetId, reason: '' } }); }
async function botAuth(req: Request) {
  const header = req.get('Authorization'), token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, '机器人凭证无效', 'BOT_AUTH_INVALID');
  const bot = await prisma.bot.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!bot || bot.builtin || bot.user.banned) throw new HttpError(401, '机器人凭证无效', 'BOT_AUTH_INVALID');
  await consumeLimit(`bot-api:${bot.id}`, 120, 60); return bot;
}
async function builtin() {
  const existing = await prisma.bot.findFirst({ where: { builtin: true }, select: safeBot }); if (existing) return existing;
  return prisma.$transaction(async db => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(724109)`;
    const prior = await db.bot.findFirst({ where: { builtin: true }, select: safeBot }); if (prior) return prior;
    const suffix = randomBytes(8).toString('hex');
    return db.bot.create({ data: { developerId: 'harbor', name: 'Welcome', builtin: true, tokenHash: hashToken(randomBytes(32).toString('hex')), user: { create: { username: `bot_${suffix}`, displayName: 'Welcome', email: `bot_${suffix}@invalid.test`, passwordHash: '!', role: 'BOT' } } }, select: safeBot });
  });
}
async function authorizedInstallation(db: Prisma.TransactionClient, installationId: string, conversationId: string, botId?: string) {
  const installation = await db.botInstallation.findUnique({ where: { id: installationId }, include: { bot: { include: { user: { select: { banned: true } } } } } });
  if (!installation || !installation.enabled || installation.bot.user.banned || (botId && installation.botId !== botId)) throw new HttpError(403, '机器人未获此社区授权', 'BOT_NOT_AUTHORIZED');
  const channel = await db.channel.findUnique({ where: { conversationId } });
  if (!channel || channel.serverId !== installation.serverId || channel.archivedAt || !asStrings(installation.channelIds).includes(channel.id)) throw new HttpError(403, '机器人无权访问此频道', 'BOT_CHANNEL_FORBIDDEN');
  return { installation, channel };
}
async function deliver(message: Prisma.MessageGetPayload<{ include: typeof messageInclude }>) {
  const users = await prisma.conversationMember.findMany({ where: { conversationId: message.conversationId }, select: { userId: true } });
  emitUsers(users.map(u => u.userId), 'message:new', serializeMessage(message));
  emitUsers(users.map(u => u.userId), 'conversation:updated', { id: message.conversationId });
}
async function postBotMessage(installationId: string, conversationId: string, content: string, clientId: string, botId?: string) {
  const installation = await prisma.botInstallation.findUnique({ where: { id: installationId } });
  if (!installation) throw new HttpError(403, '机器人未获此社区授权', 'BOT_NOT_AUTHORIZED');
  await consumeLimit(`bot-send:${installationId}`, 20, 60);
  const message = await prisma.$transaction(async db => {
    // Authorization changes take the same server lock before changing grants.
    await lockServer(db, installation.serverId);
    const access = await authorizedInstallation(db, installationId, conversationId, botId);
    if (!asStrings(access.installation.permissions).includes('SEND_MESSAGES') || access.channel.readOnly) throw new HttpError(403, '机器人没有发言权限', 'BOT_SEND_FORBIDDEN');
    await db.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
    const key = `bot:${installationId}:${clientId}`;
    const old = await db.message.findUnique({ where: { senderId_clientId: { senderId: access.installation.bot.userId, clientId: key } }, include: messageInclude });
    if (old) { if (old.conversationId !== conversationId || old.content !== content) throw new HttpError(409, '机器人消息标识已使用', 'BOT_MESSAGE_CONFLICT'); return { message: old, created: false }; }
    const m = await db.message.create({ data: { senderId: access.installation.bot.userId, conversationId, content, clientId: key }, include: messageInclude });
    await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    return { message: m, created: true };
  });
  if (message.created) await deliver(message.message); return serializeMessage(message.message);
}
// Hooks consume only human channel messages, never tickets, DMs, bot messages, or uploads.
export async function queueBotEvents(message: { id: string; conversationId: string; senderId: string | null; content: string; createdAt: Date }, db: Prisma.TransactionClient = prisma) {
  if (!message.senderId) return;
  const sender = await db.user.findUnique({ where: { id: message.senderId }, select: { role: true, displayName: true } });
  if (!sender || sender.role === 'BOT') return;
  const channel = await db.channel.findUnique({ where: { conversationId: message.conversationId } }); if (!channel || channel.archivedAt) return;
  const installs = await db.botInstallation.findMany({ where: { serverId: channel.serverId, enabled: true, bot: { builtin: false } } });
  for (const install of installs) if (asStrings(install.channelIds).includes(channel.id) && asStrings(install.permissions).includes('READ_MESSAGES')) {
      await db.botEvent.create({ data: { installationId: install.id, type: 'message', payload: { messageId: message.id, channelId: channel.id, conversationId: channel.conversationId, senderId: message.senderId, senderName: sender.displayName, content: message.content, createdAt: message.createdAt.toISOString() } } });
    }
}
export async function welcomeJoined(serverId: string, userId: string) {
  const messages = await prisma.$transaction(async db => {
    await lockServer(db, serverId);
    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
    if (!await db.serverMember.findUnique({ where: { serverId_userId: { serverId, userId } } })) return [];
    const installs = await db.botInstallation.findMany({ where: { serverId, enabled: true, bot: { builtin: true } }, include: { bot: true } });
    const result: Prisma.MessageGetPayload<{ include: typeof messageInclude }>[] = [];
    for (const install of installs) {
      if (!asStrings(install.permissions).includes('SEND_MESSAGES') || await db.botWelcome.findUnique({ where: { installationId_userId: { installationId: install.id, userId } } })) continue;
      const channels = await db.channel.findMany({ where: { id: { in: asStrings(install.channelIds) }, serverId, archivedAt: null, readOnly: false }, orderBy: { id: 'asc' } });
      if (!channels.length) continue;
      const text = (install.config as { welcome?: string }).welcome;
      if (!text) continue;
      await db.botWelcome.create({ data: { installationId: install.id, userId } });
      // One welcome total, even when an installation has several permitted channels.
      const channel = channels[0]!;
      await db.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${channel.conversationId} FOR UPDATE`;
      result.push(await db.message.create({ data: { senderId: install.bot.userId, conversationId: channel.conversationId, content: text.replaceAll('{name}', user.displayName), clientId: `welcome:${install.id}:${userId}` }, include: messageInclude }));
      await db.conversation.update({ where: { id: channel.conversationId }, data: { updatedAt: new Date() } });
    }
    return result;
  });
  for (const message of messages) await deliver(message);
}
router.get('/bot/events', asyncRoute(async (req, res) => {
  const bot = await botAuth(req), after = validate(z.string().max(200).optional(), req.query.after);
  let boundary: { at: string; id: string } | undefined;
  if (after) {
    try { boundary = JSON.parse(Buffer.from(after, 'base64url').toString('utf8')); if (!boundary || !Number.isFinite(Date.parse(boundary.at)) || typeof boundary.id !== 'string' || boundary.id.length > 100) throw Error(); }
    catch { throw new HttpError(400, '机器人事件游标无效', 'BOT_CURSOR_INVALID'); }
  }
  const result = await prisma.$transaction(async db => {
    const initial = await db.botInstallation.findMany({ where: { botId: bot.id }, select: { serverId: true } });
    for (const serverId of [...new Set(initial.map(i => i.serverId))].sort()) await lockServer(db, serverId);
    const installs = await db.botInstallation.findMany({ where: { botId: bot.id, enabled: true } });
    const active = await db.channel.findMany({ where: { serverId: { in: installs.map(i => i.serverId) }, archivedAt: null }, select: { id: true } });
    const where: Prisma.BotEventWhereInput = { installationId: { in: installs.map(i => i.id) }, ...(boundary ? { OR: [{ createdAt: { gt: new Date(boundary.at) } }, { createdAt: new Date(boundary.at), id: { gt: boundary.id } }] } : {}) };
    const rows = await db.botEvent.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100 });
    const events = rows.filter(e => { const p = e.payload as { channelId?: string }; const i = installs.find(i => i.id === e.installationId); return i && active.some(c => c.id === p.channelId) && asStrings(i.channelIds).includes(p.channelId ?? '') && asStrings(i.permissions).includes(e.type === 'command' ? 'COMMANDS' : 'READ_MESSAGES'); });
    const last = rows.at(-1);
    return { events, cursor: last ? Buffer.from(JSON.stringify({ at: last.createdAt.toISOString(), id: last.id })).toString('base64url') : after ?? null };
  });
  res.json(result);
}));
router.post('/bot/messages', asyncRoute(async (req, res) => {
  const bot = await botAuth(req), input = validate(z.strictObject({ installationId: id, conversationId: id, content: z.string().trim().min(1).max(4000), clientId: z.string().min(8).max(100) }), req.body);
  res.status(201).json(await postBotMessage(input.installationId, input.conversationId, input.content, input.clientId, bot.id));
}));
router.use((req, res, next) => /^\/(?:bots(?:\/|$)|servers\/[^/]+\/(?:bots|commands)(?:\/|$))/.test(req.path) ? requireAuth(req, res, next) : next());
router.get('/bots/catalog', asyncRoute(async (_req, res) => { res.json([await builtin(), ...await prisma.bot.findMany({ where: { builtin: false }, select: safeBot, take: 100, orderBy: { createdAt: 'desc' } })]); }));
// Developer CLI only: tokens are returned once, never in list/configuration responses.
router.post('/bots', asyncRoute(async (req, res) => {
  const input = validate(z.strictObject({ name: z.string().trim().min(1).max(64) }), req.body); await consumeLimit(`bot-create:${req.user.id}`, 10, 3600);
  const token = randomBytes(32).toString('hex'), suffix = randomBytes(8).toString('hex');
  const bot = await prisma.bot.create({ data: { name: input.name, developerId: req.user.id, tokenHash: hashToken(token), user: { create: { username: `bot_${suffix}`, email: `bot_${suffix}@invalid.test`, displayName: input.name, passwordHash: '!', role: 'BOT' } } }, select: safeBot });
  res.setHeader('Cache-Control','no-store'); res.status(201).json({ ...bot, token });
}));
router.post('/bots/:id/rotate', asyncRoute(async (req, res) => {
  const botId = validate(id, req.params.id), token = randomBytes(32).toString('hex');
  const changed = await prisma.bot.updateMany({ where: { id: botId, developerId: req.user.id, builtin: false }, data: { tokenHash: hashToken(token) } });
  if (!changed.count) throw new HttpError(403, '不能管理此机器人凭证', 'BOT_DEVELOPER_REQUIRED');
  res.setHeader('Cache-Control','no-store'); res.json({ id: botId, token });
}));
router.get('/servers/:id/bots', asyncRoute(async (req, res) => { const serverId = validate(id, req.params.id); await serverCapability(serverId, req.user.id, 'installBots'); res.json(await prisma.botInstallation.findMany({ where: { serverId }, select: installationSelect })); }));
async function notifyServer(serverId: string) { const members = await prisma.serverMember.findMany({ where: { serverId }, select: { userId: true } }); emitUsers(members.map(m => m.userId), 'server:updated', { serverId }); }
async function validateChannels(db: Prisma.TransactionClient, serverId: string, ids: string[], actorId: string, grants: string[]) {
  if (await db.channel.count({ where: { id: { in: ids }, serverId, archivedAt: null } }) !== new Set(ids).size) throw new HttpError(400, '机器人频道不属于此社区或已归档', 'BOT_CHANNEL_INVALID');
  for (const channel of await db.channel.findMany({ where: { id: { in: ids }, serverId } })) { if (channel.readOnly && grants.some(g => g === 'SEND_MESSAGES' || g === 'COMMANDS')) throw new HttpError(403, '机器人不能在只读频道发言，请选择其他频道或仅授权读取', 'BOT_CHANNEL_READONLY'); const access = await channelPermission(channel.conversationId, actorId, false, db); if (!access || !access.permissions.installBots || (grants.some(g => g === 'SEND_MESSAGES' || g === 'COMMANDS') && !access.permissions.send)) throw new HttpError(403, '机器人没有发言权限', 'BOT_SEND_FORBIDDEN'); }
}
router.post('/servers/:id/bots', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), input = validate(z.strictObject({ botId: id, channelIds: z.array(id).min(1).max(50).refine(v => new Set(v).size === v.length), permissions, config: settings.default({}) }), req.body);
  const installation = await prisma.$transaction(async db => {
    await lockServer(db, serverId); await serverCapability(serverId, req.user.id, 'installBots', db); await validateChannels(db, serverId, input.channelIds, req.user.id, input.permissions);
    const bot = await db.bot.findUnique({ where: { id: input.botId } });
    if (bot?.builtin && !input.config.welcome) throw new HttpError(400, '请填写欢迎语', 'BOT_WELCOME_REQUIRED');
    if (!bot) throw new HttpError(404, '机器人不存在', 'BOT_NOT_FOUND');
    const prior = await db.botInstallation.findUnique({ where: { botId_serverId: { botId: input.botId, serverId } }, select: installationSelect });
    if (prior) return prior;
    if (await db.botInstallation.count({ where: { serverId } }) >= 20) throw new HttpError(400, '机器人数量已达上限', 'BOT_LIMIT');
    const i = await db.botInstallation.create({ data: { ...input, serverId }, select: installationSelect }); await audit(db, req.user.id, 'INSTALL', i.id); return i;
  }); await notifyServer(serverId); res.status(201).json(installation);
}));
router.patch('/servers/:id/bots/:installationId', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), installationId = validate(id, req.params.installationId), input = validate(z.strictObject({ enabled: z.boolean().optional(), channelIds: z.array(id).min(1).max(50).refine(v => new Set(v).size === v.length).optional(), permissions: permissions.optional(), config: settings.optional() }), req.body);
  const installation = await prisma.$transaction(async db => { await lockServer(db, serverId); await serverCapability(serverId, req.user.id, 'installBots', db); const current = await db.botInstallation.findFirst({ where: { id: installationId, serverId } }); if (!current) throw new HttpError(404, '机器人安装不存在', 'BOT_NOT_FOUND'); const bot = await db.bot.findUniqueOrThrow({ where: { id: current.botId } }); if (bot.builtin && input.config && !input.config.welcome) throw new HttpError(400, '请填写欢迎语', 'BOT_WELCOME_REQUIRED'); if (input.enabled !== false || input.channelIds || input.permissions || input.config) await validateChannels(db, serverId, input.channelIds ?? asStrings(current.channelIds), req.user.id, input.permissions ?? asStrings(current.permissions)); const i = await db.botInstallation.update({ where: { id: installationId }, data: input, select: installationSelect }); await audit(db, req.user.id, 'CONFIGURE', i.id); return i; }); await notifyServer(serverId); res.json(installation);
}));
router.delete('/servers/:id/bots/:installationId', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), installationId = validate(id, req.params.installationId);
  await prisma.$transaction(async db => { await lockServer(db, serverId); await serverCapability(serverId, req.user.id, 'installBots', db); const changed = await db.botInstallation.deleteMany({ where: { id: installationId, serverId } }); if (!changed.count) throw new HttpError(404, '机器人安装不存在', 'BOT_NOT_FOUND'); await audit(db, req.user.id, 'REMOVE', installationId); }); await notifyServer(serverId); res.json({ ok: true });
}));
async function commands(serverId: string, userId: string, conversationId: string) {
  await serverMember(serverId, userId); const access = await channelPermission(conversationId, userId, true);
  if (!access || access.channel.serverId !== serverId) throw new HttpError(403, '无权使用此频道命令', 'BOT_CHANNEL_FORBIDDEN');
  const installs = await prisma.botInstallation.findMany({ where: { serverId, enabled: true }, include: { bot: { select: safeBot } } });
  return installs.flatMap(i => !asStrings(i.channelIds).includes(access.channel.id) || !asStrings(i.permissions).includes('COMMANDS') || !asStrings(i.permissions).includes('SEND_MESSAGES') ? [] : (i.bot.builtin ? ['help','ticket'] : asStrings((i.config as { commands?: string[] }).commands)).map(name => ({ name, botId: i.botId, installationId: i.id })));
}
router.get('/servers/:id/commands', asyncRoute(async (req, res) => { res.json(await commands(validate(id, req.params.id), req.user.id, validate(id, req.query.conversationId))); }));
router.post('/servers/:id/commands', asyncRoute(async (req, res) => {
  const serverId = validate(id, req.params.id), input = validate(z.strictObject({ conversationId: id, command: z.string().regex(/^[a-z][a-z0-9_-]{0,20}$/) }), req.body);
  await consumeLimit(`bot-command:${req.user.id}`, 30, 60); const available = await commands(serverId, req.user.id, input.conversationId), command = available.find(c => c.name === input.command);
  if (!command) throw new HttpError(403, '当前频道没有此命令', 'BOT_COMMAND_FORBIDDEN');
  if (input.command === 'ticket') { res.json({ action: 'ticket' }); return; }
  if (input.command === 'help') { res.json({ action: 'help', commands: available.map(c => c.name) }); return; }
  await prisma.botEvent.create({ data: { installationId: command.installationId, type: 'command', payload: { channelId: (await prisma.channel.findUniqueOrThrow({ where: { conversationId: input.conversationId } })).id, conversationId: input.conversationId, command: input.command, userId: req.user.id } } });
  res.json({ action: 'sent' });
}));
export default router;
