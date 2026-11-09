import { prisma } from './context.js';
// A production seed deliberately creates no default accounts or sample messages.
// Prisma migrations initialize the schema; use the interactive admin CLI next.
prisma.$queryRaw`SELECT 1`.then(() => console.info('数据库连接正常。初始化不创建默认账号；请执行 admin:create。')).catch(() => { console.error('初始化检查失败，请先应用迁移。'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
