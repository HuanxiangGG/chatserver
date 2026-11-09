import { mailConfiguration } from './recovery-mail.js';
import { createServer } from 'node:http';
import app from './app.js';
import { config, prisma, redis } from './context.js';
import { initRealtime, closeRealtime } from './realtime.js';

const server = createServer(app);
server.requestTimeout = 30000;
server.headersTimeout = 15000;
async function start() {
  mailConfiguration();
  await prisma.$connect();
  await redis.ping();
  await initRealtime(server);
  server.listen(config.port, '0.0.0.0', () => console.info(`Harbor API listening on port ${config.port}`));
}
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const force = setTimeout(() => process.exit(1), 8000);
  force.unref();
  const closed = new Promise<void>(resolve => server.close(() => resolve()));
  await closeRealtime();
  await closed;
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  clearTimeout(force);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
start().catch(() => { console.error('Startup failed; verify database, Redis, and environment configuration.'); process.exit(1); });
