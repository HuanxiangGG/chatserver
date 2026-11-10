// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NotificationSettings } from '../../frontend/src/notification-ui';
vi.mock('../../frontend/src/state', () => ({ useApp: () => ({ user: null }) }));
let root: Root, host: HTMLDivElement;
const requestPermission = vi.fn();
beforeEach(async () => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); requestPermission.mockReset(); requestPermission.mockResolvedValue('granted');
 vi.stubGlobal('Notification', class { static permission = 'default'; static requestPermission = requestPermission; });
 host = document.createElement('div'); document.body.append(host); root = createRoot(host);
 await act(async () => root.render(React.createElement(NotificationSettings)));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('requests permission only after a click and saves the notification switch separately from sounds', async () => {
 expect(requestPermission).not.toHaveBeenCalled();
 await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
 expect(requestPermission).toHaveBeenCalledOnce(); expect(JSON.parse(localStorage.getItem('harbor.notifications.guest')!).enabled).toBe(true);
 expect(localStorage.getItem('harbor.sound.guest')).toBeNull(); expect(host.querySelector('[aria-live]')?.textContent).toContain('已保存');
});
it('shows denied permission without enabling notifications or throwing', async () => {
 requestPermission.mockResolvedValue('denied'); await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
 expect(host.textContent).toContain('通知权限未获允许'); expect((host.querySelector('input') as HTMLInputElement).checked).toBe(false);
});
it('offers a readable unsupported state without an unusable permission button', async () => {
 vi.stubGlobal('Notification', undefined); await act(async () => root.render(React.createElement(NotificationSettings)));
 expect(host.textContent).toContain('当前浏览器不支持'); expect(host.querySelector('button')).toBeNull();
});
it('recovers from a browser permission prompt that never resolves', async () => {
 vi.useFakeTimers(); requestPermission.mockReturnValue(new Promise(()=>{}));
 await act(async()=>{ (host.querySelector('button') as HTMLButtonElement).click(); });
 expect((host.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
 await act(async()=>{ await vi.advanceTimersByTimeAsync(15001); });
 expect((host.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
 expect(host.textContent).toContain('通知'); vi.useRealTimers();
});
