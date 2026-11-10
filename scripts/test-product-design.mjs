// Real, disposable local conversations. This runner refuses production targets.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { chromium, webkit } from 'playwright';
const base = new URL(process.env.UI_TEST_BASE_URL || 'http://localhost:5173');
assert(['localhost','127.0.0.1'].includes(base.hostname) && base.protocol === 'http:');
assert(new URL(process.env.DATABASE_URL || 'postgresql://invalid/unsafe').pathname.endsWith('_test'));
const before = process.env.DESIGN_PHASE === 'before', phase = before ? 'before' : 'after', captureOnly = process.env.DESIGN_CAPTURE_ONLY === '1';
const output = new URL(process.env.DESIGN_OUTPUT || '../test-results/browser/design/', import.meta.url);
await mkdir(output, {recursive:true,mode:0o700});
async function call(path, method='GET', body, person) {
 const response = await fetch(`${base.origin}/api${path}`, {method,headers:{Origin:base.origin,...(body ? {'Content-Type':'application/json'} : {}),...(person ? {Cookie:person.cookie,'X-CSRF-Token':person.csrfToken} : {})},body:body ? JSON.stringify(body) : undefined});
 assert(response.ok, `${method} ${path}: HTTP ${response.status}`);
 return {...await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0] || person?.cookie};
}
// Generate a recognizable test image, then upload through the real MIME/permission API.
function testImage() {
 const chunk=(name,data)=>{const type=Buffer.from(name),content=Buffer.concat([type,data]);let crc=0xffffffff;for(const byte of content){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}const length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([length,content,sum]);};
 const w=480,h=200,header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=2;
 const pixels=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*(w*3+1)+1+x*3;const sky=y<110,boat=y>105&&y<133&&x>170+(y-105)&&x<310-(y-105);pixels[i]=boat?219:sky?154:56;pixels[i+1]=boat?176:sky?185:101;pixels[i+2]=boat?116:sky?200:131;}
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
async function conversation(a,b) {
 const room=await call('/conversations/group','POST',{name:'周末小聚',description:'周六下午，码头见。',userIds:[b.user.id]},a);
 const ids=[];for(const content of ['好','123','我先看看'])ids.push((await call(`/conversations/${room.id}/messages`,'POST',{content,clientId:randomUUID()},a)).id);
 await call(`/conversations/${room.id}/messages`,'POST',{content:'我刚看了天气，周六下午应该不会下雨。我们两点在码头见，沿着河边走到咖啡店，晚到也没关系。\nIf the weather changes, we can meet at the café instead. I’ll bring the camera and send the route before we leave.',clientId:randomUUID()},b);
 const form=new FormData();form.append('file',new Blob([testImage()],{type:'image/png'}),'harbor-test.png');
 const uploaded=await fetch(`${base.origin}/api/uploads?conversationId=${room.id}`,{method:'POST',headers:{Origin:base.origin,Cookie:b.cookie,'X-CSRF-Token':b.csrfToken},body:form});assert(uploaded.ok);const image=await uploaded.json();
 await call(`/conversations/${room.id}/messages`,'POST',{content:'上次在这里拍的',attachmentIds:[image.id],clientId:randomUUID()},b);
 return {room:room.id,ids};
}
let fixture;
if(process.env.DESIGN_FIXTURE)fixture=JSON.parse(await readFile(process.env.DESIGN_FIXTURE,'utf8'));
else {
 const suffix=randomUUID().replaceAll('-','').slice(0,10);
 const actor=async(index,displayName)=>call('/auth/register','POST',{username:`design_${index}_${suffix}`,email:`design_${index}_${suffix}@example.test`,password:`Test-${randomUUID()}-A7!`,displayName});
 const a=await actor(1,'阿舟'),b=await actor(2,'小林');
 const request=await call('/friend-requests','POST',{userId:b.user.id},a);await call(`/friend-requests/${request.id}/respond`,'POST',{accept:true},b);
 const {room,ids}=await conversation(a,b);
 await call('/users/me/sound','PUT',{enabled:false,direct:true,group:true,mention:true,volume:.5,tone:'soft',dnd:false,scheduled:false,start:'22:00',end:'08:00'},a);
 fixture={a,b,room,ids};
 if(process.env.DESIGN_SAVE_FIXTURE)await writeFile(process.env.DESIGN_SAVE_FIXTURE,JSON.stringify(fixture),{mode:0o600});
}
// WebKit reports an aborted fetch as a native page diagnostic even when the app
// catches its rejection. Only our explicit POST fault qualifies for that exception.
async function checkedPage(context) {
 await context.addInitScript(()=>{window.designUnhandled=0;window.addEventListener('unhandledrejection',()=>window.designUnhandled++);});
 const page=await context.newPage(),errors=[],networkDiagnostics=[],state={intentionalFailure:false};
 page.on('pageerror',error=>{
  if(state.intentionalFailure && /^Fetch API cannot load http/.test(error.name) && /due to access control checks\.$/.test(error.message)) networkDiagnostics.push('Expected aborted-request WebKit fetch diagnostic');
  else errors.push({name:error.name,message:/^(Cannot|Failed|Unable|ResizeObserver|Unexpected|\w+ is not defined)/.test(error.message)?error.message.slice(0,180):'Uncaught page error'});
 });
 const assertClean=async()=>{assert.equal(await page.evaluate(()=>window.designUnhandled),0,'No unhandled promise rejections');assert(networkDiagnostics.every(diagnostic=>diagnostic==='Expected aborted-request WebKit fetch diagnostic'),'Only native fault-injection diagnostics may be classified as expected');assert.deepEqual(errors,[]);};
 return {page,state,networkDiagnostics,assertClean};
}
const results=[];
for(const [engine,type] of Object.entries({chromium,webkit})) {
 const browser=await type.launch();
 try {
  for(const [name,width,height] of [['desktop',1440,960],['phone',390,844]]) {
   if(!before && !captureOnly)fixture={...fixture,...await conversation(fixture.a,fixture.b)};
   const context=await browser.newContext({viewport:{width,height},isMobile:width<640,hasTouch:width<640});
   await context.addInitScript(({height,width})=>{const v=new EventTarget();Object.assign(v,{height,width,offsetTop:0,scale:1});Object.defineProperty(window,'visualViewport',{value:v,configurable:true});window.designKeyboard=(h)=>{v.height=h;v.dispatchEvent(new Event('resize'));};},{height,width});
   const split=fixture.a.cookie.indexOf('=');await context.addCookies([{name:fixture.a.cookie.slice(0,split),value:fixture.a.cookie.slice(split+1),url:base.origin,httpOnly:true,sameSite:'Lax'}]);
   const {page,state,networkDiagnostics,assertClean}=await checkedPage(context);
   await page.goto(`${base.origin}/chat/${fixture.room}`);const input=page.locator('.composer textarea');await input.waitFor();await page.waitForFunction(()=>document.querySelector('.connection-hidden'));
   await page.locator('.attachment-thumbnail img').last().waitFor();await page.locator('.attachment-thumbnail img').last().evaluate(async img=>{if(!img.complete)await new Promise(resolve=>img.addEventListener('load',resolve,{once:true}));});assert(await page.locator('.attachment-thumbnail img').last().evaluate(img=>img.naturalWidth>0),'Uploaded image must actually decode');
   const failed='照片稍后再传给你';await page.route('**/api/conversations/*/messages',route=>{if(route.request().method()!=='POST')return route.continue();state.intentionalFailure=true;return route.abort('failed');});await input.fill(failed);await input.press('Enter');
   const retry=page.locator('.outbox-status button');try { await retry.waitFor({timeout:10000}); } catch (error) { await page.screenshot({path:new URL(`${engine}-${name}-failure.png`,output).pathname}); console.log({engine,name,failed:await page.locator('.form-error,.toast').count()}); throw error; }
   await page.locator('.messages-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});await input.focus();
   await page.screenshot({path:new URL(`${engine}-${name}-${phase}.png`,output).pathname});
   if(!before) {
    assert.equal(await page.locator(`#message-${fixture.ids[1]} .message-meta`).count(),0);
    assert.equal(await page.locator(`#message-${fixture.ids[2]} .message-avatar`).count(),0);
    assert.equal(await page.locator(`#message-${fixture.ids[0]} .message-meta`).count(),1);
    assert(await page.locator('.messages-scroll .outbox-status').isVisible(),'Failure must be attached to a visible message');
    assert.equal(await input.inputValue(),failed);assert(await input.evaluate(el=>el===document.activeElement));
    if(width<640)assert(!await page.locator('.composer-footnote').isVisible());
    if(!captureOnly) {
    await page.unroute('**/api/conversations/*/messages');await retry.click();await page.locator('.outbox-status').waitFor({state:'hidden'});
    await page.locator('.attachment-thumbnail').last().click();await page.locator('.attachment-lightbox img').waitFor();await page.locator('.attachment-lightbox img').evaluate(img=>img.decode());assert(await page.locator('.attachment-lightbox img').evaluate(img=>img.naturalWidth>0));await page.keyboard.press('Escape');await page.locator('.attachment-lightbox').waitFor({state:'hidden'});
    const marker=randomUUID();for(let i=0;i<3;i++){await input.fill(`${marker}-${i}`);await input.press('Enter');}
    await page.waitForFunction(marker=>[...document.querySelectorAll('.message-content')].filter(el=>el.textContent.startsWith(marker)).length===3,marker);
    assert(await input.evaluate(el=>el===document.activeElement));
    await input.fill('中文选词');await input.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true})));assert.equal(await input.inputValue(),'中文选词');
    await input.press('Shift+Enter');assert((await input.inputValue()).includes('\n'));
    if(width<640){await page.evaluate(()=>window.designKeyboard(430));await page.waitForFunction(()=>document.documentElement.dataset.keyboard==='open');assert(!await page.locator('.mobile-bottom-nav').isVisible());const r=await input.boundingBox();assert(r.y+r.height<=430);await page.waitForFunction(()=>{const el=document.querySelector('.messages-scroll');return el.scrollHeight-el.clientHeight-el.scrollTop<3;});await page.screenshot({path:new URL(`${engine}-keyboard-${phase}.png`,output).pathname});await input.blur();await page.evaluate(()=>window.designKeyboard(844));await page.waitForFunction(()=>document.documentElement.dataset.keyboard==='closed');}
    for(const theme of ['light','dark']){await assertClean();await page.goto(`${base.origin}/settings`);await page.locator('.theme-choice').nth(theme==='dark'?0:1).click();await page.waitForFunction(t=>document.documentElement.dataset.theme===t,theme);await page.locator('.sound-settings select').first().selectOption('en');await assertClean();await page.goto(`${base.origin}/chat/${fixture.room}`);await input.waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:new URL(`${engine}-${name}-${theme}-en.png`,output).pathname});}
   }
   }
   await assertClean();results.push({engine,name,phase,expectedNetworkDiagnostics:networkDiagnostics.length,passed:true});await context.close();
  }
  const context=await browser.newContext({viewport:{width:1280,height:960}});const {page,assertClean}=await checkedPage(context);await page.goto(`${base.origin}/register`);await page.locator('form').waitFor();await page.screenshot({path:new URL(`${engine}-register-${phase}.png`,output).pathname});if(!before)assert.equal(await page.locator('.auth-story').count(),0);await assertClean();await context.close();
 } finally {await browser.close();}
}
await writeFile(new URL(`results-${phase}.json`,output),JSON.stringify(results,null,2));
console.log(`Product design ${phase}: ${captureOnly ? 'comparison screenshots captured' : before ? 'baseline captured' : 'real messages, image, failure/retry, grouping, focus, IME, simulated keyboard, themes and English passed'} in Chromium/WebKit.`);
