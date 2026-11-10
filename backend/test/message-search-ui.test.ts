// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MessageSearch } from '../../frontend/src/message-search';
const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../frontend/src/api', () => ({ api: mock.api, ApiError: class extends Error { constructor(public status: number) { super('failed'); } } }));
vi.mock('../../frontend/src/ui', () => ({ Dialog: ({ children }: any) => React.createElement('div', { role: 'dialog' }, children) }));
vi.mock('../../frontend/src/state', () => ({ useApp: () => ({ user: null }) }));
let host: HTMLDivElement, root: Root;
const locate = vi.fn(async (_id: string) => {});
const conversation: any = { id: 'room', members: [{ userId: 'alice', user: { displayName: 'Alice' } }] };
beforeEach(async () => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mock.api.mockReset(); locate.mockClear();
 host = document.createElement('div'); document.body.append(host); root = createRoot(host);
 await act(async () => root.render(React.createElement(MessageSearch, { conversation, locate })));
 await act(async () => host.querySelector('button')!.click());
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function submit() { await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
it('sends filters, displays an empty result, and catches request failure', async () => {
 const input = host.querySelector('[name=q]') as HTMLInputElement; input.value = '  hello  ';
 mock.api.mockResolvedValueOnce({ messages: [], cursor: null }); await submit();
 expect(mock.api.mock.calls[0][0]).toContain('q=hello'); expect(host.textContent).toContain('没有找到符合条件的消息');
 mock.api.mockRejectedValueOnce(new Error('offline')); await submit(); expect(host.querySelector('[role=alert]')).not.toBeNull();
});
it('appends paged results once and locates the original message', async () => {
 const message = (id: string) => ({ id, sender: { displayName: 'Alice' }, content: id, createdAt: '2026-01-01T00:00:00Z', attachments: [] });
 mock.api.mockResolvedValueOnce({ messages: [message('one')], cursor: 'one' }); await submit();
 mock.api.mockResolvedValueOnce({ messages: [message('one'), message('two')], cursor: null });
 const next = [...host.querySelectorAll('button')].find(b => b.textContent === '下一页')!; await act(async () => next.click());
 expect(mock.api.mock.calls[1][0]).toContain('cursor=one'); expect(host.querySelectorAll('.search-result')).toHaveLength(2);
 await act(async () => (host.querySelector('.search-result') as HTMLButtonElement).click()); expect(locate).toHaveBeenCalledWith('one');
});
