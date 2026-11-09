import { PrismaClient, type Session, type User, Prisma } from '@prisma/client';
import { Redis } from 'ioredis';
import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';

dotenv({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')], quiet: true });
const env = z.object({
  DATABASE_URL: z.string().min(1), REDIS_URL: z.string().min(1),
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  UPLOAD_DIR: z.string().default('./uploads'),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).max(2).default(0),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(14),
  NODE_ENV: z.string().default('development'),
}).parse(process.env);
const origins = env.APP_ORIGIN.split(',').map(v => new URL(v.trim()).origin);
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
  constructor(public status: number, message: string) { super(message); }
}
export function validate<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpError(400, result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return result.data;
}
export function asyncRoute(fn: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>): RequestHandler {
  return (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };
}
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export async function authenticateToken(token: string | undefined) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, '请先登录');
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.banned) throw new HttpError(401, '登录已失效，请重新登录');
  const { user, ...safeSession } = session;
  return { user, session: safeSession };
}
declare global {
  namespace Express {
    interface Request { user: User; session: Session; }
  }
}
export const requireAuth: RequestHandler = asyncRoute(async (req, _res, next) => {
  const { user, session } = await authenticateToken(req.cookies?.[config.cookieName]);
  req.user = user; req.session = session;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (req.get('X-CSRF-Token') !== session.csrfToken) throw new HttpError(403, 'CSRF 校验失败，请刷新后重试');
  }
  next();
});
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user || req.user.role !== 'ADMIN') return next(new HttpError(403, '需要管理员权限'));
  next();
};
export const checkOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.get('origin');
  if (origin && !config.origins.includes(origin)) return next(new HttpError(403, '来源不受信任'));
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !origin) return next(new HttpError(403, '写操作必须提供可信 Origin'));
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
