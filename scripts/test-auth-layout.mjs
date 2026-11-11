// Real auth form geometry and registration against the guarded local test server.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, webkit } from 'playwright';
const base = new URL(process.env.UI_TEST_BASE_URL || 'http://localhost:5173');
assert(['localhost','127.0.0.1'].includes(base.hostname) && base.protocol === 'http:');
assert(new URL(process.env.DATABASE_URL || 'postgresql://invalid/unsafe').pathname.endsWith('_test'));
const output = new URL('../test-results/browser/', import.meta.url); await mkdir(output, {recursive:true,mode:0o700});
const results=[];
for (const [engine,type] of Object.entries({chromium,webkit})) {
 const browser=await type.launch();
 try {
  for (const [width,height] of [[320,568],[390,430],[768,600],[1280,480],[640,350]]) {
   const context=await browser.newContext({viewport:{width,height},isMobile:width<1024,hasTouch:width<1024});
   const page=await context.newPage(),errors=[];let activeMode='';page.on('pageerror',e=>errors.push({name:e.name}));
   try {
    for (const mode of ['register','login','forgot-password','reset-password']) {
     activeMode=mode;
     await page.goto(`${base.origin}/${mode}`);const submit=page.locator('form button[type=submit]');await submit.waitFor();
     if(width===640)await page.locator('.auth-language select').selectOption('en');
     assert.equal(await page.locator('.story-art,.art-chip').count(),0);
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${engine}/${width}/${mode}: horizontal overflow`);
     await page.locator('.auth-screen').evaluate(el=>{el.scrollTop=0});
     await submit.scrollIntoViewIfNeeded();
     const bounds=await submit.boundingBox(),scroll=await page.locator('.auth-screen').boundingBox();
     assert(bounds.y>=scroll.y-1 && bounds.y+bounds.height<=scroll.y+scroll.height+1,`${engine}/${width}/${mode}: submit unreachable`);
     const metrics=await page.locator('.auth-screen').evaluate(el=>({top:el.scrollTop,height:el.clientHeight,content:el.scrollHeight,overflow:getComputedStyle(el).overflowY}));
     assert(['auto','scroll'].includes(metrics.overflow), 'Auth must own a user-scrollable surface');
     if(metrics.content>metrics.height+2) {
      await page.locator('.auth-screen').evaluate(el=>{el.scrollTop=0});
      if(engine==='webkit' && width<1024) {
       // Playwright mobile WebKit has no wheel/touch-swipe API. Verify the real
       // scroll surface here; native finger gestures remain a device check.
       await page.locator('.auth-screen').evaluate(el=>{el.scrollTop=el.scrollHeight});
      } else { await page.mouse.move(width/2,height/2);await page.mouse.wheel(0,1000); }
      await page.waitForFunction(()=>document.querySelector('.auth-screen').scrollTop>0);
     }
     await page.locator('input').last().focus();await submit.scrollIntoViewIfNeeded();
     await page.screenshot({path:new URL(`auth-${engine}-${width}-${height}-${mode}.png`,output).pathname});
     results.push({engine,width,height,mode,passed:true,metrics});
    }
    assert.deepEqual(errors,[]);
   } catch(error) {
    const diagnostic={engine,width,height,mode:activeMode,path:new URL(page.url()).pathname,errors,state:await page.evaluate(()=>({auth:!!document.querySelector('.auth-screen'),bootstrap:!!document.querySelector('.app-bootstrap'),rootChildren:document.querySelector('#root')?.childElementCount}))};
    await writeFile(new URL('auth-layout-failure.json',output),JSON.stringify(diagnostic,null,2),{mode:0o600});
    await page.screenshot({path:new URL('auth-layout-failure.png',output).pathname});
    console.error('Auth layout failure:',JSON.stringify(diagnostic));throw error;
   } finally {await context.close();}
  }
  const context=await browser.newContext({viewport:{width:320,height:568},isMobile:true,hasTouch:true});
  try {
   const page=await context.newPage();await page.goto(`${base.origin}/register`);
   const suffix=randomUUID().replaceAll('-','').slice(0,12),password=`Auth-${randomUUID()}-7!`;
   await page.locator('[name=username]').fill(`auth_${suffix}`);await page.locator('[name=displayName]').fill('Auth layout tester');await page.locator('[name=email]').fill(`auth_${suffix}@example.test`);await page.locator('[name=password]').fill(password);await page.locator('[name=confirmPassword]').fill(password);
   const submit=page.locator('form button[type=submit]');await submit.scrollIntoViewIfNeeded();await submit.click();await page.waitForURL('**/chat',{timeout:20000});
   // Phones open the conversation list; its empty state must offer a real next step.
   await page.locator('.sidebar-empty a').waitFor();
   await page.locator('.sidebar-empty a').click();await page.waitForURL('**/friends');
   await page.goto(`${base.origin}/chat`);await page.setViewportSize({width:1280,height:800});
   await page.locator('.welcome-chat h1').waitFor();
   assert.equal(await page.locator('.welcome-illustration,.welcome-top,.welcome-bottom').count(),0);
   await page.locator('.welcome-actions button').click();await page.locator('[role=dialog]').waitFor();await page.keyboard.press('Escape');
   await page.locator('.welcome-actions a').click();await page.waitForURL('**/friends');
   results.push({engine,realRegistration:true,emptyStateActions:true,passed:true});
  } finally {await context.close();}
 } finally {await browser.close();}
}
await writeFile(new URL('auth-layout.json',output),JSON.stringify(results,null,2),{mode:0o600});
console.log('Auth acceptance passed: 40 short/narrow viewport forms and 2 real registrations in Chromium/WebKit.');
