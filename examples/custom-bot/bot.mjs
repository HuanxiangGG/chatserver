// Independent process: never upload or execute this code on the Harbor server.
import { readFile, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
const filename=process.env.BOT_CREDENTIALS;
if(!filename)throw Error('Set BOT_CREDENTIALS to the private credential file');
if((await stat(filename)).mode & 0o077)throw Error('Credential file must be readable only by its owner (chmod 600)');
const credential=JSON.parse(await readFile(filename,'utf8')),base=new URL(credential.base);
if(base.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(base.hostname))throw Error('HTTPS required');
if(!/^[a-f0-9]{64}$/.test(credential.token))throw Error('Invalid credential format');
async function request(path,body){const response=await fetch(`${base.origin}/api${path}`,{method:body?'POST':'GET',headers:{Origin:credential.origin || base.origin,Authorization:`Bearer ${credential.token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(!response.ok)throw Error(`Bot request rejected: HTTP ${response.status}`);return response.json();}
let cursor=process.env.BOT_CURSOR || '',stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;});
while(!stopping){
 const page=await request(`/bot/events${cursor?`?after=${encodeURIComponent(cursor)}`:''}`);
 for(const event of page.events){
  // The server has filtered events to current installation/channel grants and
  // excluded all bot messages. Reading is separate from COMMANDS permission.
  if(event.type==='command' && event.payload.command==='ping'){
   await request('/bot/messages',{installationId:event.installationId,conversationId:event.payload.conversationId,content:'Pong',clientId:`event:${event.id}`});
   console.log('Command response delivered.');
   if(process.argv.includes('--once'))stopping=true;
  }
 }
 cursor=page.cursor || cursor;
 if(!stopping)await delay(1000);
}
