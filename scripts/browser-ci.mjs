// Start only local disposable services, then shut down the children we own.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
assert(new URL(process.env.DATABASE_URL || 'postgresql://invalid/unsafe').pathname.endsWith('_test'), 'Browser CI requires a _test database');
const base = 'http://localhost:5173', children = [], logs = [];
const testScript = process.env.BROWSER_TEST_SCRIPT || 'scripts/test-browser.mjs';
assert(['scripts/test-browser.mjs', 'scripts/test-auth-harbor.mjs', 'scripts/test-community-browser.mjs', 'scripts/test-community-controls-browser.mjs', 'scripts/test-ticket-admin-browser.mjs'].includes(testScript), 'Unknown browser suite');
mkdirSync('test-results/browser', { recursive: true, mode: 0o700 });
const env = { ...process.env, NODE_ENV: 'development', APP_ORIGIN: base, COOKIE_SECURE: 'false', TRUST_PROXY: '0', PORT: '3000', UI_TEST_BASE_URL: base };
function start(name, args, cwd = process.cwd()) {
 const log = openSync(`test-results/browser/${name}.log`, 'w', 0o600); logs.push(log);
 const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', log, log] }); children.push(child); return child;
}
async function stop() {
 for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
 for (let i = 0; i < 40 && children.some(child => child.exitCode === null); i++) await delay(100);
 for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
 for (const log of logs) closeSync(log);
}
try {
 start('backend', ['backend/dist/index.js']); start('frontend', [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, '--host', '127.0.0.1', '--strictPort'], new URL('../frontend', import.meta.url));
 let healthy = false;
 for (let i = 0; i < 80; i++) { if (children.some(child => child.exitCode !== null)) throw Error('Browser test service exited; inspect private CI test logs'); try { const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok) { healthy = true; break; } } catch {} await delay(250); }
 assert(healthy, 'Browser test services failed to become healthy');
 const test = spawn(process.execPath, [testScript], { env, stdio: 'inherit' }); children.push(test);
 const status = await new Promise((resolve, reject) => { test.once('error', reject); test.once('exit', resolve); }); assert.equal(status, 0, 'Browser acceptance failed');
} finally { await stop(); }
