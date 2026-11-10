import {afterEach, expect, it} from 'vitest';
import {mkdtempSync, cpSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const temporary:string[]=[];
function fixture(){const dir=mkdtempSync(path.join(tmpdir(),'harbor-i18n-gate-'));temporary.push(dir);mkdirSync(path.join(dir,'frontend'));cpSync(path.resolve('../frontend/src'),path.join(dir,'frontend/src'),{recursive:true});return {dir,run:()=>spawnSync(process.execPath,[path.resolve('../scripts/i18n-check.mjs')],{cwd:dir,encoding:'utf8'}),dictionary:path.join(dir,'frontend/src/locales/sound.json')};}
afterEach(()=>temporary.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true})));
it('passes the complete real source tree and rejects new hardcoded Chinese and English UI',()=>{const f=fixture();expect(f.run().status).toBe(0);writeFileSync(path.join(f.dir,'frontend/src/Untranslated.tsx'),'<div>未翻译 Hardcoded English</div>');const result=f.run();expect(result.status).toBe(1);expect(result.stderr).toContain('Untranslated.tsx');});
it('rejects missing, duplicate, unused and mismatched interpolation keys',()=>{const f=fixture(),original=readFileSync(f.dictionary,'utf8');const mutate=(change:(d:any)=>void)=>{const d=JSON.parse(original);change(d);writeFileSync(f.dictionary,JSON.stringify(d));return f.run();};
 expect(mutate(d=>delete d.en.notificationTitle).stderr).toContain('Missing translation');
 expect(mutate(d=>{d.en.unusedRegressionKey='Unused';d['zh-CN'].unusedRegressionKey='未使用';}).stderr).toContain('Unused translation key');
 expect(mutate(d=>{d.en.volume='Volume {wrong}';}).stderr).toContain('Interpolation mismatch');
 writeFileSync(f.dictionary,original.replace('"en": {','"en": {"title":"duplicate",'));expect(f.run().stderr).toContain('Duplicate translation key');
});
it('rejects invalid translation references even when no hardcoded text is present',()=>{const f=fixture();writeFileSync(path.join(f.dir,'frontend/src/Invalid.tsx'),"const v = t('keyThatDoesNotExist');");expect(f.run().stderr).toContain('invalid translation key');});
it('rejects hardcoded rendered expressions and accessible labels while preserving internal values',()=>{
 const f=fixture(),file=path.join(f.dir,'frontend/src/ExpressionText.tsx');
 for(const source of [
  '<button>{busy ? "Sending..." : "Send message"}</button>',
  '<p>{`Welcome ${username}`}</p>',
  '<p>{error && (message || "Please try again")}</p>',
  '<button aria-label={open ? "Close panel" : "Open panel"} />',
  '<Dialog title={`Details for ${name}`}><input placeholder={"Type here"} /></Dialog>',
  '<p>{["First line", "Second line"]}</p>',
 ]) {
  writeFileSync(file,source);const result=f.run();expect(result.status).toBe(1);expect(result.stderr).toContain('ExpressionText.tsx');
 }
 writeFileSync(file,'<button className={active ? "active" : "idle"} onClick={() => setMode("dark")} aria-label={t("title")}>{mode === "dark" ? t("title") : username}</button>');
 expect(f.run().status).toBe(0);
});
