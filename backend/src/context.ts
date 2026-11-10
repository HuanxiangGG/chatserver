import { PrismaClient, type Session, type User, Prisma } from '@prisma/client';
import { Redis } from 'ioredis';
import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { normalizeOrigin, parseOrigins } from './origin.js';

dotenv({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')], quiet: true });
const env = z.object({
  DATABASE_URL: z.string().min(1), REDIS_URL: z.string().min(1),
  APP_ORIGIN: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  UPLOAD_DIR: z.string().default('./uploads'),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).max(2).default(0),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(14),
  NODE_ENV: z.string().default('development'),
}).parse(process.env);
const origins = parseOrigins(env.APP_ORIGIN ?? (env.NODE_ENV === 'production' ? undefined : 'http://localhost:5173'), env.NODE_ENV === 'production');
if (env.NODE_ENV === 'production' && env.COOKIE_SECURE === 'false') throw new Error('服务器配置错误：生产环境必须设置 COOKIE_SECURE=true');
export const isTrustedOrigin = (origin: string) => { const normalized = normalizeOrigin(origin); return normalized !== null && origins.includes(normalized); };
export const config = {
  origins, uploadDir: resolve(env.UPLOAD_DIR), cookieName: 'harbor_session',
  port: env.PORT, isProduction: env.NODE_ENV === 'production',
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
  sessionDays: env.SESSION_TTL_DAYS, trustProxy: env.TRUST_PROXY,
};
export const prisma = new PrismaClient({ log: [] });
export const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: true });
redis.on('error', () => { /* Deliberately avoid connection strings in logs. Health endpoint reports failure. */ });
export const publicUserSelect = {
  id: true, username: true, displayName: true, avatarUrl: true, bio: true,
  status: true, lastSeenAt: true, role: true,
} satisfies Prisma.UserSelect;
export function publicUser(user: Pick<User, keyof typeof publicUserSelect>) {
  const { id, username, displayName, avatarUrl, bio, status, lastSeenAt, role } = user;
  return { id, username, displayName, avatarUrl, bio, status, lastSeenAt, role };
}
export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_ERROR') { super(message); }
}
export function validate<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpError(400, '字段校验失败：' + result.error.issues.map(i => `${({ username: '用户名', email: '邮箱', password: '密码', displayName: '显示名称' } as Record<string, string>)[String(i.path[0])] ?? '输入内容'}：${/[\u4e00-\u9fff]/.test(i.message) ? i.message : '格式或长度不符合要求'}`).join('；'), 'FIELD_INVALID');
  return result.data;
}
export function asyncRoute(fn: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>): RequestHandler {
  return (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };
}
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export async function authenticateToken(token: string | undefined) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, '未收到会话 Cookie，请先登录；若刚登录，请检查浏览器 Cookie 与 HTTPS 配置', 'COOKIE_MISSING');
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.banned || session.user.role === 'BOT') throw new HttpError(401, '登录已失效，请重新登录');
  const { user, ...safeSession } = session;
  return { user, session: safeSession };
}
declare global {
  namespace Express {
    interface Request { user: User; session: Session; }
  }
}
// Cache only within this HTTP request; subsequent requests always re-check the session.
export async function authenticateRequest(req: Request) {
  if (req.user && req.session) return;
  const { user, session } = await authenticateToken(req.cookies?.[config.cookieName]);
  req.user = user; req.session = session;
}
export const requireAuth: RequestHandler = asyncRoute(async (req, _res, next) => {
  await authenticateRequest(req);
  const { session } = req;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (req.get('X-CSRF-Token') !== session.csrfToken) throw new HttpError(403, 'CSRF 校验失败，请刷新页面后重试', 'CSRF_INVALID');
  }
  next();
});
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user || req.user.role !== 'ADMIN') return next(new HttpError(403, '需要管理员权限'));
  next();
};
export const checkOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.get('origin');
  if (origin && !isTrustedOrigin(origin)) return next(new HttpError(403, '来源校验失败：当前站点未列入服务器 APP_ORIGIN，请联系管理员核对生产域名', 'ORIGIN_UNTRUSTED'));
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !origin) return next(new HttpError(403, '来源校验失败：写操作缺少 Origin 请求头', 'ORIGIN_MISSING'));
  next();
};
export async function assertUnblocked(a: string, b: string) {
  if (await prisma.blockedUser.findFirst({ where: { OR: [{ userId: a, blockedId: b }, { userId: b, blockedId: a }] } })) throw new HttpError(403, '无法与该用户互动');
}
export async function consumeLimit(key: string, limit: number, windowSeconds: number) {
  try {
    const count = Number(await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", 1, `harbor:limit:${key}`, windowSeconds));
    if (count > limit) throw new HttpError(429, '请求过于频繁，请稍后重试');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, '服务暂时不可用，请稍后重试');
  }
}
export const passwordSchema = z.string().min(10).max(72).refine(v => Buffer.byteLength(v, 'utf8') <= 72, '密码 UTF-8 字节数不能超过 72');
export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/, '用户名为 3–24 位小写字母、数字或下划线');
