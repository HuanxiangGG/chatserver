// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AdminPage } from '../../frontend/src/admin';
import { setLanguage, translate } from '../../frontend/src/i18n';
const mock = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn(), role: 'ADMIN' }));
vi.mock('../../frontend/src/api', () => ({ api: mock.api, json: (method: string, body: unknown) => ({ method, body }) }));
vi.mock('../../frontend/src/state', () => ({ useApp: () => ({ user: { id: 'admin', role: mock.role, displayName: 'Admin' }, toast: mock.toast }) }));
let root: Root, host: HTMLDivElement;
const deleted = () => mock.api.mock.calls.filter(call => call[1]?.method === 'DELETE');
const button = (label: string, scope: ParentNode = host) => [...scope.querySelectorAll('button')].find(item => item.textContent === label)!;
async function fill() {
 await act(async () => button(translate('screen275')).click());
 for (const [selector, value, prototype] of [['input[name=messageId]', 'message-123', HTMLInputElement.prototype], ['textarea[name=reason]', 'Safety review reason', HTMLTextAreaElement.prototype]] as const) await act(async () => {
  const input = host.querySelector(selector)!; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true }));
 });
 await act(async () => host.querySelector('.moderation-section form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}
beforeEach(async () => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; setLanguage('en'); mock.api.mockReset(); mock.toast.mockReset(); mock.role = 'ADMIN';
 mock.api.mockImplementation((url: string) => Promise.resolve(url === '/admin/stats' ? { users: 0, conversations: 0, messages: 0, activeSessions: 0, bannedUsers: 0 } : []));
 vi.spyOn(window, 'confirm').mockImplementation(() => { throw Error('Native confirmations must not be used'); });
 host = document.createElement('div'); document.body.append(host); root = createRoot(host);
 await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(AdminPage))));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setLanguage('zh-CN'); vi.restoreAllMocks(); });
it('requires an in-page confirmation and keeps the entered reason after cancellation', async () => {
 await fill(); expect(deleted()).toHaveLength(0); const dialog = host.querySelector('[role=dialog]')!;
 expect(dialog.textContent).toContain('message-123'); expect(dialog.textContent).toContain('Safety review reason');
 await act(async () => button(translate('cancel'), dialog).click());
 expect(host.querySelector('[role=dialog]')).toBeNull(); expect((host.querySelector('input[name=messageId]') as HTMLInputElement).value).toBe('message-123');
 expect((host.querySelector('textarea[name=reason]') as HTMLTextAreaElement).value).toBe('Safety review reason'); expect(window.confirm).not.toHaveBeenCalled();
});
it('preserves the pending snapshot after failure and retries the same real deletion', async () => {
 await fill(); mock.api.mockRejectedValueOnce(new Error('Permission revoked'));
 await act(async () => button(translate('confirmDelete'), host.querySelector('[role=dialog]')!).click());
 expect(host.querySelector('[role=alert]')?.textContent).toContain('Permission revoked');
 expect((host.querySelector('textarea[name=reason]') as HTMLTextAreaElement).value).toBe('Safety review reason');
 await act(async () => button(translate('confirmDelete'), host.querySelector('[role=dialog]')!).click());
 expect(deleted()).toHaveLength(2); expect(deleted()[0]).toEqual(deleted()[1]); expect(deleted()[0]).toEqual(['/admin/messages/message-123', { method: 'DELETE', body: { reason: 'Safety review reason' } }]);
 expect(host.querySelector('[role=dialog]')).toBeNull(); expect((host.querySelector('input[name=messageId]') as HTMLInputElement).value).toBe(''); expect(mock.toast).toHaveBeenCalledWith(translate('screen295'));
});
it('locks duplicate confirmation and closing while a destructive request is pending', async () => {
 await fill(); let resolve!: (value: unknown) => void; mock.api.mockReturnValueOnce(new Promise(value => { resolve = value; }));
 const dialog = host.querySelector('[role=dialog]')!, confirm = button(translate('confirmDelete'), dialog);
 await act(async () => { confirm.click(); confirm.click(); });
 expect(deleted()).toHaveLength(1); expect(confirm.disabled).toBe(true);
 await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
 expect(host.querySelector('[role=dialog]')).not.toBeNull();
 await act(async () => resolve({})); expect(host.querySelector('[role=dialog]')).toBeNull();
});
