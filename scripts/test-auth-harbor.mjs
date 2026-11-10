// Real auth against an explicitly isolated local environment. No production fixtures.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
const base=new URL(process.env.UI_TEST_BASE_URL || 'http://localhost:5173');
assert(['localhost','127.0.0.1'].includes(base.hostname)&&base.protocol==='http:','Local HTTP test target required');
assert(new URL(process.env.DATABASE_URL || 'postgresql://invalid/unsafe').pathname.endsWith('_test'),'Isolated _test database required');
const output=new URL(process.env.AUTH_HARBOR_OUTPUT || '../test-results/browser/auth-harbor/',import.meta.url);await mkdir(output,{recursive:true,mode:0o700});
const results=[];
for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch();
 try{
  for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
   const context=await browser.newContext({viewport:{width,height},isMobile:width<640,hasTouch:width<640,reducedMotion:'reduce'});
   const page=await context.newPage(),errors=[];page.on('pageerror',()=>errors.push('Uncaught page error'));
   for(const mode of ['login','register']){
    await page.goto(`${base.origin}/${mode}`);await page.locator('.auth-form-wrap form').waitFor();
    assert(await page.locator('input[name=username]').isVisible());
    assert.equal(await page.locator('.auth-story,.art-chip').count(),0);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const scene=await page.locator('.harbor-scene').boundingBox();assert(scene.height>=150);
    await page.screenshot({path:new URL(`${engine}-${name}-${mode}.png`,output).pathname});
    await page.locator('.auth-language select').selectOption('en');await page.waitForFunction(()=>document.documentElement.lang==='en');
    assert.equal(await page.locator('.auth-form-wrap h2').innerText(),mode==='login'?'Log in to Harbor':'Create an account');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.locator('.auth-language select').selectOption('zh-CN');
   }
   if(width<640){
    await page.addInitScript(()=>{const v=new EventTarget();Object.assign(v,{width:390,height:844,offsetTop:0,scale:1});Object.defineProperty(window,'visualViewport',{value:v,configurable:true});window.harborKeyboard=h=>{v.height=h;v.dispatchEvent(new Event('resize'));};});
    await page.reload();await page.locator('[name=username]').fill('harbor_guest');await page.locator('[name=displayName]').fill('小林');await page.locator('[name=email]').fill('harbor_guest@example.test');await page.locator('[name=password]').fill('Harbor-test-only-942!');await page.locator('[name=confirmPassword]').fill('Harbor-test-only-942!');
    await page.evaluate(()=>window.harborKeyboard(390));await page.waitForFunction(()=>document.documentElement.dataset.keyboard==='open');assert(!await page.locator('.harbor-scene').isVisible());
    await page.locator('form button[type=submit]').scrollIntoViewIfNeeded();const button=await page.locator('form button[type=submit]').boundingBox();assert(button.y>=0&&button.y+button.height<=391,'Submit must remain reachable with simulated keyboard');
    await page.screenshot({path:new URL(`${engine}-mobile-register-keyboard-simulated.png`,output).pathname,clip:{x:0,y:0,width:390,height:390}});
    await page.locator('[name=confirmPassword]').blur();await page.evaluate(()=>window.harborKeyboard(844));await page.waitForFunction(()=>document.documentElement.dataset.keyboard==='closed');assert(await page.locator('.harbor-scene').isVisible());await page.locator('.auth-screen').evaluate(el=>el.scrollTop=0);
    await page.screenshot({path:new URL(`${engine}-mobile-register-keyboard-restored.png`,output).pathname});
   }
   assert.deepEqual(errors,[]);results.push({engine,view:name,sceneAndLanguage:true,keyboard:width<640?'visualViewport simulation':'not applicable',passed:true});await context.close();
  }
  const suffix=randomUUID().replaceAll('-','').slice(0,12),username=`harbor_${suffix}`,password=`Test-${randomUUID()}-A9!`;
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();await page.goto(`${base.origin}/register`);
  for(const [name,value] of Object.entries({username,displayName:'Harbor auth tester',email:`${username}@example.test`,password,confirmPassword:password}))await page.locator(`[name=${name}]`).fill(value);
  let registerCalls=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/auth/register'))registerCalls++;});await page.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});await page.waitForURL('**/chat');assert.equal(registerCalls,1,'Double submit must make one real registration request');await context.close();
  const loginContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const login=await loginContext.newPage();await login.goto(`${base.origin}/login`);await login.locator('[name=username]').fill(username);await login.locator('[name=password]').fill('Wrong-test-only-password');await login.locator('form button[type=submit]').click();await login.locator('.form-error').waitFor();assert.equal(await login.locator('[name=username]').inputValue(),username);assert.equal(await login.locator('[name=password]').inputValue(),'Wrong-test-only-password');
  const passwordRect=await login.locator('.password-field').boundingBox(),errorRect=await login.locator('.form-error').boundingBox();assert(errorRect.y-passwordRect.y-passwordRect.height<35,'Credentials error belongs near password');
  await login.locator('[name=password]').fill(password);await login.locator('form button[type=submit]').click();await login.waitForURL('**/chat');await loginContext.close();results.push({engine,realRegistration:true,doubleSubmit:true,wrongPasswordPreservesFields:true,realLogin:true,passed:true});
 }finally{await browser.close();}
}
await writeFile(new URL('results.json',output),JSON.stringify(results,null,2));console.log('Harbor auth: original scenes, Chinese/English, simulated keyboard restore, two real registrations/logins, wrong password and double submit passed in Chromium/WebKit.');
