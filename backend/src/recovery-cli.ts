import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { compare } from 'bcryptjs';
import { prisma, hashToken, config } from './context.js';

async function secret(): Promise<string> {
  process.stdout.write('管理员密码（不回显）: ');
  const input = process.stdin;
  input.setRawMode(true); input.resume(); input.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    function finish() { input.setRawMode(false); input.pause(); input.removeListener('data', onData); process.stdout.write('\n'); }
    function onData(chunk: string) {
      for (const char of chunk) {
        if (char === '\u0003') { finish(); reject(new Error('Cancelled')); return; }
        if (char === '\r' || char === '\n') { finish(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    }
    input.on('data', onData);
  });
}

async function main() {
  if (!process.stdin.isTTY) throw new Error('Requires an interactive terminal');
  let rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const actorName = (await rl.question('执行操作的管理员用户名: ')).trim().toLowerCase();
    const actor = await prisma.user.findUnique({ where: { username: actorName } });
    if (!actor || actor.role !== 'ADMIN' || actor.banned) throw new Error('Invalid admin');
    rl.close();
    if (!await compare(await secret(), actor.passwordHash)) throw new Error('Invalid admin credentials');
    rl = createInterface({ input: process.stdin, output: process.stdout });
    const username = (await rl.question('需要恢复的用户名: ')).trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) throw new Error('Unknown user');
    const reason = (await rl.question('身份核验方式/工单编号（不要填写密码或个人敏感信息）: ')).trim();
    if (reason.length < 3 || reason.length > 500) throw new Error('Invalid reason');
    if (await rl.question('已通过可信渠道核验身份？输入 VERIFIED 继续: ') !== 'VERIFIED') throw new Error('Not verified');
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
      await tx.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.passwordReset.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt } });
      await tx.adminAction.create({ data: { actorId: actor.id, action: 'PASSWORD_RESET_ISSUED', targetId: user.id, reason } });
    });
    // Deliberate one-time credential output to the interactive operator only.
    console.info(`重置链接（15 分钟有效、仅可使用一次，请通过可信私密渠道交付）:\n${config.origins[0]}/reset-password?token=${token}`);
  } finally { rl.close(); }
}
main().catch(() => { console.error('恢复令牌创建失败；必须核验身份并提供有效管理员、用户和原因。'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
