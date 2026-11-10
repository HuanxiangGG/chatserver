// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppearanceSettings } from '../../frontend/src/appearance';
import { defaultAppearance, normalizeAppearance, updateAppearance, useAppearance, useAppearanceRuntime } from '../../frontend/src/appearance-store';
import { setLanguage } from '../../frontend/src/i18n';
const calls = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../frontend/src/api', () => ({ api: calls.api, json: (method: string, body: unknown) => ({ method, body }) }));
let root: Root, host: HTMLDivElement;
const mediaListeners = new Set<() => void>();
const media = { matches: false, addEventListener: (_: string, fn: () => void) => mediaListeners.add(fn), removeEventListener: (_: string, fn: () => void) => mediaListeners.delete(fn) };
function View({ userId }: { userId?: string }) { useAppearanceRuntime(userId); const value = useAppearance(); return React.createElement(React.Fragment, null, React.createElement('output', null, value.resolved), React.createElement(AppearanceSettings)); }
beforeEach(async () => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); setLanguage('en'); calls.api.mockReset(); calls.api.mockResolvedValue({ appearance: null }); media.matches = false; vi.stubGlobal('matchMedia', () => media);
 host = document.createElement('div'); document.body.append(host); root = createRoot(host);
 await act(async () => root.render(React.createElement(View)));
 await act(async () => updateAppearance(defaultAppearance));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); setLanguage('zh-CN'); vi.unstubAllGlobals(); });
it('validates persisted preferences and falls back safely on invalid values', () => {
 expect(normalizeAppearance({ mode: '*', accent: 'red', density: 'oversized', fontSize: 99, animations: 'yes' })).toEqual(defaultAppearance);
 expect(normalizeAppearance({ mode: 'system', accent: 'teal', density: 'compact', fontSize: 18, animations: false })).toEqual({ mode: 'system', accent: 'teal', density: 'compact', fontSize: 18, animations: false });
});
it('updates every appearance control and persists guest preferences without an API request', async () => {
 const light = [...host.querySelectorAll('button')].find(b => b.textContent === 'Light')!;
 await act(async () => light.click());
 const selects = [...host.querySelectorAll('select')];
 await act(async () => { selects[0].value = 'teal'; selects[0].dispatchEvent(new Event('change', { bubbles: true })); });
 await act(async () => { selects[1].value = 'compact'; selects[1].dispatchEvent(new Event('change', { bubbles: true })); });
 await act(async () => { selects[2].value = '18'; selects[2].dispatchEvent(new Event('change', { bubbles: true })); });
 await act(async () => (host.querySelector('input[type=checkbox]') as HTMLInputElement).click());
 expect(document.documentElement.dataset).toMatchObject({ theme: 'light', accent: 'teal', density: 'compact', motion: 'reduced' });
 expect(document.documentElement.style.getPropertyValue('--message-font-size')).toBe('18px');
 expect(JSON.parse(localStorage.getItem('harbor.appearance.guest')!)).toEqual({ mode: 'light', accent: 'teal', density: 'compact', fontSize: 18, animations: false });
 expect(calls.api).not.toHaveBeenCalled(); expect(host.textContent).toContain('Appearance saved');
});
it('follows operating system changes and detaches listeners on unmount', async () => {
 await act(async () => updateAppearance({ mode: 'system' })); expect(host.querySelector('output')?.textContent).toBe('light');
 await act(async () => { media.matches = true; mediaListeners.forEach(fn => fn()); }); expect(document.documentElement.dataset.theme).toBe('dark');
 await act(async () => updateAppearance({ mode: 'light' }));
 await act(async () => { media.matches = false; mediaListeners.forEach(fn => fn()); }); expect(document.documentElement.dataset.theme).toBe('light');
 expect(mediaListeners.size).toBe(1);
});
it('loads account settings, serializes changes and leaves the guest preferences separate', async () => {
 calls.api.mockResolvedValueOnce({ appearance: { ...defaultAppearance, accent: 'violet' } });
 await act(async () => root.render(React.createElement(View, { userId: 'alice' })));
 expect(document.documentElement.dataset.accent).toBe('violet');
 calls.api.mockResolvedValue({});
 await act(async () => { updateAppearance({ mode: 'light' }); updateAppearance({ fontSize: 18 }); });
 const writes = calls.api.mock.calls.filter(call => call[1]?.method === 'PUT');
 expect(writes.at(-1)?.[1].body).toMatchObject({ mode: 'light', fontSize: 18, accent: 'violet' });
 expect(JSON.parse(localStorage.getItem('harbor.appearance.alice')!).fontSize).toBe(18);
 expect(JSON.parse(localStorage.getItem('harbor.appearance.guest')!).fontSize).toBe(16);
});
it('shows a retry after synchronization failure without discarding the current appearance', async () => {
 calls.api.mockResolvedValueOnce({ appearance: defaultAppearance });
 await act(async () => root.render(React.createElement(View, { userId: 'bob' })));
 calls.api.mockRejectedValueOnce(new Error('network'));
 await act(async () => updateAppearance({ accent: 'teal' }));
 expect(document.documentElement.dataset.accent).toBe('teal'); expect(host.textContent).toContain('Preferences could not sync');
 calls.api.mockResolvedValue({});
 await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Retry saving')!.click());
 expect(host.textContent).toContain('Appearance saved');
});
it('switches all appearance labels immediately between Chinese and English', async () => {
 expect(host.textContent).toContain('Appearance & reading'); await act(async () => setLanguage('zh-CN')); expect(host.textContent).toContain('外观与阅读'); expect(host.textContent).not.toContain('Appearance & reading');
});
it('does not let a delayed account load overwrite a newer explicit theme choice', async () => {
 let resolve!: (value: unknown) => void;
 const pending = new Promise(value => { resolve = value; });
 calls.api.mockImplementation((_url, options) => options?.method === 'PUT' ? Promise.resolve({}) : pending);
 await act(async () => root.render(React.createElement(View, { userId: 'race' })));
 await act(async () => updateAppearance({ mode: 'light', accent: 'teal' }));
 await act(async () => resolve({ appearance: { ...defaultAppearance, mode: 'dark', accent: 'violet' } }));
 expect(document.documentElement.dataset).toMatchObject({ theme: 'light', accent: 'teal' });
});
it('serializes the first guest import before a newer account save', async () => {
 let release!: (value: unknown) => void;
 const seed = new Promise(value => { release = value; });
 let writes = 0;
 calls.api.mockImplementation((_url, options) => { if (options?.method !== 'PUT') return Promise.resolve({ appearance: null }); return ++writes === 1 ? seed : Promise.resolve({}); });
 await act(async () => root.render(React.createElement(View, { userId: 'first-import' })));
 expect(writes).toBe(1);
 await act(async () => updateAppearance({ mode: 'light', accent: 'teal' }));
 expect(writes).toBe(1);
 await act(async () => release({}));
 expect(writes).toBe(2);
 expect(calls.api.mock.calls.filter(call => call[1]?.method === 'PUT').at(-1)?.[1].body).toMatchObject({ mode: 'light', accent: 'teal' });
 expect(document.documentElement.dataset).toMatchObject({ theme: 'light', accent: 'teal' });
});
it('preserves another tab’s local change while an older account request is pending', async () => {
 let resolve!: (value: unknown) => void;
 const pending = new Promise(value => { resolve = value; });
 calls.api.mockImplementation((_url, options) => options?.method === 'PUT' ? Promise.resolve({}) : pending);
 await act(async () => root.render(React.createElement(View, { userId: 'other-tab' })));
 await act(async () => { localStorage.setItem('harbor.appearance.other-tab', JSON.stringify({ ...defaultAppearance, mode: 'light', accent: 'teal' })); window.dispatchEvent(new StorageEvent('storage', { key: 'harbor.appearance.other-tab' })); });
 await act(async () => resolve({ appearance: defaultAppearance }));
 expect(document.documentElement.dataset).toMatchObject({ theme: 'light', accent: 'teal' });
});
