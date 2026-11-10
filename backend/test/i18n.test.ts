// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {setLanguage, translate, localizeApiError, useTranslation} from '../../frontend/src/i18n';
import {roleNames} from '../../frontend/src/communities';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
const localeDir=resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/src/locales');
const dictionaries:Record<'zh-CN'|'en',Record<string,string>>={'zh-CN':{},en:{}};
for(const file of readdirSync(localeDir).filter(f=>f.endsWith('.json')&&f!=='api-errors.json')){const catalog=JSON.parse(readFileSync(join(localeDir,file),'utf8'));for(const language of ['zh-CN','en'] as const)Object.assign(dictionaries[language],catalog[language]);}
import apiKeys from '../../frontend/src/locales/api-errors.json';
afterEach(()=>{setLanguage('zh-CN');localStorage.clear();});
it('matches all language keys and interpolation variables',()=>{
 expect(Object.keys(dictionaries.en).sort()).toEqual(Object.keys(dictionaries['zh-CN']).sort());
 for(const key of Object.keys(dictionaries.en) as (keyof typeof dictionaries.en)[]){const vars=(s:string)=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();expect(vars(dictionaries.en[key])).toEqual(vars(dictionaries['zh-CN'][key]));}
});
it('updates mounted UI, community roles and language persistence without remounting',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div');document.body.append(host);const root=createRoot(host);document.title='';document.querySelector('meta[name="description"]')?.remove();
 function View(){const t=useTranslation();return React.createElement('p',null,t('notificationTitle'));}
 await act(async()=>root.render(React.createElement(View)));const original=host.querySelector('p');expect(host.textContent).toBe('浏览器系统通知');expect(document.title).toBe(translate('uiDocumentTitle'));expect(document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content).toBe(translate('uiDocumentDescription'));
 await act(async()=>setLanguage('en'));expect(host.querySelector('p')).toBe(original);expect(host.textContent).toBe('Browser notifications');expect(roleNames.MODERATOR).toBe('Moderator');expect(localStorage.getItem('harbor.language')).toBe('en');expect(document.documentElement.lang).toBe('en');expect(document.title).toBe('Harbor · Messages');expect(document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content).toBe(translate('uiDocumentDescription'));
 localStorage.setItem('harbor.language','zh-CN');await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key:'harbor.language',newValue:'zh-CN'})));expect(host.querySelector('p')).toBe(original);expect(host.textContent).toBe('浏览器系统通知');expect(document.documentElement.lang).toBe('zh-CN');expect(document.title).toBe('泊岸 · 聊天');expect(document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content).toBe(translate('uiDocumentDescription'));
 await act(async()=>root.unmount());host.remove();
});
it('formats variables and localizes every documented API error in both languages',()=>{
 for(const language of ['zh-CN','en'] as const){setLanguage(language);for(const [message,key]of Object.entries(apiKeys)){expect(localizeApiError(message)).toBe(dictionaries[language][key as keyof typeof dictionaries.en]);}}
 setLanguage('en');expect(translate('navUnreadCount',{count:3})).toContain('3');expect(localizeApiError('字段校验失败：用户名：格式或长度不符合要求')).toBe(dictionaries.en.apiFieldError);
});
