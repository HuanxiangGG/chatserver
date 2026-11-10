import guestTickets from './guest-tickets.js';
import communityControls from './community-controls.js';
import reports from './reports.js';
import groupModeration from './group-moderation.js';
import forwarding from './forwarding.js';
import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Prisma } from '@prisma/client';
import { config, isTrustedOrigin, prisma, redis, checkOrigin, consumeLimit, authenticateRequest, asyncRoute, HttpError } from './context.js';
import auth from './auth.js';
import social from './social.js';
import chat from './chat.js';
import messageSearch from './message-search.js';
import uploads from './uploads.js';
import admin from './admin.js';
import communities from './communities.js';
import tickets from './tickets.js';
import bots from './bots.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors({ origin(origin, callback) { callback(null, !origin || isTrustedOrigin(origin)); }, credentials: true, allowedHeaders: ['Content-Type', 'X-CSRF-Token'], methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));
app.use(checkOrigin);
app.use(express.json({ limit: '128kb' }));
app.use(cookieParser());
app.get('/api/health', asyncRoute(async (_req, res) => {
  try {
    await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);
    res.json({ status: 'ok' });
  } catch { res.status(503).json({ status: 'unavailable' }); }
}));
app.use('/api', asyncRoute(async (req, _res, next) => {
  // Shared NAT/proxy addresses must not pool the traffic of signed-in chat users.
  // A cookie is not proof of identity: exempt only a currently valid DB session.
  if (req.cookies?.[config.cookieName]) {
    try { await authenticateRequest(req); }
    catch (error) { if (!(error instanceof HttpError && error.status === 401)) throw error; }
  }
  // Stale cookies can still reach login. Endpoint-specific login/upload/admin
  // limits remain independent of this anonymous request budget.
  if (!req.user) await consumeLimit(`http:${req.ip}`, 600, 60);
  next();
}));
app.use('/api', (req, _res, next) => {
  if (config.cookieSecure && !req.secure) return next(new HttpError(503, '服务器代理配置错误：未识别 HTTPS，请检查 TRUST_PROXY 和 X-Forwarded-Proto', 'PROXY_HTTPS_REQUIRED'));
  next();
});
app.use('/api', guestTickets, communityControls, auth, bots, communities, tickets, chat, messageSearch, forwarding, groupModeration, reports, uploads, admin, social);
app.use((_req, res) => res.status(404).json({ error: '接口不存在' }));
const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') { res.status(409).json({ error: '该用户名、邮箱或记录已存在' }); return; }
    if (error.code === 'P2025') { res.status(404).json({ error: '记录不存在' }); return; }
    if (error.code === 'P2003') { res.status(400).json({ error: '关联记录不存在' }); return; }
  }
  if (error?.type === 'entity.too.large' || error?.code === 'LIMIT_FILE_SIZE') { res.status(413).json({ error: '上传或请求体过大' }); return; }
  if (error?.name === 'MulterError') { res.status(400).json({ error: '上传请求无效' }); return; }
  if (error instanceof SyntaxError && 'body' in error) { res.status(400).json({ error: 'JSON 格式无效' }); return; }
  // Do not log request bodies, cookies, tokens, database URLs, or raw driver errors.
  console.error('Request failed: internal server error');
  res.status(500).json({ error: '服务暂时不可用，请稍后重试' });
};
app.use(errors);
export { app };
export default app;
