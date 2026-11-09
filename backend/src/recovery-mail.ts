import { recoveryCopy } from './locales/recovery.js';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import { prisma, config } from './context.js';
const schema = z.object({ SMTP_HOST: z.string().min(1), SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587), SMTP_SECURE: z.enum(['true','false']).default('false'), SMTP_USER: z.string().min(1), SMTP_PASSWORD: z.string().min(1), SMTP_FROM: z.email() });
export function mailConfiguration() {
 if (!process.env.SMTP_HOST) return null;
 const parsed = schema.safeParse(process.env);
 if (!parsed.success) throw new Error('SMTP configuration is incomplete');
 return parsed.data;
}
export async function requestRecovery(email: string, language: keyof typeof recoveryCopy = 'zh-CN') {
 const settings = mailConfiguration();
 if (!settings) return 'unconfigured' as const;
 const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, banned: true } });
 // The public response deliberately does not expose existence or delivery outcome.
 if (!user || user.banned) return 'accepted' as const;
 const raw = randomBytes(32).toString('hex'), tokenHash = createHash('sha256').update(raw).digest('hex');
 const row = await prisma.passwordReset.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now()+15*60000) } });
 const transport = nodemailer.createTransport({ host: settings.SMTP_HOST, port: settings.SMTP_PORT, secure: settings.SMTP_SECURE === 'true', requireTLS: true, auth: { user: settings.SMTP_USER, pass: settings.SMTP_PASSWORD }, logger: false, debug: false, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000, disableFileAccess: true, disableUrlAccess: true });
 try {
  const link = new URL('/reset-password', config.origins[0]); link.hash = new URLSearchParams({token:raw}).toString();
  const copy = recoveryCopy[language];
  const result = await transport.sendMail({ from: settings.SMTP_FROM, to: user.email, subject: copy.subject, text: `${copy.body}\n\n${link.href}` });
  if (!result.accepted?.length) throw new Error('SMTP did not accept recipient');
 } catch {
  await prisma.passwordReset.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  // No SMTP error object, recipient, token, URL, credentials or protocol data.
  console.error('PASSWORD_RECOVERY_DELIVERY_FAILED: check SMTP service configuration.');
 } finally { transport.close(); }
 return 'accepted' as const;
}
