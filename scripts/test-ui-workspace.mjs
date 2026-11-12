// Real isolated workspace audit. Comparison phases reuse the same persisted IDs.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium,webkit} from 'playwright';
import {createTestPng} from './browser-fixtures.mjs';
const base=new URL(process.env.UI_WORKSPACE_BASE||process.env.UI_TEST_BASE_URL||'http://localhost:5173');
assert(['localhost','127.0.0.1'].includes(base.hostname)&&base.protocol==='http:','Local browser target required');
assert(new URL(process.env.DATABASE_URL||'postgresql://invalid/unsafe').pathname.endsWith('_test'),'Isolated database required');
const phase=process.env.UI_PHASE==='before'?'before':'after';
const output=new URL(process.env.UI_OUTPUT||'../test-results/browser/workspace/',import.meta.url);
// CI credentials stay outside the uploaded screenshot directory.
const fixturePath=process.env.UI_FIXTURE||join(await mkdtemp(join(tmpdir(),'harbor-ui-')),'fixture.json');
await mkdir(output,{recursive:true,mode:0o700});
async function api(path,method='GET',body,actor){
 const r=await fetch(`${base.origin}/api${path}`,{method,headers:{Origin:base.origin,...(body?{'Content-Type':'application/json'}:{}),...(actor?{Cookie:actor.cookie,'X-CSRF-Token':actor.csrfToken}:{})},body:body?JSON.stringify(body):undefined});
 assert(r.ok,`${method} ${path.replace(/\/invites\/[^/]+/,'/invites/<redacted>')}: HTTP ${r.status}`);
 const value=await r.json();return {...value,cookie:r.headers.get('set-cookie')?.split(';')[0]||actor?.cookie};
}
const send=(actor,id,content,attachmentIds)=>api(`/conversations/${id}/messages`,'POST',{content,attachmentIds,clientId:randomUUID()},actor);
let f;
try{f=JSON.parse(await readFile(fixturePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(!f){
 const suffix=randomUUID().replaceAll('-','').slice(0,10);
 const register=(name,displayName)=>api('/auth/register','POST',{username:`ui_${name}_${suffix}`,email:`ui_${name}_${suffix}@example.test`,password:`Review-${randomUUID()}-A8!`,displayName});
 const owner=await register('owner','阿舟'),member=await register('member','小林 · A very long display name'),admin=await register('admin','客服小周');
 for(const person of [member,admin]){const req=await api('/friend-requests','POST',{userId:person.user.id},owner);await api(`/friend-requests/${req.id}/respond`,'POST',{accept:true},person);}
 const direct=await api('/conversations/direct','POST',{userId:member.user.id},owner);
 const group=await api('/conversations/group','POST',{name:'周末小聚',description:'周六在码头见。',userIds:[member.user.id,admin.user.id]},owner);
 const ids=[];for(const text of ['好','123','我先看看'])ids.push((await send(owner,direct.id,text)).id);
 await send(member,direct.id,'周六下午两点在码头见。我们可以沿河散步，再找个地方坐下来聊。晚到也没关系，到了给我发消息。\nIf the weather changes, we can meet at the café instead. I will bring the camera and send you the walking route before we leave.');
 const form=new FormData();form.append('file',new Blob([createTestPng()],{type:'image/png'}),'harbor-weekend.png');
 const uploaded=await fetch(`${base.origin}/api/uploads?conversationId=${direct.id}`,{method:'POST',headers:{Origin:base.origin,Cookie:member.cookie,'X-CSRF-Token':member.csrfToken},body:form});assert(uploaded.ok);const image=await uploaded.json();await send(member,direct.id,'上次在这里拍的。',[image.id]);
 await send(owner,group.id,'周末有空的朋友都可以来。');
 const server=await api('/servers','POST',{name:'游戏交流社 · Weekend friends and shared adventures',description:'一起聊天、交流攻略，周末约好一起玩。',rules:'请尊重其他成员。需要帮助时可以创建私密工单。'},owner);
 const detail=await api(`/servers/${server.id}`,'GET',undefined,owner),hall=detail.channels[0];
 await api(`/servers/${server.id}/channels/${hall.id}`,'PATCH',{name:'大厅'},owner);
 await api(`/servers/${server.id}/channels`,'POST',{name:'公告',readOnly:true},owner);
 await api(`/servers/${server.id}/channels`,'POST',{name:'攻略'},owner);
 await api(`/servers/${server.id}/channels`,'POST',{name:'管理室',isPrivate:true},owner);
 const catalog=await api('/bots/catalog','GET',undefined,owner),bot=Object.values(catalog).find(v=>v&&typeof v==='object'&&v.builtin===true);assert(bot);
 await api(`/servers/${server.id}/bots`,'POST',{botId:bot.id,channelIds:[hall.id],permissions:['SEND_MESSAGES','COMMANDS'],config:{welcome:'欢迎来到游戏交流社，{name}！'}},owner);
 const invitation=await api(`/servers/${server.id}/invites`,'POST',{hours:24,maxUses:10},owner);
 for(const person of [member,admin])await api(`/invites/${invitation.token}/join`,'POST',{},person);
 await api(`/servers/${server.id}/members/${admin.user.id}`,'PATCH',{role:'ADMIN'},owner);
 await api(`/servers/${server.id}/ticket-settings`,'PATCH',{privateTicketsEnabled:true,guestTicketsEnabled:true,adminTicketClaimEnabled:true},owner);
 await send(owner,hall.conversationId,'周末的攻略整理好了，有问题可以在大厅讨论。');
 const ticket=await api(`/servers/${server.id}/tickets`,'POST',{subject:'游戏进度无法同步 · Saved progress does not appear',category:'SUPPORT',content:'换设备后没有看到昨天的游戏进度，请帮我检查。',ownerOnly:false,clientId:randomUUID()},member);
 await api(`/tickets/${ticket.id}`,'PATCH',{assigneeId:admin.user.id},owner);
 await send(admin,ticket.conversationId,'我来帮你检查。请告诉我出现问题的时间，以及使用的设备。');
 await api(`/servers/${server.id}/tickets`,'POST',{subject:'周末活动时间确认',category:'GENERAL',content:'周六几点开始？',ownerOnly:false,clientId:randomUUID()},member);
 const closed=await api(`/servers/${server.id}/tickets`,'POST',{subject:'账号显示名称已修改',category:'GENERAL',content:'显示名称问题已经解决，谢谢。',ownerOnly:true,clientId:randomUUID()},member);await api(`/tickets/${closed.id}`,'PATCH',{status:'CLOSED'},owner);
 const recoveryCode=randomBytes(32).toString('hex');
 const guest=await api(`/guest/${server.id}/tickets`,'POST',{displayName:'临时朋友',subject:'游客咨询：如何参加周末活动',content:'你好，我想问一下周末活动的参加方式。',recoveryCode,ownerOnly:false,clientId:randomUUID()});
 await api(`/tickets/${guest.ticket.id}`,'PATCH',{assigneeId:admin.user.id},owner);await send(admin,guest.ticket.conversationId,'欢迎参加。我们周六下午两点在大厅集合。');
 for(const person of [owner,member,admin])await api('/users/me/sound','PUT',{enabled:false,direct:true,group:true,mention:true,volume:.5,tone:'soft',dnd:false,scheduled:false,start:'22:00',end:'08:00'},person);
 f={owner,member,admin,direct:direct.id,group:group.id,ids,server:server.id,hall:hall.conversationId,ticket,guest:{...guest,recoveryCode},clock:Date.now()};
 await writeFile(fixturePath,JSON.stringify(f),{mode:0o600});
}
// Keep prior isolated regression rooms in the local Hidden list, so repeated
// comparison captures retain the original two-conversation review fixture.
// This is the real browser preference; no messages or API data are removed.
const reviewConversations=await api('/conversations','GET',undefined,f.owner);
const comparisonPreferences=Object.fromEntries(Object.values(reviewConversations).filter(value=>value&&typeof value==='object'&&value.type==='GROUP'&&value.name?.startsWith('验收 ')).map(value=>[value.id,{archivedAt:new Date().toISOString()}]));
const appearance=mode=>({mode,accent:'indigo',density:'comfortable',fontSize:16,animations:false});
const results=[];
async function context(browser,actor,width,language,theme){
 if(actor?.user)await api('/users/me/appearance','PUT',appearance(theme),actor);
 const height=width<640?844:960,c=await browser.newContext({viewport:{width,height},isMobile:width<640,hasTouch:width<640,colorScheme:theme,reducedMotion:'reduce'});
 if(actor?.cookie){const i=actor.cookie.indexOf('=');await c.addCookies([{name:actor.cookie.slice(0,i),value:actor.cookie.slice(i+1),url:base.origin,httpOnly:true,sameSite:'Lax'}]);}
 await c.addInitScript(({language,theme,width,height,clock,ownerId,comparisonPreferences})=>{
  localStorage.setItem(`harbor.conversations.${ownerId}`,JSON.stringify(comparisonPreferences));
  localStorage.setItem('harbor.language',language);localStorage.setItem('harbor.appearance.guest',JSON.stringify({mode:theme,accent:'indigo',density:'comfortable',fontSize:16,animations:false}));
  const viewport=new EventTarget();Object.assign(viewport,{width,height,offsetTop:0,scale:1});Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});window.uiKeyboard=h=>{viewport.height=h;viewport.dispatchEvent(new Event('resize'));};
  window.uiUnhandled=0;window.addEventListener('unhandledrejection',()=>window.uiUnhandled++);
 },{language,theme,width,height,clock:f.clock,ownerId:f.owner.user.id,comparisonPreferences});
 const page=await c.newPage(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>{errors.push(e.message.replace(/https?:\/\/[^\s)]+/g,'[local URL]').slice(0,500));console.error('PAGE ERROR',new URL(page.url()).pathname,e.stack?.replace(/https?:\/\/[^/]+/g,'[local origin]').slice(0,2500));});return {c,page,errors};
}
async function visit(page,path,ready){await page.waitForLoadState('networkidle');await page.goto(`${base.origin}${path}`);await page.locator(ready).first().waitFor({state:'attached'});await page.waitForLoadState('networkidle');}
async function capture(page,name){
 const clip=name.endsWith('keyboard-simulated')?await page.evaluate(()=>({x:0,y:0,width:innerWidth,height:window.visualViewport.height})):undefined;
 await page.screenshot({path:new URL(`${phase}-${name}.png`,output).pathname,animations:'disabled',clip});
 const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,heading:[...document.querySelectorAll('main h1,section h1')].map(e=>e.textContent)}));
 results.push({name,...geometry,overflow:geometry.scrollWidth>geometry.width+1});
 if(phase==='after')assert(!results.at(-1).overflow,`${name}: horizontal overflow`);
}
const matrix=[{width:1440,lang:'zh-CN',theme:'dark',all:true},{width:360,lang:'zh-CN',theme:'dark',all:true},{width:390,lang:'en',theme:'light'},{width:768,lang:'en',theme:'dark'},{width:1440,lang:'en',theme:'light'}];
for(const [engine,type] of Object.entries({chromium,webkit}).filter(([name])=>(phase==='after'||name==='chromium')&&(!process.env.UI_BROWSER_ENGINE||name===process.env.UI_BROWSER_ENGINE))){
 const browser=await type.launch();
 try{for(const variant of matrix.filter(v=>process.env.UI_INTERACTIONS_ONLY!=='1'&&(!process.env.UI_SKIP_DESKTOP||v.width!==1440)&&(!process.env.UI_WIDTH||v.width===Number(process.env.UI_WIDTH))&&(!process.env.UI_PRIMARY||v.lang==='zh-CN'))){
  console.log(`Auditing ${phase} ${engine} ${variant.width} ${variant.lang} ${variant.theme}`);
  const {width,lang,theme}=variant,prefix=`${engine}-${width}-${lang}-${theme}`;
  const {c,page,errors}=await context(browser,f.owner,width,lang,theme);
  try{
   await visit(page,`/chat/${f.direct}`,'.composer textarea');await page.locator('.attachment-thumbnail img').last().evaluate(img=>img.decode());
   await page.route('**/api/conversations/*/messages',route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:'{"code":"SERVICE_UNAVAILABLE"}'}):route.continue());
   const input=page.locator('.composer textarea');await input.fill('照片稍后再传给你');await input.press('Enter');await page.locator('.outbox-status button').waitFor();
   await page.locator('.messages-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});await input.focus();
   await capture(page,`${prefix}-chat`);
   assert.equal(await input.inputValue(),'照片稍后再传给你');assert(await input.evaluate(el=>el===document.activeElement));
   await page.unroute('**/api/conversations/*/messages');
   if(variant.all||phase==='after'){
    for(const [name,path,ready] of [
     ['friends','/friends','.page-content'],['group',`/groups/${f.group}`,'.group-page'],
     ['community',`/servers/${f.server}`,'.community-overview'],['channel',`/servers/${f.server}/channels/${f.hall}`,'.composer textarea'],
     ['queue',`/servers/${f.server}/tickets`,'.ticket-queue header'],['ticket',`/servers/${f.server}/tickets/${f.ticket.id}/chat/${f.ticket.conversationId}`,'.ticket-toolbar'],
     ['settings',phase==='after'?'/settings#sound':'/settings','.settings-page'],['community-settings',`/servers/${f.server}/settings`,'.community-overview,.community-management'],
    ]){await visit(page,path,ready);await capture(page,`${prefix}-${name}`);}
    for(const [name,selector] of [['members','#community-members'],['bots','#community-bots']]){if(phase==='after'){if(await page.locator('.workspace-mobile-navigation summary').isVisible())await page.locator('.workspace-mobile-navigation summary').click();await page.locator(`a[href$="${selector}"]:visible`).click();await page.locator(selector).waitFor();}const section=page.locator(selector);if(await section.count()){await section.scrollIntoViewIfNeeded();await capture(page,`${prefix}-${name}`);}}
   }
   assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.uiUnhandled),0);
  }finally{await c.close();}
  if(variant.all||phase==='after'){
   const {c:anon,page:ap,errors:ae}=await context(browser,null,width,lang,theme);
   try{for(const route of ['login','register']){await visit(ap,`/${route}`,'.auth-screen form');await capture(ap,`${prefix}-${route}`);}await visit(ap,`/guest/${f.server}`,'.guest-workspace form');await capture(ap,`${prefix}-guest-entry`);assert.deepEqual(ae,[]);}finally{await anon.close();}
   const {c:gc,page:gp,errors:ge}=await context(browser,f.guest,width,lang,theme);
   try{await visit(gp,`/guest/${f.server}/tickets/${f.guest.ticket.id}`,'.guest-composer');await capture(gp,`${prefix}-guest-chat`);assert.deepEqual(ge,[]);}finally{await gc.close();}
  }
 }
 if(phase==='after'&&process.env.UI_CAPTURE_ONLY!=='1')for(const width of [360,1440].filter(w=>!process.env.UI_WIDTH||w===Number(process.env.UI_WIDTH)))await interactions(browser,engine,width);
 }finally{await browser.close();}
}
await writeFile(new URL(`${process.env.UI_PRIMARY?'comparison-':process.env.UI_INTERACTIONS_ONLY?'interaction-':''}audit-${phase}.json`,output),JSON.stringify({phase,results,physicalDevice:false},null,2));
const captures=results.filter(result=>'width' in result).length;console.log(`Workspace ${phase}: ${captures} actual local page captures; ${results.length-captures} interaction scenarios; fixture credentials remain private.`);

async function interactions(browser,engine,width){
 const marker=`ui-flow-${randomUUID()}`,lang=width===360?'zh-CN':'en';console.log(`Interaction ${engine}/${width}: messages`);
 const room=await api('/conversations/group','POST',{name:`验收 ${engine} ${width}`,userIds:[f.member.user.id]},f.owner);
 for(let i=0;i<14;i++)await send(f.member,room.id,`历史消息 ${i}：这是一段用于实际滚动测试的聊天记录，保留到后续浏览器验证。`);
 const {c,page,errors}=await context(browser,f.owner,width,lang,'dark');
 try{
  await visit(page,`/chat/${room.id}`,'.composer textarea');await page.waitForFunction(()=>document.querySelector('.connection-hidden'));
  const input=page.locator('.composer textarea');
  for(let i=0;i<3;i++){await input.fill(`${marker}-${i}`);await input.press('Enter');}
  await page.waitForFunction(m=>[...document.querySelectorAll('.message-content')].filter(e=>e.textContent.startsWith(m)).length===3,marker);
  assert(await input.evaluate(el=>el===document.activeElement),'Continuous send retains focus');
  const long=`${marker}-long\n${'这是一条较长的消息，用于检查中英文自然换行。 Long English words should remain inside the conversation. '.repeat(8)}`;
  await input.fill(long);await input.press('Enter');await page.locator('.message-content').filter({hasText:`${marker}-long`}).waitFor();
  await page.locator('.composer input[type=file]').setInputFiles({name:'flow.png',mimeType:'image/png',buffer:createTestPng()});await page.locator('.pending-media-item').waitFor();await input.press('Enter');await page.locator('.attachment-thumbnail img').last().waitFor();await page.locator('.attachment-thumbnail img').last().evaluate(img=>img.decode());
  await page.route('**/api/conversations/*/messages',route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:'{"code":"SERVICE_UNAVAILABLE"}'}):route.continue());
  await input.fill(`${marker}-retry`);await input.press('Enter');await page.locator('.outbox-status button').waitFor();assert.equal(await input.inputValue(),`${marker}-retry`);
  await page.unroute('**/api/conversations/*/messages');await page.locator('.outbox-status button').click();await page.locator('.outbox-status').waitFor({state:'hidden'});await page.locator('.message-content').filter({hasText:`${marker}-retry`}).waitFor();assert.equal(await page.locator('.message-content').filter({hasText:`${marker}-retry`}).count(),1);
  await input.fill('中文选词');await input.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true})));assert.equal(await input.inputValue(),'中文选词');await input.press('Shift+Enter');assert((await input.inputValue()).includes('\n'));
  if(width<640){await input.focus();await page.evaluate(()=>window.uiKeyboard(430));await page.waitForFunction(()=>document.documentElement.dataset.keyboard==='open');const box=await input.boundingBox();assert(box.y+box.height<=430);assert(!await page.locator('.mobile-bottom-nav').isVisible());await capture(page,`${engine}-${width}-keyboard-simulated`);await input.blur();await page.evaluate(()=>window.uiKeyboard(844));await page.waitForFunction(()=>document.documentElement.dataset.keyboard==='closed');}
  console.log(`Interaction ${engine}/${width}: dialog`);
  await input.fill('');
  const message=page.locator('.message-row').filter({has:page.locator('.message-content').filter({hasText:`${marker}-retry`})});
  const menu=message;await menu.focus();await menu.press('Enter');const dialog=page.getByRole('dialog');await dialog.waitFor();
  const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);await page.keyboard.press('Tab');assert(await dialog.evaluate(el=>el.contains(document.activeElement)),JSON.stringify(await page.evaluate(()=>({active:document.activeElement?.tagName,activeClass:document.activeElement?.className,focusable:[...document.querySelectorAll('[role=dialog] button')].map(el=>({name:el.getAttribute('aria-label'),text:el.textContent,disabled:el.disabled,visible:el.offsetParent!==null}))}))));await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert(await menu.evaluate(el=>el===document.activeElement),'Dialog returns focus to trigger');
  console.log(`Interaction ${engine}/${width}: history/draft`);
  await page.locator('.messages-scroll').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});await page.locator('.jump-latest').waitFor();await send(f.member,room.id,`${marker}-while-reading`);await page.locator('.message-content').filter({hasText:`${marker}-while-reading`}).waitFor();await page.locator('.jump-latest').filter({hasText:lang==='en'?'New messages':'有新消息'}).waitFor();assert(await page.locator('.messages-scroll').evaluate(el=>el.scrollTop<30),'Incoming message must not force historical reader to bottom');
  await page.locator('.jump-latest').click();await input.fill(`${marker}-draft`);
  if(width<640)await input.blur();
  await page.locator('a[href="/communities"]:visible').first().click();await page.waitForURL('**/communities');
  await page.locator('a[href="/chat"]:visible').first().click();await page.waitForURL('**/chat');await page.locator(`a[href="/chat/${room.id}"]:visible`).first().click();await input.waitFor();assert.equal(await input.inputValue(),`${marker}-draft`,'Draft survives leaving and returning through navigation');await input.fill('');
  await page.locator('.messages-scroll').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
  await page.locator('a[href="/communities"]:visible').first().click();await page.waitForURL('**/communities');await page.locator('a[href="/chat"]:visible').first().click();await page.waitForURL('**/chat');await page.locator(`a[href="/chat/${room.id}"]:visible`).first().click();await input.waitFor();await page.locator('.message-content').filter({hasText:'历史消息 0：'}).waitFor();await page.waitForFunction(()=>document.querySelector('.messages-scroll')?.scrollTop<30,null,{timeout:5000});
  console.log(`Interaction ${engine}/${width}: ticket filters`);
  await visit(page,`/servers/${f.server}/tickets`,'.ticket-status-tab');
  for(const [index,status] of ['OPEN','IN_PROGRESS','CLOSED'].entries()){
   const response=page.waitForResponse(r=>r.url().includes(`/api/servers/${f.server}/tickets?`)&&r.url().includes(`status=${status}`)&&r.status()===200);
   await page.locator('.ticket-status-tab').nth(index+1).click();await response;await page.locator('.ticket-row').first().waitFor();assert((await page.locator('.ticket-row .ticket-status').evaluateAll(els=>els.map(el=>el.dataset.status))).every(value=>value===status));
  }
  await visit(page,`/servers/${f.server}/tickets/${f.ticket.id}/chat/${f.ticket.conversationId}`,'.ticket-toolbar');await page.locator('.ticket-toolbar-actions .icon-btn').click();await page.getByRole('dialog').getByRole('button',{name:lang==='en'?'Ticket details':'工单详情',exact:true}).click();await page.locator('.ticket-details-sheet').waitFor();await page.keyboard.press('Escape');await page.locator('.ticket-details-sheet').waitFor({state:'hidden'});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.uiUnhandled),0);
  results.push({name:`${engine}-${width}-interaction`,continuousSend:true,failedRetry:true,image:true,composition:true,historyScroll:true,historyRestore:true,ticketFilters:true,ticketDetails:true,draftNavigation:true,focusReturn:true,keyboard:width<640?'visualViewport simulation':'desktop'});
 }catch(error){
  await page.screenshot({path:new URL(`failure-${engine}-${width}.png`,output).pathname}).catch(()=>{});
  console.error('INTERACTION FAILURE',engine,width,await page.evaluate(()=>({pathname:location.pathname,inputLength:document.querySelector('.composer textarea')?.value?.length,inputDisabled:document.querySelector('.composer textarea')?.disabled,pending:document.querySelectorAll('.pending-message').length,errors:[...document.querySelectorAll('[role=alert],.outbox-status')].map(el=>el.textContent.slice(-160)),active:document.activeElement?.tagName,connected:!!document.querySelector('.connection-hidden')})));
  throw error;
 }finally{await c.close();}
 // The same assigned guest ticket is reopened in a separate authenticated role
 // and an independent guest browser; no new ticket is created by a refresh.
 console.log(`Interaction ${engine}/${width}: guest reply`);
 const admin=await context(browser,f.admin,width,lang,'dark'),guest=await context(browser,f.guest,width,lang,'dark');
 try{
  await visit(admin.page,`/servers/${f.server}/tickets/${f.guest.ticket.id}/chat/${f.guest.ticket.conversationId}`,'.composer textarea');
  await admin.page.locator('.composer textarea').fill(`${marker}-guest-reply`);await admin.page.locator('.composer textarea').press('Enter');await admin.page.locator('.message-content').filter({hasText:`${marker}-guest-reply`}).waitFor();
  await visit(guest.page,`/guest/${f.server}/tickets/${f.guest.ticket.id}`,'.guest-composer');await guest.page.getByText(`${marker}-guest-reply`,{exact:true}).waitFor();await guest.page.reload();await guest.page.getByText(`${marker}-guest-reply`,{exact:true}).waitFor();assert.equal(await guest.page.locator('.nav-rail,.community-sidebar,.mobile-bottom-nav').count(),0);
  assert.deepEqual(admin.errors,[]);assert.deepEqual(guest.errors,[]);results.push({name:`${engine}-${width}-guest-reply`,sameTicket:true,refreshHistory:true,guestIsolation:true});
 }finally{await admin.c.close();await guest.c.close();}
}
