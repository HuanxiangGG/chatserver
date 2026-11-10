// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SoundRuntime, SoundSettingsPanel } from '../../frontend/src/sound-ui';
const mock = vi.hoisted(() => ({ api: vi.fn(), events: new Map<string, Function>(), user: null as any, conversations: [] as any[] }));
vi.mock('../../frontend/src/state', () => ({ useApp: () => ({ user: mock.user, conversations: mock.conversations, socket: null }) }));
vi.mock('../../frontend/src/api', () => ({ api: mock.api, json: (method: string, body: unknown) => ({ method, body }) }));
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); mock.api.mockReset();
 vi.stubGlobal('Audio', class { preload = ''; volume = 0; currentTime = 0; load() {} pause() {} removeAttribute() {} async play() {} });
 host = document.createElement('div'); document.body.append(host); root = createRoot(host);
 await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(React.Fragment, null, React.createElement(SoundRuntime), React.createElement(SoundSettingsPanel)))));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('updates every sound setting immediately when switching to English and back', async () => {
 const select = host.querySelector('select')!;
 await act(async () => { select.value = 'en'; select.dispatchEvent(new Event('change', { bubbles: true })); });
 expect(host.textContent).toContain('Message sounds'); expect(host.textContent).toContain('Do not disturb'); expect(host.textContent).toContain('Volume: 50%');
 expect(localStorage.getItem('harbor.language')).toBe('en');
 await act(async () => { select.value = 'zh-CN'; select.dispatchEvent(new Event('change', { bubbles: true })); });
 expect(host.textContent).toContain('免打扰模式'); expect(host.textContent).toContain('消息声音');
});
it('persists anonymous browser switches and shows visual test feedback without alert', async () => {
 const toggle = host.querySelector('input[type=checkbox]')! as HTMLInputElement;
 await act(async () => toggle.click()); expect(JSON.parse(localStorage.getItem('harbor.sound.guest')!).enabled).toBe(false);
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
