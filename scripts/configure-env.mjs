import {randomBytes} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
const target=new URL('../.env',import.meta.url);
const content=await readFile(new URL('../.env.example',import.meta.url),'utf8');
const result=content.replaceAll('CHANGE_ME_WITH_RANDOM_HEX',randomBytes(32).toString('hex')).replaceAll('CHANGE_ME_WITH_ANOTHER_RANDOM_HEX',randomBytes(32).toString('hex'));
await writeFile(target,result,{flag:'wx',mode:0o600});
console.log('Created .env with random database/cache credentials. Edit APP_ORIGIN and deployment settings before production.');
