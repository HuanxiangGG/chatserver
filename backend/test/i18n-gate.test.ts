import {afterEach, expect, it} from 'vitest';
import {mkdtempSync, cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const temporary:string[]=[];
function fixture(){
 const dir=mkdtempSync(path.join(tmpdir(),'harbor-i18n-gate-'));temporary.push(dir);mkdirSync(path.join(dir,'frontend'));
 // The gate scans TypeScript and catalogs. Images, fonts and audio are not inputs.
 cpSync(path.resolve('../frontend/src'),path.join(dir,'frontend/src'),{recursive:true,filter:source=>statSync(source).isDirectory()||/\.(?:tsx?|json)$/.test(source)});
 return {dir,run:()=>spawnSync(process.execPath,[path.resolve('../scripts/i18n-check.mjs')],{cwd:dir,encoding:'utf8'}),dictionary:path.join(dir,'frontend/src/locales/sound.json')};
}
afterEach(()=>temporary.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true})));
it('passes the complete real source tree and rejects new hardcoded Chinese and English UI',()=>{
 const f=fixture();expect(f.run().status).toBe(0);writeFileSync(path.join(f.dir,'frontend/src/Untranslated.tsx'),'<div>未翻译 Hardcoded English</div>');const result=f.run();expect(result.status).toBe(1);expect(result.stderr).toContain('Untranslated.tsx');
});
// Independent failures get independent deadlines; do not put four complete CLI
// runs under one timeout or relax the production translation checker.
it.each([
 ['missing','Missing translation',(d:any)=>delete d.en.notificationTitle],
 ['unused','Unused translation key',(d:any)=>{d.en.unusedRegressionKey='Unused';d['zh-CN'].unusedRegressionKey='未使用';}],
 ['interpolation','Interpolation mismatch',(d:any)=>{d.en.volume='Volume {wrong}';}],
] as const)('rejects %s catalog keys',(_name,diagnostic,change)=>{
 const f=fixture(),dictionary=JSON.parse(readFileSync(f.dictionary,'utf8'));change(dictionary);writeFileSync(f.dictionary,JSON.stringify(dictionary));const result=f.run();expect(result.status).toBe(1);expect(result.stderr).toContain(diagnostic);
});
it('rejects duplicate catalog keys',()=>{const f=fixture(),original=readFileSync(f.dictionary,'utf8');writeFileSync(f.dictionary,original.replace('"en": {','"en": {"title":"duplicate",'));const result=f.run();expect(result.status).toBe(1);expect(result.stderr).toContain('Duplicate translation key');});
it('rejects invalid translation references even when no hardcoded text is present',()=>{const f=fixture();writeFileSync(path.join(f.dir,'frontend/src/Invalid.tsx'),"const v = t('keyThatDoesNotExist');");const result=f.run();expect(result.status).toBe(1);expect(result.stderr).toContain('invalid translation key');});
it.each([
 '<button>{busy ? "Sending..." : "Send message"}</button>',
 '<p>{`Welcome ${username}`}</p>',
 '<p>{error && (message || "Please try again")}</p>',
 '<button aria-label={open ? "Close panel" : "Open panel"} />',
 '<Dialog title={`Details for ${name}`}><input placeholder={"Type here"} /></Dialog>',
 '<p>{["First line", "Second line"]}</p>',
])('rejects untranslated rendered expression %s',source=>{const f=fixture();writeFileSync(path.join(f.dir,'frontend/src/ExpressionText.tsx'),source);const result=f.run();expect(result.status).toBe(1);expect(result.stderr).toContain('ExpressionText.tsx');});
it('preserves internal values and translated accessible labels',()=>{const f=fixture();writeFileSync(path.join(f.dir,'frontend/src/ExpressionText.tsx'),'<button className={active ? "active" : "idle"} onClick={() => setMode("dark")} aria-label={t("title")}>{mode === "dark" ? t("title") : username}</button>');expect(f.run().status).toBe(0);});
