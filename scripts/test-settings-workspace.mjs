// Real local services: isolated accounts, communities and bot installs only.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {navigate} from './browser-navigation.mjs';
const base=new URL(process.env.UI_TEST_BASE_URL||'http://localhost:5173');
assert(['localhost','127.0.0.1'].includes(base.hostname)&&base.protocol==='http:');
assert(new URL(process.env.DATABASE_URL||'postgresql://invalid/unsafe').pathname.endsWith('_test'));
const output=new URL(process.env.SETTINGS_OUTPUT||'../test-results/browser/settings-workspace/',import.meta.url);
await mkdir(output,{recursive:true,mode:0o700});
async function api(path,method='GET',body,actor){
 const response=await fetch(`${base.origin}/api${path}`,{method,headers:{Origin:base.origin,...(body?{'Content-Type':'application/json'}:{}),...(actor?{Cookie:actor.cookie,'X-CSRF-Token':actor.csrfToken}:{})},body:body?JSON.stringify(body):undefined});
 const result=await response.json();assert(response.ok,`${method} local endpoint: HTTP ${response.status}`);
 return {...result,cookie:response.headers.get('set-cookie')?.split(';')[0]||actor?.cookie};
}
const suffix=randomUUID().replaceAll('-','').slice(0,10);
const register=name=>api('/auth/register','POST',{username:`sw_${name}_${suffix}`,displayName:`Workspace ${name}`,email:`sw_${name}_${suffix}@example.test`,password:`Test-${randomUUID()}-C6!`});
const owner=await register('owner'),member=await register('member');
const catalog=await api('/bots/catalog','GET',undefined,owner);
const builtin=Object.values(catalog).find(bot=>bot?.builtin===true);assert(builtin);
const text={
 'zh-CN':{keep:'继续编辑',discard:'放弃修改',save:'保存',saveSound:'保存设置',install:'安装机器人',configure:'配置',remove:'移除',cancel:'取消',botActions:'机器人操作',removeMember:'移出社区'},
 en:{keep:'Keep editing',discard:'Discard changes',save:'Save',saveSound:'Save settings',install:'Install bot',configure:'Configure',remove:'Remove',cancel:'Cancel',botActions:'Bot actions',removeMember:'Remove from community'},
};
const initialSound={enabled:false,direct:true,group:true,mention:true,volume:.5,tone:'soft',dnd:false,scheduled:false,start:'22:00',end:'08:00'};
let lanes=0;
for(const [engine,width,language] of [['chromium',1440,'zh-CN'],['chromium',360,'en'],['webkit',1440,'en'],['webkit',360,'zh-CN']]){
 const words=text[language];
 const server=await api('/servers','POST',{name:`Settings ${engine} ${width}`,description:'Local settings acceptance'},owner);
 const detail=await api(`/servers/${server.id}`,'GET',undefined,owner),hall=detail.channels[0];
 const invite=await api(`/servers/${server.id}/invites`,'POST',{hours:1,maxUses:2},owner);await api(`/invites/${invite.token}/join`,'POST',{},member);
 await api('/users/me/sound','PUT',initialSound,owner);
 const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true});
 const context=await browser.newContext({viewport:{width,height:900},isMobile:width<640,hasTouch:width<640,reducedMotion:'reduce'});
 const separator=owner.cookie.indexOf('=');await context.addCookies([{name:owner.cookie.slice(0,separator),value:owner.cookie.slice(separator+1),url:base.origin,httpOnly:true,sameSite:'Lax'}]);
 await context.addInitScript(locale=>localStorage.setItem('harbor.language',locale),language);
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const go=async path=>{await navigate(page,`${base.origin}${path}`);await page.locator('.settings-workspace').waitFor();};
 const section=async hash=>{const mobile=page.locator('.workspace-mobile-navigation');if(await mobile.isVisible())await mobile.locator('summary').click();await page.locator(`a[href$="#${hash}"]:visible`).click();};
 const dialog=()=>page.getByRole('dialog');
  try{
  await go(`/servers/${server.id}/settings#basic`);
  const form=page.locator('form.community-settings'),name=form.locator('input[name=name]');
  const updated=`Saved ${engine} ${width}`;await name.fill(updated);
  await section('channels');await dialog().waitFor();await dialog().getByRole('button',{name:words.keep,exact:true}).click();assert.equal(await name.inputValue(),updated);
  let unload=false;page.once('dialog',async d=>{assert.equal(d.type(),'beforeunload');unload=true;await d.dismiss();});
  await page.reload({waitUntil:'domcontentloaded',timeout:3000}).catch(error=>assert(/ERR_ABORTED|Navigation|Timeout|cancel/i.test(error.message)));
  assert(unload,'Dirty browser reload must ask before discarding');assert.equal(await name.inputValue(),updated);
  await form.getByRole('button',{name:words.save,exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.community-settings fieldset')?.disabled && document.querySelector('.community-settings .workspace-save-state')?.textContent?.trim());
  assert.equal((await api(`/servers/${server.id}`,'GET',undefined,owner)).name,updated);
  await name.fill('Discarded local draft');await section('channels');await dialog().getByRole('button',{name:words.discard,exact:true}).click();await page.waitForURL('**#channels');assert.equal((await api(`/servers/${server.id}`,'GET',undefined,owner)).name,updated);
  await section('basic');await name.fill('Back navigation draft');await page.goBack({waitUntil:'commit'});await dialog().waitFor();await dialog().getByRole('button',{name:words.keep,exact:true}).click();assert.equal(await name.inputValue(),'Back navigation draft');await page.goBack({waitUntil:'commit'});await dialog().getByRole('button',{name:words.discard,exact:true}).click();await page.waitForURL('**#channels');
  await section('community-bots');const bot=page.locator('#community-bots');await bot.locator('select[name=catalog]').selectOption(builtin.id);await bot.locator('.check-label').filter({hasText:hall.conversation.name}).locator('input').check();await bot.locator('textarea[name=welcome]').fill('Welcome, {name}.');
  await section('basic');await dialog().getByRole('button',{name:words.keep,exact:true}).click();assert.equal(await bot.locator('textarea[name=welcome]').inputValue(),'Welcome, {name}.');
  await bot.getByRole('button',{name:words.install,exact:true}).click();await bot.locator('.community-bot-row').waitFor();assert.equal(await bot.locator('.community-bot-row').count(),1);
  await page.reload();await bot.locator('.community-bot-row').waitFor();assert.equal(await bot.locator('.community-bot-row').count(),1);
  await bot.locator('.community-bot-row .icon-btn').click();await dialog().getByRole('button',{name:words.configure,exact:true}).click();await bot.locator('textarea[name=welcome]').fill('Configuration kept on error.');
  await section('basic');await dialog().getByRole('button',{name:words.discard,exact:true}).click();await page.waitForURL('**#basic');await section('community-bots');await bot.locator('.community-bot-row .icon-btn').click();await dialog().getByRole('button',{name:words.remove,exact:true}).click();await dialog().getByRole('button',{name:words.cancel,exact:true}).click();await dialog().getByRole('button',{name:words.remove,exact:true}).click();await dialog().getByRole('button',{name:words.remove,exact:true}).click();await bot.locator('.community-bot-row').waitFor({state:'detached'});
  assert.equal(Object.values(await api(`/servers/${server.id}/bots`,'GET',undefined,owner)).filter(item=>item&&typeof item==='object'&&item.bot).length,0);
  await section('community-members');const memberRow=page.locator('.community-member').filter({has:page.locator(`a[href="/profile/${member.user.id}"]`)});await memberRow.locator('.icon-btn').click();await dialog().getByRole('button',{name:words.removeMember,exact:true}).click();assert((await dialog().innerText()).includes(member.user.displayName));assert((await dialog().innerText()).includes(updated));await dialog().getByRole('button',{name:words.cancel,exact:true}).click();await page.keyboard.press('Escape');assert((await api(`/servers/${server.id}`,'GET',undefined,owner)).members.some(m=>m.userId===member.user.id));
  await go('/settings#sound');const sound=page.locator('.sound-settings');await sound.locator('input[type=checkbox]').first().check();assert.equal((await api('/users/me/sound','GET',undefined,owner)).sound.enabled,false);
  await section('appearance');await dialog().getByRole('button',{name:words.keep,exact:true}).click();assert(await sound.locator('input[type=checkbox]').first().isChecked());
  await section('appearance');await dialog().getByRole('button',{name:words.discard,exact:true}).click();assert.equal((await api('/users/me/sound','GET',undefined,owner)).sound.enabled,false);
  await section('sound');assert.equal(await sound.locator('input[type=checkbox]').first().isChecked(),false);await sound.locator('input[type=checkbox]').first().check();await sound.getByRole('button',{name:words.saveSound,exact:true}).click();await page.waitForFunction(()=>document.querySelector('.sound-settings .workspace-save-state')?.textContent?.includes(document.documentElement.lang==='en'?'Saved':'已保存'));
  assert.equal((await api('/users/me/sound','GET',undefined,owner)).sound.enabled,true);await section('appearance');await page.locator('.appearance-settings').waitFor();assert.equal(await dialog().count(),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:new URL(`${engine}-${width}-${language}-settings.png`,output).pathname});assert.deepEqual(errors,[]);lanes++;
 }finally{await context.close();await browser.close();}
}
console.log(`Settings workspace: ${lanes} browser/viewport/language lanes passed; real saves, unsaved navigation/reload, bot installation/removal and member confirmation.`);
