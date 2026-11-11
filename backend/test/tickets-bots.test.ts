import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { io, type Socket } from 'socket.io-client';
const db=process.env.TEST_DATABASE_URL,cache=process.env.TEST_REDIS_URL;
if(!db||!new URL(db).pathname.endsWith('_test')||!cache||new URL(cache).pathname!=='/9')throw Error('Dedicated _test PostgreSQL and Redis /9 required');
Object.assign(process.env,{DATABASE_URL:db,REDIS_URL:cache,NODE_ENV:'test',APP_ORIGIN:'https://chat.6hx9.com',COOKIE_SECURE:'false',TRUST_PROXY:'0'});
const origin='https://chat.6hx9.com',prefix=`tb${Date.now().toString(36)}`;
type Person={user:{id:string};csrfToken:string;cookie:string};
let app:any,prisma:any,redis:any,realtime:any,server:ReturnType<typeof createServer>,base:string;
let owner:Person,a:Person,b:Person,handler:Person,s1:string,s2:string,hall:any,secret:any,news:any,builtin:any,custom:any,install:any,ticket:any,fileId:string;
const sockets:Socket[]=[];
function api(p?:Person){const call=(method:'get'|'post'|'patch'|'delete'|'put',path:string,body?:any)=>{const r=request(app)[method](`/api${path}`).set('Origin',origin).set('Cookie',p?.cookie||'').set('X-CSRF-Token',p?.csrfToken||'');return body===undefined?r:r.send(body);};return{get:(p:string)=>call('get',p),post:(p:string,b:any={})=>call('post',p,b),patch:(p:string,b:any)=>call('patch',p,b),put:(p:string,b:any)=>call('put',p,b),delete:(p:string)=>call('delete',p)};}
function botGet(path:string,token=custom.token){return request(app).get(`/api${path}`).set('Origin',origin).set('Authorization',`Bearer ${token}`);}
function botPost(path:string,body:any,token=custom.token){return request(app).post(`/api${path}`).set('Origin',origin).set('Authorization',`Bearer ${token}`).send(body);}
async function register(name:string){const r=await api().post('/auth/register',{username:prefix+name,email:`${prefix}${name}@example.test`,password:'TicketsBot-Test-7!safe',displayName:name});expect(r.status,JSON.stringify(r.body)).toBe(201);return{...r.body,cookie:r.headers['set-cookie'][0].split(';')[0]};}
async function send(p:Person,c:string,content:string){return api(p).post(`/conversations/${c}/messages`,{content,clientId:randomUUID()});}
async function connect(p:Person){const socket=io(base,{transports:['websocket'],reconnection:false,auth:{csrfToken:p.csrfToken},extraHeaders:{Origin:origin,Cookie:p.cookie}});sockets.push(socket);await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});return socket;}
async function invite(p:Person,s:string){const r=await api(owner).post(`/servers/${s}/invites`,{hours:1,maxUses:10});expect(r.status).toBe(201);const joined=await api(p).post(`/invites/${r.body.token}/join`);expect(joined.status,JSON.stringify(joined.body)).toBe(200);return r.body.token;}
beforeAll(async()=>{
 ({default:app}=await import('../src/app.js'));({prisma,redis}=await import('../src/context.js'));
 const keys=await redis.keys('harbor:limit:*');if(keys.length)await redis.del(...keys);
 realtime=await import('../src/realtime.js');server=createServer(app);await realtime.initRealtime(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;
 owner=await register('owner');a=await register('a');b=await register('b');handler=await register('handler');
 const first=await api(owner).post('/servers',{name:'游戏交流社'}),second=await api(owner).post('/servers',{name:'另一个游戏社'});expect(first.status).toBe(201);expect(second.status).toBe(201);s1=first.body.id;s2=second.body.id;
 const detail=await api(owner).get(`/servers/${s1}`);hall=detail.body.channels[0];await api(owner).patch(`/servers/${s1}/channels/${hall.id}`,{name:'大厅'});
 secret=(await api(owner).post(`/servers/${s1}/channels`,{name:'管理室',isPrivate:true})).body;
 news=(await api(owner).post(`/servers/${s1}/channels`,{name:'公告',readOnly:true})).body;
});
afterAll(async()=>{sockets.forEach(s=>s.disconnect());if(realtime)await realtime.closeRealtime();if(server?.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));await prisma?.$disconnect();redis?.disconnect();});
it('installs a scoped welcome bot and welcomes a joining member exactly once',async()=>{
 const catalog=await api(owner).get('/bots/catalog');expect(catalog.status).toBe(200);builtin=catalog.body.find((x:any)=>x.builtin);
 const r=await api(owner).post(`/servers/${s1}/bots`,{botId:builtin.id,channelIds:[hall.id],permissions:['SEND_MESSAGES','COMMANDS'],config:{welcome:'欢迎 {name}'}});expect(r.status,JSON.stringify(r.body)).toBe(201);
 expect(JSON.stringify(r.body)).not.toContain('tokenHash');expect(JSON.stringify(r.body)).not.toContain('passwordHash');
 const token=await invite(a,s1);await api(a).post(`/invites/${token}/join`);await api(a).post(`/invites/${token}/join`);
 const greeting=await prisma.message.findMany({where:{conversationId:hall.conversationId,sender:{role:'BOT'}}});expect(greeting).toHaveLength(1);expect(greeting[0].content).toBe('欢迎 a');
 expect((await api(a).get(`/conversations/${hall.conversationId}/messages`)).body.messages.some((m:any)=>m.sender.role==='BOT')).toBe(true);
 await invite(b,s1);await invite(handler,s1);await api(owner).patch(`/servers/${s1}/members/${handler.user.id}`,{role:'MODERATOR'});
});
it('isolates same-name halls, private channels and read-only announcements across two communities',async()=>{
 await invite(a,s2);const second=(await api(owner).get(`/servers/${s2}`)).body.channels[0];await api(owner).patch(`/servers/${s2}/channels/${second.id}`,{name:'大厅'});
 expect((await send(a,hall.conversationId,'只在第一个大厅')).status).toBe(201);
 expect((await api(a).get(`/conversations/${second.conversationId}/messages`)).body.messages.some((m:any)=>m.content==='只在第一个大厅')).toBe(false);
 expect((await send(a,news.conversationId,'不能发布')).status).toBe(403);
 expect((await api(a).get(`/conversations/${secret.conversationId}/messages`)).status).toBe(403);
 expect((await api(a).get(`/servers/${s1}`)).body.channels.some((c:any)=>c.id===secret.id)).toBe(false);
});
it('creates one private two-way ticket under duplicate submissions and leaks no title/events/unread to B',async()=>{
 const watcher=await connect(b),leaked:any[]=[];watcher.on('ticket:updated',e=>leaked.push(e));watcher.on('message:new',e=>leaked.push(e));
 const data={ownerOnly:false,clientId:randomUUID(),subject:'私密问题',category:'账号',content:'TICKET_SECRET_ONLY_A'};
 const [one,two]=await Promise.all([api(a).post(`/servers/${s1}/tickets`,data),api(a).post(`/servers/${s1}/tickets`,data)]);expect(one.status).toBe(201);expect(two.status).toBe(201);expect(one.body.id).toBe(two.body.id);ticket=one.body;expect(ticket.number).toBeGreaterThan(0);
 expect(await prisma.message.count({where:{conversationId:ticket.conversationId}})).toBe(1);
 expect((await api(b).get(`/servers/${s1}/tickets`)).body.tickets).toEqual([]);
 expect((await api(b).get(`/tickets/${ticket.id}`)).status).toBe(403);
 expect((await api(b).get(`/conversations/${ticket.conversationId}/search?q=SECRET`)).status).toBe(403);
 expect((await api(b).get('/conversations')).body.some((c:any)=>c.id===ticket.conversationId)).toBe(false);
 expect((await api(handler).get(`/tickets/${ticket.id}`)).status).toBe(403);
 expect((await api(b).patch(`/tickets/${ticket.id}`,{status:'CLOSED'})).status).toBe(403);
 await watcher.timeout(3000).emitWithAck('presence:set',{status:'ONLINE'});expect(leaked.some(e=>e.id===ticket.id||e.conversationId===ticket.conversationId)).toBe(false);watcher.disconnect();
});
it('enforces attachments, replies, assignment, queue filtering and original ticket history',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKAAAAABJRU5ErkJggg==','base64');
 const u=await request(app).post(`/api/uploads?conversationId=${ticket.conversationId}`).set('Origin',origin).set('Cookie',a.cookie).set('X-CSRF-Token',a.csrfToken).attach('file',png,{filename:'secret.png',contentType:'image/png'});expect(u.status).toBe(201);fileId=u.body.id;
 const original=(await api(a).get(`/conversations/${ticket.conversationId}/messages`)).body.messages[0];
 expect((await api(a).post(`/conversations/${ticket.conversationId}/messages`,{content:'附件说明',attachmentIds:[fileId],replyToId:original.id,clientId:randomUUID()})).status).toBe(201);
 expect((await api(handler).get(`/uploads/${fileId}`)).status).toBe(403);expect((await api(b).get(`/uploads/${fileId}`)).status).toBe(403);
 expect((await send(owner,ticket.conversationId,'社区主回复')).status).toBe(201);
 const assigned=await api(owner).patch(`/tickets/${ticket.id}`,{assigneeId:handler.user.id});expect(assigned.status,JSON.stringify(assigned.body)).toBe(200);expect(assigned.body.status).toBe('IN_PROGRESS');expect(assigned.body.assignee.id).toBe(handler.user.id);
 expect((await api(handler).get(`/uploads/${fileId}`)).status).toBe(200);
 expect((await send(handler,ticket.conversationId,'我来处理')).status).toBe(201);
 expect((await api(owner).get(`/servers/${s1}/tickets?q=${ticket.number}&status=IN_PROGRESS&limit=1`)).body.tickets[0].id).toBe(ticket.id);
 expect((await api(a).patch(`/tickets/${ticket.id}`,{assigneeId:b.user.id})).status).toBe(403);
 expect((await api(owner).patch(`/tickets/${ticket.id}`,{assigneeId:null})).status).toBe(200);
 expect((await api(handler).get(`/uploads/${fileId}`)).status).toBe(403);
 expect((await api(handler).get(`/conversations/${ticket.conversationId}/messages`)).status).toBe(403);
});
it('opens a ticket for an offline member, keeps it after relogin, and closes/reopens the same conversation',async()=>{
 const ownerData={memberId:a.user.id,clientId:randomUUID(),subject:'主动联系',category:'支持',content:'离线也能收到'};
 const r=await api(owner).post(`/servers/${s1}/tickets`,ownerData);expect(r.status).toBe(201);const active=r.body;
 const login=await api().post('/auth/login',{username:prefix+'a',password:'TicketsBot-Test-7!safe'});expect(login.status).toBe(200);const fresh={...login.body,cookie:login.headers['set-cookie'][0].split(';')[0]};
 const list=await api(fresh).get(`/servers/${s1}/tickets?limit=1`);expect(list.body.tickets[0].id).toBe(active.id);expect(list.body.tickets[0].unreadCount).toBe(1);expect(list.body.cursor).toBeTruthy();
 const next=await api(fresh).get(`/servers/${s1}/tickets?limit=1&cursor=${list.body.cursor}`);expect(next.body.tickets[0].id).toBe(ticket.id);
 expect((await send(fresh,active.conversationId,'重新登录后回复')).status).toBe(201);
 expect((await api(owner).patch(`/tickets/${ticket.id}`,{status:'CLOSED'})).status).toBe(200);
 expect((await api(a).get(`/conversations/${ticket.conversationId}`)).body.canWrite).toBe(false);
 expect((await send(a,ticket.conversationId,'关闭后不可发')).status).toBe(403);
 const before=(await api(a).get(`/conversations/${ticket.conversationId}/messages`)).body.messages;
 expect((await api(a).patch(`/messages/${before[0].id}`,{content:'关闭后不能编辑'})).status).toBe(403);
 expect((await api(a).post(`/messages/${before[0].id}/retract`)).status).toBe(403);
 expect((await api(a).get(`/uploads/${fileId}`)).status).toBe(200);
 expect((await api(a).patch(`/tickets/${ticket.id}`,{status:'OPEN'})).body.conversationId).toBe(ticket.conversationId);
 expect((await send(a,ticket.conversationId,'重开后继续')).status).toBe(201);
 expect((await api(a).get(`/conversations/${ticket.conversationId}/messages`)).body.messages).toHaveLength(before.length+1);
});
it('authorizes only channel-scoped commands and runs a real independent custom bot process',async()=>{
 const available=await api(a).get(`/servers/${s1}/commands?conversationId=${hall.conversationId}`);expect(available.body.map((c:any)=>c.name)).toEqual(['help','ticket']);
 expect((await api(a).post(`/servers/${s1}/commands`,{conversationId:hall.conversationId,command:'ticket'})).body.action).toBe('ticket');
 expect((await api(a).post(`/servers/${s1}/commands`,{conversationId:hall.conversationId,command:'help'})).body.commands).toEqual(['help','ticket']);
 expect((await api(a).get(`/servers/${s1}/commands?conversationId=${secret.conversationId}`)).status).toBe(403);
 const created=await api(owner).post('/bots',{name:'测试自定义机器人'});expect(created.status).toBe(201);custom=created.body;
 const r=await api(owner).post(`/servers/${s1}/bots`,{botId:custom.id,channelIds:[hall.id],permissions:['READ_MESSAGES','SEND_MESSAGES','COMMANDS'],config:{commands:['ping']}});expect(r.status).toBe(201);install=r.body;
 const command=await api(a).post(`/servers/${s1}/commands`,{conversationId:hall.conversationId,command:'ping'});expect(command.status).toBe(200);
 const directory=await mkdtemp(join(tmpdir(),'harbor-bot-test-')),credentials=join(directory,'credential.json');
 try {
  await writeFile(credentials,JSON.stringify({base,origin,token:custom.token}),{mode:0o600});
  const child=spawn(process.execPath,[new URL('../../examples/custom-bot/bot.mjs',import.meta.url).pathname,'--once'],{env:{...process.env,BOT_CREDENTIALS:credentials},stdio:['ignore','pipe','pipe']});
  let diagnostic='';child.stdout.on('data',d=>{diagnostic+=d;});child.stderr.on('data',()=>{diagnostic+='Bot process reported failure';});
  const code=await new Promise<number|null>((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Independent bot did not respond'));},10000);child.once('exit',code=>{clearTimeout(timer);resolve(code);});child.once('error',reject);});expect(code,diagnostic).toBe(0);expect(diagnostic).toContain('Command response delivered.');
 }finally{await rm(directory,{recursive:true,force:true});}
 const messages=(await api(a).get(`/conversations/${hall.conversationId}/messages`)).body.messages;expect(messages.some((m:any)=>m.content==='Pong'&&m.sender.role==='BOT')).toBe(true);
 expect((await api(owner).get('/bots/catalog')).body.find((x:any)=>x.id===custom.id).token).toBeUndefined();
});
it('keeps bot events and sends out of tickets/private channels, prevents bot loops, rotates and revokes grants',async()=>{
 expect((await send(a,hall.conversationId,'BOT_EVENT_ALLOWED')).status).toBe(201);
 expect((await send(a,ticket.conversationId,'BOT_TICKET_SECRET')).status).toBe(201);
 const events=await botGet('/bot/events');expect(events.status).toBe(200);expect(JSON.stringify(events.body)).toContain('BOT_EVENT_ALLOWED');expect(JSON.stringify(events.body)).not.toContain('BOT_TICKET_SECRET');
 expect(events.body.events.some((e:any)=>e.type==='message'&&e.payload.content==='Pong')).toBe(false);
 const payload={installationId:install.id,conversationId:secret.conversationId,content:'不应发送',clientId:randomUUID()};expect((await botPost('/bot/messages',payload)).status).toBe(403);
 expect((await botPost('/bot/messages',{...payload,conversationId:ticket.conversationId})).status).toBe(403);
 expect((await botGet(`/uploads/${fileId}`)).status).toBe(401);expect((await botGet('/conversations')).status).toBe(401);
 const identity=await prisma.bot.findUnique({where:{id:custom.id},include:{user:true}});
 expect((await api().post('/auth/login',{username:identity.user.username,password:'anything'})).status).toBe(401);
 expect((await api(a).post('/friend-requests',{userId:identity.userId})).status).toBe(404);
 expect((await api(a).get('/users?q=bot_')).body.some((u:any)=>u.role==='BOT')).toBe(false);
 const old=custom.token;const rotated=await api(owner).post(`/bots/${custom.id}/rotate`);expect(rotated.status).toBe(200);custom.token=rotated.body.token;expect((await botGet('/bot/events',old)).status).toBe(401);
 expect((await api(owner).patch(`/servers/${s1}/bots/${install.id}`,{enabled:false})).status).toBe(200);expect((await botGet('/bot/events')).body.events).toEqual([]);
 expect((await botPost('/bot/messages',{...payload,conversationId:hall.conversationId})).status).toBe(403);
 await api(owner).patch(`/servers/${s1}/bots/${install.id}`,{enabled:true});const oldCount=await prisma.message.count({where:{senderId:identity.userId}});
 expect((await api(owner).delete(`/servers/${s1}/bots/${install.id}`)).status).toBe(200);expect((await botPost('/bot/messages',{...payload,conversationId:hall.conversationId})).status).toBe(403);
 expect(await prisma.message.count({where:{senderId:identity.userId}})).toBe(oldCount);
});
it('rejects missing CSRF/Origin and revokes assigned handlers after demotion, including their own file uploads',async()=>{
 expect((await request(app).post(`/api/servers/${s1}/tickets`).set('Origin',origin).set('Cookie',a.cookie).send({clientId:randomUUID(),subject:'bad',category:'bad',content:'bad'})).status).toBe(403);
 expect((await request(app).post(`/api/servers/${s1}/tickets`).set('Cookie',a.cookie).set('X-CSRF-Token',a.csrfToken).send({clientId:randomUUID(),subject:'bad',category:'bad',content:'bad'})).status).toBe(403);
 expect((await api(owner).patch(`/tickets/${ticket.id}`,{assigneeId:handler.user.id})).status).toBe(200);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKAAAAABJRU5ErkJggg==','base64');
 const u=await request(app).post(`/api/uploads?conversationId=${ticket.conversationId}`).set('Origin',origin).set('Cookie',handler.cookie).set('X-CSRF-Token',handler.csrfToken).attach('file',png,{filename:'handler.png',contentType:'image/png'});expect(u.status).toBe(201);
 expect((await api(handler).post(`/conversations/${ticket.conversationId}/messages`,{content:'处理人附件',attachmentIds:[u.body.id],clientId:randomUUID()})).status).toBe(201);
 // Public avatar references must never bypass an attached ticket file's permission.
 expect((await api(handler).patch('/users/me',{avatarUrl:`/api/uploads/${u.body.id}`})).status).toBe(200);
 expect((await api(b).get(`/uploads/${u.body.id}`)).status).toBe(403);
 await api(handler).patch('/users/me',{avatarUrl:null});
 expect((await api(owner).patch(`/servers/${s1}/members/${handler.user.id}`,{role:'MEMBER'})).status).toBe(200);
 expect((await api(handler).get(`/tickets/${ticket.id}`)).status).toBe(403);
 expect((await api(handler).get(`/uploads/${u.body.id}`)).status).toBe(403);
 expect((await api(owner).get(`/tickets/${ticket.id}`)).body.assigneeId).toBeNull();
});

it('cannot turn installBots permission into access to hidden channels or read-only posting',async()=>{
 const role=await api(owner).post(`/servers/${s1}/roles`,{name:'机器人维护',position:10,permissions:{installBots:true}});expect(role.status).toBe(201);
 expect((await api(owner).put(`/servers/${s1}/roles/${role.body.id}/members`,{userIds:[b.user.id]})).status).toBe(200);
 const body={botId:custom.id,channelIds:[secret.id],permissions:['READ_MESSAGES','SEND_MESSAGES'],config:{commands:['ping']}};
 expect((await api(b).post(`/servers/${s1}/bots`,body)).status).toBe(403);
 expect((await api(b).post(`/servers/${s1}/bots`,{...body,channelIds:[news.id]})).status).toBe(403);
 const valid=await api(b).post(`/servers/${s1}/bots`,{...body,channelIds:[hall.id]});expect(valid.status,JSON.stringify(valid.body)).toBe(201);
 expect((await api(owner).delete(`/servers/${s1}/bots/${valid.body.id}`)).status).toBe(200);
});

it('keeps oversized numeric ticket queries as text without overflowing Prisma Int or bypassing privacy',async()=>{
 const subject='9'.repeat(100);
 const created=await api(a).post(`/servers/${s1}/tickets`,{clientId:randomUUID(),subject,category:'编号查询',content:'仅当事人可见'});
 expect(created.status).toBe(201);
 const ownerResult=await api(owner).get(`/servers/${s1}/tickets?q=${subject}`);
 expect(ownerResult.status).toBe(200);expect(ownerResult.body.tickets.map((t:any)=>t.id)).toContain(created.body.id);
 const memberResult=await api(a).get(`/servers/${s1}/tickets?q=${subject}`);
 expect(memberResult.status).toBe(200);expect(memberResult.body.tickets.map((t:any)=>t.id)).toContain(created.body.id);
 const unrelated=await api(b).get(`/servers/${s1}/tickets?q=${subject}`);
 expect(unrelated.status).toBe(200);expect(unrelated.body.tickets).toEqual([]);
 for(const q of ['0','2147483647','2147483648','9007199254740992','#'+'9'.repeat(99)]){
  const result=await api(owner).get(`/servers/${s1}/tickets?q=${encodeURIComponent(q)}`);expect(result.status,q).toBe(200);
 }
 const exact=await api(owner).get(`/servers/${s1}/tickets?q=${encodeURIComponent('#'+created.body.number)}`);
 expect(exact.status).toBe(200);expect(exact.body.tickets.map((t:any)=>t.id)).toEqual([created.body.id]);
});

it('does not welcome existing members through invite retries after a fresh installation, but welcomes a real new join once',async()=>{
 const current=(await api(owner).get(`/servers/${s1}/bots`)).body.find((i:any)=>i.bot.builtin);
 expect(current).toBeTruthy();expect((await api(owner).delete(`/servers/${s1}/bots/${current.id}`)).status).toBe(200);
 const installed=await api(owner).post(`/servers/${s1}/bots`,{botId:builtin.id,channelIds:[hall.id],permissions:['SEND_MESSAGES','COMMANDS'],config:{welcome:'新成员 {name}'}});
 expect(installed.status).toBe(201);
 const before=await prisma.message.count({where:{conversationId:hall.conversationId,sender:{role:'BOT'}}});
 const invite=await api(owner).post(`/servers/${s1}/invites`,{hours:1,maxUses:10});expect(invite.status).toBe(201);
 const existing=await Promise.all([api(a).post(`/invites/${invite.body.token}/join`),api(a).post(`/invites/${invite.body.token}/join`)]);
 expect(existing.map(r=>r.status)).toEqual([200,200]);
 expect(await prisma.message.count({where:{conversationId:hall.conversationId,sender:{role:'BOT'}}})).toBe(before);
 expect(await prisma.botWelcome.count({where:{installationId:installed.body.id,userId:a.user.id}})).toBe(0);
 const newcomer=await register('new');
 const joined=await Promise.all([api(newcomer).post(`/invites/${invite.body.token}/join`),api(newcomer).post(`/invites/${invite.body.token}/join`)]);
 expect(joined.map(r=>r.status)).toEqual([200,200]);
 expect(await prisma.message.count({where:{conversationId:hall.conversationId,sender:{role:'BOT'}}})).toBe(before+1);
 expect(await prisma.botWelcome.count({where:{installationId:installed.body.id,userId:newcomer.user.id}})).toBe(1);
 expect((await prisma.serverInvite.findUnique({where:{id:invite.body.id}})).uses).toBe(1);
});
