// Run on the developer's computer. The website never receives the bot credential.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const base = new URL(process.env.HARBOR_URL || 'http://localhost:5173');
if (base.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(base.hostname)) throw Error('HTTPS required');
const output = process.env.BOT_CREDENTIALS;
if (!output || !process.env.BOT_DEVELOPER_USERNAME || !process.env.BOT_DEVELOPER_PASSWORD) throw Error('Set BOT_CREDENTIALS, BOT_DEVELOPER_USERNAME and BOT_DEVELOPER_PASSWORD');
const request = async (path, body, auth) => {
 const r = await fetch(`${base.origin}/api${path}`, {method:'POST',headers:{Origin:base.origin,'Content-Type':'application/json',...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},body:JSON.stringify(body)});
 if(!r.ok)throw Error(`Developer request rejected: HTTP ${r.status}`);
 return {...await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
};
const session = await request('/auth/login',{username:process.env.BOT_DEVELOPER_USERNAME,password:process.env.BOT_DEVELOPER_PASSWORD});
try {
 const rotating=process.env.BOT_ROTATE_ID;
 const bot = await request(rotating?`/bots/${encodeURIComponent(rotating)}/rotate`:'/bots',rotating?{}:{name:process.env.BOT_NAME || `Harbor helper ${randomUUID().slice(0,5)}`},session);
 await writeFile(output,JSON.stringify({base:base.origin,botId:bot.id,token:bot.token}),{mode:0o600,flag:'wx'});
 console.log(`Bot ID: ${bot.id}. Credential saved privately; install this ID in community settings.`);
} finally {await request('/auth/logout',{},session);}
