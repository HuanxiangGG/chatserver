// Disposable local API/browser acceptance. Never point this runner at production.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, webkit } from 'playwright';
import { io } from 'socket.io-client';
const base = new URL(process.env.UI_TEST_BASE_URL || 'http://localhost:5173');
const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid/unsafe');
assert(['localhost', '127.0.0.1'].includes(base.hostname) && base.protocol === 'http:' && !base.username && !base.password && base.pathname === '/', 'UI test URL must be local HTTP');
assert(database.pathname.endsWith('_test'), 'Browser tests require a disposable _test database');
const output = new URL('../test-results/browser/', import.meta.url); await mkdir(output, { recursive: true, mode: 0o700 });
async function call(path, method = 'GET', body, auth) {
 const response = await fetch(`${base.origin}/api${path}`, { method, headers: { Origin: base.origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrfToken } : {}) }, body: body ? JSON.stringify(body) : undefined });
 assert(response.ok, `Local fixture API ${method} ${path}: HTTP ${response.status}`);
 return { data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
async function actor(index) { const value = await call('/auth/register', 'POST', { username: `ui_${index}_${suffix}`, email: `ui_${index}_${suffix}@example.test`, password: `Ui-${randomUUID()}-A7!`, displayName: index === 1 ? 'Interface tester' : 'Realtime peer' }); return { ...value.data, cookie: value.cookie }; }
const a = await actor(1), b = await actor(2);
const request = (await call('/friend-requests', 'POST', { userId: b.user.id }, a)).data;
await call(`/friend-requests/${request.id}/respond`, 'POST', { accept: true }, b);
const group = (await call('/conversations/group', 'POST', { name: 'Interface acceptance', description: 'Disposable real API browser validation', userIds: [b.user.id] }, a)).data;
for (let i = 0; i < 20; i++) await call(`/conversations/${group.id}/messages`, 'POST', { content: i === 18 ? `${'long_text_'.repeat(70)}\n多行消息与 Emoji 🌊✨` : `Interface regression message ${i}`, clientId: randomUUID() }, i % 2 ? a : b);
const results = [];
for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
 const browser = await browserType.launch({ headless: true }); let peer;
 try {
  for (const width of [320, 360, 375, 390, 414, 768, 1024, 1440]) {
   const context = await browser.newContext({ viewport: { width, height: width < 640 ? 844 : 900 }, isMobile: width < 1024, hasTouch: width < 1024, deviceScaleFactor: 1 });
   if (width === 390) await context.addInitScript(() => {
    // A deterministic visualViewport simulator, not a real OS keyboard.
    const viewport = new EventTarget(); Object.assign(viewport, { height: 844, width: 390, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    window.testKeyboardViewport = (height, offset = 0) => { viewport.height = height; viewport.offsetTop = offset; viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll')); };
   });
   const separator = a.cookie.indexOf('='); await context.addCookies([{ name: a.cookie.slice(0, separator), value: a.cookie.slice(separator + 1), url: base.origin, httpOnly: true, sameSite: 'Lax' }]);
   const page = await context.newPage(), errors = [];
   page.on('pageerror', () => errors.push('Uncaught page exception')); page.on('console', message => { if (message.type() === 'error') errors.push('Browser console error'); });
   try {
    await page.goto(`${base.origin}/chat/${group.id}`); await page.locator('.composer textarea').waitFor();
    await page.waitForFunction(() => document.querySelector('.connection-hidden'));
    const metrics = await page.evaluate(() => {
     const rect = selector => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r ? { top: r.top, width: r.width, height: r.height, bottom: r.bottom, right: r.right } : null; };
     return { width: innerWidth, height: innerHeight, frame: rect('.app-layout'), composer: rect('.composer-wrap'), textarea: rect('.composer textarea'), messages: rect('.messages-scroll'), header: rect('.chat-header'), nav: rect('.mobile-bottom-nav'), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    assert(!metrics.overflow, `${engine}/${width}: horizontal overflow`); assert(metrics.messages.height > 100, `${engine}/${width}: message area collapsed`);
    assert(metrics.textarea.height < 180 && metrics.textarea.height >= 40, `${engine}/${width}: textarea height`); assert(metrics.composer.bottom <= metrics.frame.bottom + 1, `${engine}/${width}: composer outside viewport`);
    if (width < 640) assert(metrics.composer.bottom <= metrics.nav.top + 1, `${engine}/${width}: navigation covers composer`);
    const overflowRows = await page.locator('.message-row,.message-content').evaluateAll(rows => rows.filter(row => row.scrollWidth > row.clientWidth + 1).length);
    assert.equal(overflowRows, 0, `${engine}/${width}: message content or tools overflow`);
    if (width < 1024) {
     const smallTargets = await page.locator('.composer-toolbar button,.chat-header-actions .icon-btn,.message-more').evaluateAll(buttons => buttons.filter(button => { const r=button.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44); }).length);
     assert.equal(smallTargets, 0, `${engine}/${width}: critical touch target below 44px`);
    }
    if (width === 390) {
     peer = io(base.origin, { transports: ['websocket'], auth: { csrfToken: b.csrfToken }, extraHeaders: { Origin: base.origin, Cookie: b.cookie }, reconnection: false });
     await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Peer socket connection timeout')), 10000); peer.once('connect', () => { clearTimeout(timer); resolve(); }); peer.once('connect_error', () => { clearTimeout(timer); reject(Error('Peer socket authentication failed')); }); });
     const marker = `ordered-${engine}-${suffix}`, delivered = [];
     peer.on('message:new', message => { if (message.content.startsWith(marker)) delivered.push(message); });
     const input = page.locator('.composer textarea');
     for (let i = 0; i < 3; i++) { await input.fill(`${marker}-${i}`); await input.press('Enter'); }
     await input.fill('Unsent next draft');
     await page.waitForFunction(value => [...document.querySelectorAll('.message-content')].filter(el => el.textContent.startsWith(value)).length === 3, marker);
     assert.equal(await input.inputValue(), 'Unsent next draft'); assert(await input.evaluate(element => element === document.activeElement), 'Composer lost focus');
     for (let retry = 0; delivered.length < 3 && retry < 50; retry++) await new Promise(resolve => setTimeout(resolve, 100));
     assert.deepEqual(delivered.map(message => message.content), [0, 1, 2].map(i => `${marker}-${i}`)); assert.equal(new Set(delivered.map(message => message.id)).size, 3);
     peer.disconnect(); peer = undefined;
     await page.evaluate(() => window.testKeyboardViewport(430, 24));
     await page.waitForFunction(() => document.documentElement.dataset.keyboard === 'open');
     assert(!await page.locator('.mobile-bottom-nav').isVisible(), 'Keyboard must hide bottom navigation');
     const keyboardInput = await input.boundingBox(); assert(keyboardInput.y + keyboardInput.height <= 455, 'Keyboard viewport covers composer');
     await page.screenshot({path:new URL(`${engine}-keyboard-simulated.png`,output).pathname});
     await input.blur(); await page.evaluate(() => window.testKeyboardViewport(844));
     await page.waitForFunction(() => document.documentElement.dataset.keyboard === 'closed');
     assert(await page.locator('.mobile-bottom-nav').isVisible(), 'Bottom navigation did not recover');
     assert.equal(await input.inputValue(),'Unsent next draft');
    }
    assert.deepEqual(errors, [], `${engine}/${width}: browser errors`);
    await page.screenshot({ path: new URL(`${engine}-${width}-chat.png`, output).pathname }); results.push({ engine, width, passed: true, metrics });
    if (width === 390 || width === 1440) { await page.goto(`${base.origin}/settings`); await page.locator('.appearance-settings').waitFor(); await page.screenshot({ path: new URL(`${engine}-${width}-settings.png`, output).pathname }); assert.deepEqual(errors, []);
     if (width === 390) {
      for (const language of ['zh-CN','en']) for (const theme of ['dark','light']) {
       await page.locator('.sound-settings select').first().selectOption(language);
       await page.locator('.theme-choice').nth(theme === 'dark' ? 0 : 1).click();
       await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, theme);
       assert.equal(await page.locator('html').getAttribute('lang'), language);
       await page.screenshot({path:new URL(`${engine}-settings-${theme}-${language}.png`,output).pathname});
       assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Translated settings overflow');
      }
     }
    }
    if (width === 320 || width === 768) for (const [name,path] of [['friends','/friends'],['profile','/profile'],['group',`/groups/${group.id}`]]) {
     await page.goto(`${base.origin}${path}`); await page.locator('.page-content').waitFor();
     const clipped = await page.locator('.workspace,.page-scroll,.page-content').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).length);
     assert.equal(clipped,0,`${engine}/${width}/${name}: content clipping`);
     await page.screenshot({path:new URL(`${engine}-${width}-${name}.png`,output).pathname});
    }
   } catch (error) { await page.screenshot({ path: new URL(`${engine}-${width}-failure.png`, output).pathname }).catch(() => {}); throw error; }
   finally { await context.close(); }
  }
 } finally { peer?.disconnect(); await browser.close(); }
}
await writeFile(new URL('matrix.json', output), JSON.stringify(results, null, 2), { mode: 0o600 });
console.log(`Browser acceptance passed: ${results.length} Chromium/WebKit viewports; ordered real Socket delivery and composer focus passed in both engines.`);
