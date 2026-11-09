import { createInterface } from 'node:readline/promises';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { prisma, usernameSchema, passwordSchema, validate } from './context.js';

async function secret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('必须使用交互式终端，密码不可通过命令行参数传入');
  process.stdout.write(prompt);
  const input = process.stdin;
  input.setRawMode(true); input.resume(); input.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    function finish() { input.setRawMode(false); input.pause(); input.removeListener('data', onData); process.stdout.write('\n'); }
    function onData(chunk: string) {
      for (const char of chunk) {
        if (char === '\u0003') { finish(); reject(new Error('已取消')); return; }
        if (char === '\r' || char === '\n') { finish(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    }
    input.on('data', onData);
  });
}
async function main() {
  if (!process.stdin.isTTY) throw new Error('请使用 docker compose exec -it backend npm run admin:create');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const username = validate(usernameSchema, await rl.question('管理员用户名: '));
  const email = validate(z.email().trim().toLowerCase().max(254), await rl.question('管理员邮箱: '));
  const displayName = validate(z.string().trim().min(1).max(64), await rl.question('显示名称: '));
  rl.close();
  const password = validate(passwordSchema, await secret('密码（至少 10 位，不回显）: '));
  if (password !== await secret('再次输入密码: ')) throw new Error('两次输入不一致');
  await prisma.user.create({ data: { username, email, displayName, passwordHash: await hash(password, 12), role: 'ADMIN' } });
  console.info('管理员已创建。没有默认密码，请通过正常登录页面登录。');
}
main().catch(() => { console.error('创建失败：请检查输入格式、唯一用户名/邮箱及数据库连接。'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
