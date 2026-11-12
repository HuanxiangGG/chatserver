// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Link, createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom';
import { SoundRuntime, SoundSettingsPanel } from '../../frontend/src/sound-ui';
const mock = vi.hoisted(() => ({ api: vi.fn(), events: new Map<string, Function>(), user: null as any, conversations: [] as any[] }));
vi.mock('../../frontend/src/state', () => ({ useApp: () => ({ user: mock.user, conversations: mock.conversations, socket: null }) }));
vi.mock('../../frontend/src/api', () => ({ api: mock.api, json: (method: string, body: unknown) => ({ method, body }) }));
let root: Root, host: HTMLDivElement, router: ReturnType<typeof createMemoryRouter>;
beforeEach(async () => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); mock.api.mockReset();
 vi.stubGlobal('Audio', class { preload = ''; volume = 0; currentTime = 0; load() {} pause() {} removeAttribute() {} async play() {} });
 host = document.createElement('div'); document.body.append(host); root = createRoot(host);
 router=createMemoryRouter([{element:React.createElement(React.Fragment,null,React.createElement(SoundRuntime),React.createElement(Outlet)),children:[{path:'/',element:React.createElement(React.Fragment,null,React.createElement(SoundSettingsPanel),React.createElement(Link,{to:'/other'},'other'))},{path:'/other',element:React.createElement('p',null,'other page')}]}],{initialEntries:['/other','/']});
 await act(async () => root.render(React.createElement(RouterProvider,{router})));
});
afterEach(async () => { await act(async () => root.unmount()); router.dispose(); host.remove(); vi.unstubAllGlobals(); });
it('updates every sound setting immediately when switching to English and back', async () => {
 const select = host.querySelector('select')!;
 await act(async () => { select.value = 'en'; select.dispatchEvent(new Event('change', { bubbles: true })); });
 expect(host.textContent).toContain('Message sounds'); expect(host.textContent).toContain('Do not disturb'); expect(host.textContent).toContain('Volume: 50%');
 expect(localStorage.getItem('harbor.language')).toBe('en');
 await act(async () => { select.value = 'zh-CN'; select.dispatchEvent(new Event('change', { bubbles: true })); });
 expect(host.textContent).toContain('免打扰模式'); expect(host.textContent).toContain('消息声音');
});
it('keeps sound changes as a draft until saved and shows visual test feedback without alert', async () => {
 const toggle = host.querySelector('input[type=checkbox]')! as HTMLInputElement;
 await act(async () => toggle.click()); expect(localStorage.getItem('harbor.sound.guest')).toBeNull();
 const save = [...host.querySelectorAll('button')].find(b => b.textContent === '保存设置')!;
 await act(async () => save.click()); expect(JSON.parse(localStorage.getItem('harbor.sound.guest')!).enabled).toBe(false);
 const button = [...host.querySelectorAll('button')].find(b => b.textContent === '测试提示音')!;
 await act(async () => button.click()); expect(host.querySelector('[aria-live]')?.textContent).toBe('提示音已播放');
 expect(mock.api).not.toHaveBeenCalled();
});
it('renders controls suitable for narrow screens without a fixed content width', () => {
 expect(host.querySelector('input[type=range]')?.getAttribute('max')).toBe('100');
 expect(host.querySelectorAll('.sound-times input[type=time]')).toHaveLength(2);
 expect(host.querySelector('.sound-settings')?.getAttribute('style')).toBeNull();
 // Real mobile layout and software keyboard require browser/device verification.
});

it('keeps the edited value when leaving is cancelled, then discards it without saving', async () => {
 const toggle = host.querySelector('input[type=checkbox]')! as HTMLInputElement;
 await act(async () => toggle.click()); expect(toggle.checked).toBe(false);
 await act(async () => (host.querySelector('a') as HTMLAnchorElement).click());
 expect(document.querySelector('[role=dialog]')).not.toBeNull();
 const keep = [...document.querySelectorAll('button')].find(b => b.textContent === '继续编辑')!;
 await act(async () => keep.click()); expect(document.querySelector('[role=dialog]')).toBeNull(); expect(toggle.checked).toBe(false);
 expect(host.querySelector('.sound-settings')).not.toBeNull(); expect(localStorage.getItem('harbor.sound.guest')).toBeNull();
 await act(async () => (host.querySelector('a') as HTMLAnchorElement).click());
 const discard = [...document.querySelectorAll('button')].find(b => b.textContent === '放弃修改')!;
 await act(async () => discard.click()); expect(host.querySelector('.sound-settings')).toBeNull(); expect(localStorage.getItem('harbor.sound.guest')).toBeNull();
});

it('blocks Back without losing edits, then permits saved navigation', async () => {
 const toggle = host.querySelector('input[type=checkbox]')! as HTMLInputElement;
 await act(async () => toggle.click());
 await act(async () => router.navigate(-1));
 expect(router.state.location.pathname).toBe('/'); expect(document.querySelector('[role=dialog]')).not.toBeNull();
 const keep=[...document.querySelectorAll('button')].find(b=>b.textContent==='继续编辑')!;
 await act(async () => keep.click()); expect(toggle.checked).toBe(false);expect(router.state.location.pathname).toBe('/');
 const save=[...host.querySelectorAll('button')].find(b=>b.textContent==='保存设置')!;
 await act(async()=>save.click()); await act(async()=>router.navigate(-1));
 expect(router.state.location.pathname).toBe('/other'); expect(document.querySelector('[role=dialog]')).toBeNull();
});
it('proceeds with Back only after explicitly discarding the unsaved draft',async()=>{
 await act(async()=> (host.querySelector('input[type=checkbox]') as HTMLInputElement).click());
 await act(async()=>router.navigate(-1));
 const discard=[...document.querySelectorAll('button')].find(b=>b.textContent==='放弃修改')!;
 await act(async()=>discard.click());expect(router.state.location.pathname).toBe('/other');expect(localStorage.getItem('harbor.sound.guest')).toBeNull();
});
