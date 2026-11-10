// CI-only fixture and read-only backup assertions; never target a public server.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = new URL(process.env.BACKUP_CI_URL || 'http://127.0.0.1:8080');
assert(process.env.GITHUB_ACTIONS === 'true' && /^\/home\/runner\//.test(process.env.RUNNER_TEMP || ''), 'Backup fixture is GitHub CI-only');
assert(base.protocol === 'http:' && ['localhost','127.0.0.1'].includes(base.hostname) && base.port === '8080' && base.pathname === '/' && !base.username && !base.password && !base.search && !base.hash, 'Backup fixture only permits the local CI Compose HTTP endpoint');
const mode = process.argv[2], origin = process.env.APP_ORIGIN;
const tables = ['User','Conversation','ConversationMember','Message','MessageAttachment','MessageRead','GroupAnnouncement','Report','Server','ServerMember','ServerBan','ServerInvite','ChannelCategory','Channel','ChannelGrant','ServerRole','ServerRoleMember','ChannelRoleOverride','Ticket','Bot','BotInstallation','BotWelcome','BotEvent','AdminAction','GuestTicketSession','ChannelRestriction'];
const required = ['User','Conversation','ConversationMember','Message','MessageAttachment','MessageRead','Server','ServerMember','ServerInvite','ChannelCategory','Channel','ChannelGrant','ServerRole','ServerRoleMember','ChannelRoleOverride','Ticket','Bot','BotInstallation','BotWelcome','BotEvent','AdminAction','GuestTicketSession','ChannelRestriction'];
const fixtureKeys = ['fixture:server','fixture:channels','fixture:roles','fixture:role-members','fixture:tickets','fixture:ticket-history','fixture:channel-history','fixture:attachment','fixture:bots','fixture:installations','fixture:welcomes','fixture:events','fixture:guest-sessions','fixture:restrictions'];
async function call(path, method = 'GET', body, person) {
 const label=path.replace(/\/invites\/[a-f0-9]{64}/g,'/invites/<redacted>').split('?')[0];
 let response;
 try { response = await fetch(`${base.origin}/api${path}`, {method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Origin:origin,'X-Forwarded-Proto':'https',...(body && !(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...(person?{Cookie:person.cookie,'X-CSRF-Token':person.csrfToken}:{})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)}); } catch { throw Error(`CI backup fixture ${method} ${label}: local request failed`); }
 assert(response.ok,`CI backup fixture ${method} ${label}: HTTP ${response.status}`);
 const data=await response.json();return Array.isArray(data)?data:{...data,cookie:response.headers.get('set-cookie')?.split(';')[0] || person?.cookie};
}
function fileInRunner(filename) {
 const root=resolve(process.env.RUNNER_TEMP),path=resolve(filename || '');
 assert(path.startsWith(root+'/'),'CI artifacts must stay in the private runner directory');return path;
}
async function fixture() { const data=JSON.parse(await readFile(fileInRunner(process.argv[3]),'utf8'));for(const value of Object.values(data)){if(typeof value==='string')assert(/^[a-zA-Z0-9_-]{1,100}$/.test(value),'Invalid fixture identifier');if(Array.isArray(value))for(const id of value)assert(/^[a-zA-Z0-9_-]{1,100}$/.test(id),'Invalid fixture identifier');}return data; }
if(mode==='seed') {
 assert(origin && new URL(origin).protocol === 'https:','Use the CI stack\'s configured HTTPS Origin');
 await call('/health');
 const prefix=`bk_${randomBytes(5).toString('hex')}`,password=randomBytes(24).toString('hex');
 const register=index=>call('/auth/register','POST',{username:`${prefix}_${index}`,email:`${prefix}_${index}@example.test`,displayName:`CI backup ${index}`,password});
 const owner=await register('owner'),member=await register('member'),handler=await register('handler');
 try {
  const server=await call('/servers','POST',{name:'CI backup community',description:'Disposable backup acceptance'},owner);
  const detail=await call(`/servers/${server.id}`,'GET',undefined,owner),hall=detail.channels[0];
  const category=await call(`/servers/${server.id}/categories`,'POST',{name:'CI public',position:1},owner);
  await call(`/servers/${server.id}/channels/${hall.id}`,'PATCH',{name:'hall',categoryId:category.id},owner);
  const role=await call(`/servers/${server.id}/roles`,'POST',{name:'CI handler',position:10,permissions:{handleTickets:true}},owner);
  const privateChannel=await call(`/servers/${server.id}/channels`,'POST',{name:'staff',isPrivate:true,userIds:[owner.user.id],roleOverrides:[{roleId:role.id,permissions:{view:true}}]},owner);
  const catalog=await call('/bots/catalog','GET',undefined,owner);
  const builtIn=catalog.find(bot=>bot.builtin);
  assert(builtIn,'Built-in bot missing');
  const installed=await call(`/servers/${server.id}/bots`,'POST',{botId:builtIn.id,channelIds:[hall.id],permissions:['SEND_MESSAGES','COMMANDS'],config:{welcome:'CI welcome {name}'}},owner);
  const custom=await call('/bots','POST',{name:'CI backup bot'},owner);
  const customInstall=await call(`/servers/${server.id}/bots`,'POST',{botId:custom.id,channelIds:[hall.id],permissions:['READ_MESSAGES','COMMANDS','SEND_MESSAGES'],config:{commands:['ping']}},owner);
  const invite=await call(`/servers/${server.id}/invites`,'POST',{hours:1,maxUses:3},owner);
  await call(`/invites/${invite.token}/join`,'POST',{},member);await call(`/invites/${invite.token}/join`,'POST',{},handler);
  await call(`/servers/${server.id}/roles/${role.id}/members`,'PUT',{userIds:[handler.user.id]},owner);
  await call(`/conversations/${hall.conversationId}/messages`,'POST',{content:'CI community history',clientId:randomUUID()},member);
  await call(`/servers/${server.id}/commands`,'POST',{conversationId:hall.conversationId,command:'ping'},member);
  const ticket=await call(`/servers/${server.id}/tickets`,'POST',{subject:'CI member ticket',category:'support',content:'CI ticket first message',clientId:randomUUID()},member);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKAAAAABJRU5ErkJggg==','base64');
  const form=new FormData();form.append('file',new Blob([png],{type:'image/png'}),'ci-ticket.png');
  const upload=await call(`/uploads?conversationId=${ticket.conversationId}`,'POST',form,member);
  const message=await call(`/conversations/${ticket.conversationId}/messages`,'POST',{content:'CI ticket attachment',attachmentIds:[upload.id],clientId:randomUUID()},member);
  await call(`/tickets/${ticket.id}`,'PATCH',{assigneeId:handler.user.id},owner);
  await call(`/conversations/${ticket.conversationId}/messages`,'POST',{content:'CI owner reply',replyToId:message.id,clientId:randomUUID()},owner);
  await call(`/conversations/${ticket.conversationId}/read`,'POST',{messageId:message.id},handler);
  const proactive=await call(`/servers/${server.id}/tickets`,'POST',{memberId:member.user.id,subject:'CI owner ticket',category:'support',content:'CI proactive history',clientId:randomUUID()},owner);
  await call(`/tickets/${proactive.id}`,'PATCH',{status:'CLOSED'},owner);
  await call(`/conversations/${privateChannel.conversationId}/messages`,'POST',{content:'CI archived channel history',clientId:randomUUID()},owner);
  await call(`/servers/${server.id}/channels/${privateChannel.id}`,'DELETE',undefined,owner);
  await call(`/servers/${server.id}/ticket-settings`,'PATCH',{privateTicketsEnabled:true,guestTicketsEnabled:true},owner);
  const guest=await call(`/guest/${server.id}/tickets`,'POST',{clientId:randomUUID(),displayName:'CI guest',subject:'CI guest ticket',content:'CI guest history',recoveryCode:randomBytes(32).toString('hex')});
  await call(`/conversations/${guest.ticket.conversationId}/messages`,'POST',{content:'CI owner to guest',clientId:randomUUID()},owner);
  await call(`/servers/${server.id}/members/${member.user.id}/channel-restrictions`,'PUT',{channelIds:[hall.id],minutes:60,reason:'CI isolated restriction'},owner);
  console.log(JSON.stringify({serverId:server.id,channelIds:[hall.id,privateChannel.id],roleId:role.id,ticketIds:[ticket.id,proactive.id,guest.ticket.id],conversationIds:[ticket.conversationId,proactive.conversationId,guest.ticket.conversationId],channelConversationIds:[hall.conversationId,privateChannel.conversationId],attachmentId:upload.id,attachmentSha256:createHash('sha256').update(png).digest('hex'),botIds:[builtIn.id,custom.id],installationIds:[installed.id,customInstall.id]}));
 } finally {for(const person of [owner,member,handler])await call('/auth/logout','POST',{},person);}
} else if(mode==='sql') {
 const data=await fixture(),quote=value=>`'${value}'`,ids=values=>values.map(quote).join(',');
 // Fixed model names; fixture IDs are strictly alphanumeric above, never user SQL.
 for(const name of tables)console.log(`SELECT '${name}' AS label, count(*) AS count, '' AS digest FROM "${name}";`);
 const snapshots=[
  ['server','Server',`"id"=${quote(data.serverId)}`],
  ['channels','Channel',`"id" IN (${ids(data.channelIds)})`],
  ['roles','ServerRole',`"id"=${quote(data.roleId)}`],
  ['role-members','ServerRoleMember',`"roleId"=${quote(data.roleId)}`],
  ['guest-sessions','GuestTicketSession',`"ticketId" IN (${ids(data.ticketIds)})`],
  ['restrictions','ChannelRestriction',`"channelId" IN (${ids(data.channelIds)})`],
  ['tickets','Ticket',`"id" IN (${ids(data.ticketIds)})`],
  ['ticket-history','Message',`"conversationId" IN (${ids(data.conversationIds)})`],
  ['channel-history','Message',`"conversationId" IN (${ids(data.channelConversationIds)})`],
  ['attachment','MessageAttachment',`"id"=${quote(data.attachmentId)}`],
  ['bots','Bot',`"id" IN (${ids(data.botIds)})`],
  ['installations','BotInstallation',`"id" IN (${ids(data.installationIds)})`],
  ['welcomes','BotWelcome',`"installationId" IN (${ids(data.installationIds)})`],
  ['events','BotEvent',`"installationId" IN (${ids(data.installationIds)})`],
 ];
 for(const [label,table,where]of snapshots)console.log(`SELECT 'fixture:${label}', count(*), md5(COALESCE(string_agg(to_jsonb(r)::text, '' ORDER BY to_jsonb(r)::text), '')) FROM "${table}" r WHERE ${where};`);
} else if(mode==='assert-counts') {
 const rows=(await readFile(fileInRunner(process.argv[3]),'utf8')).trim().split('\n').map(line=>line.split('|'));
 const counts=new Map(rows.map(([name,count])=>[name,Number(count)]));
 for(const name of [...tables,...fixtureKeys])assert(Number.isSafeInteger(counts.get(name)) && counts.get(name)>=0,`Missing backup count: ${name}`);
 for(const name of [...required,...fixtureKeys])assert(counts.get(name)>0,`Backup model/fixture unexpectedly empty: ${name}`);
 assert(counts.get('fixture:tickets')===3 && counts.get('fixture:ticket-history')>=6 && counts.get('fixture:installations')===2,'Ticket/bot fixture history incomplete');
 console.log('Community, ticket, bot and history backup counts are nonzero.');
} else if(mode==='attachment-sql') {
 const data=await fixture();console.log(`SELECT "storageKey" FROM "MessageAttachment" WHERE "id"='${data.attachmentId}';`);
} else if(mode==='assert-upload') {
 const data=await fixture(),storageKey=process.argv[4],root=fileInRunner(process.argv[5]);assert(/^[a-f0-9-]+\.png$/.test(storageKey),'Unexpected CI attachment path');
 assert(createHash('sha256').update(await readFile(resolve(root,storageKey))).digest('hex')===data.attachmentSha256,'Restored ticket upload differs');console.log('Restored private ticket PNG checksum passed.');
} else throw Error('Choose seed, sql, assert-counts, attachment-sql or assert-upload');
