// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ChatPage } from '../../frontend/src/chat';
import { shouldSend } from '../../frontend/src/send-preference';
const mock = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn(), refresh: vi.fn(async () => {}) }));
vi.mock('../../frontend/src/api', () => ({ api: mock.api, json: (method: string, body: unknown) => ({ method, body }), uploadFile: vi.fn(), ApiError: class extends Error {} }));
vi.mock('../../frontend/src/state', () => ({ useApp: () => ({ user: { id: 'me', displayName: 'Me' }, conversations: [], socket: null, sync: 0, refresh: mock.refresh, toast: mock.toast }) }));
vi.mock('../../frontend/src/layout', () => ({ CreateGroup: () => null }));
let root: Root, host: HTMLDivElement, textarea: HTMLTextAreaElement;
let sequence = 0;
const conversation = { id: 'room', type: 'DIRECT', members: [{ userId: 'me', user: { id: 'me', displayName: 'Me' } }, { userId: 'peer', user: { id: 'peer', displayName: 'Peer' } }] };
const message = (content: string) => ({ id: String(++sequence), conversationId: 'room', senderId: 'me', sender: { id: 'me', displayName: 'Me' }, content, createdAt: new Date().toISOString(), attachments: [], reads: [] });
async function text(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function enter(shiftKey = false) {
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true, cancelable: true })); });
}
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); mock.toast.mockClear(); mock.api.mockReset(); sequence = 0;
  mock.api.mockImplementation(async (path, options) => {
    if (options?.method === 'POST' && path.endsWith('/messages')) return message(options.body.content);
    return path.endsWith('/messages') ? { messages: [], hasMore: false } : conversation;
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(React.createElement(MemoryRouter, { initialEntries: ['/chat/room'] }, React.createElement(Routes, null, React.createElement(Route, { path: '/chat/:id', element: React.createElement(ChatPage) })))); });
  textarea = host.querySelector('textarea')!; textarea.focus();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('keeps the same enabled focused textarea through ten successful sends without duplicates', async () => {
  for (let i = 0; i < 10; i++) {
    await text(`message ${i}`); await enter();
    expect(host.querySelector('textarea')).toBe(textarea);
    expect(document.activeElement).toBe(textarea); expect(textarea.disabled).toBe(false); expect(textarea.value).toBe('');
  }
  const posts = mock.api.mock.calls.filter(([path, options]) => path.endsWith('/messages') && options?.method === 'POST');
  expect(posts).toHaveLength(10); expect(new Set(posts.map(([, o]) => o.body.clientId)).size).toBe(10);
});
it('retains focus and draft on failure and permits a successful retry', async () => {
  await text('keep this'); mock.api.mockRejectedValueOnce(new Error('offline')); await enter();
  expect(textarea.value).toBe('keep this'); expect(document.activeElement).toBe(textarea); expect(mock.toast).toHaveBeenCalled();
  await enter(); expect(textarea.value).toBe(''); expect(document.activeElement).toBe(textarea);
});
it('keeps focus while pending, prevents duplicate submits, and does not steal focus after deliberate navigation', async () => {
  await text('pending'); let resolve!: (value: unknown) => void;
  mock.api.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await enter(); expect(textarea.readOnly).toBe(false); expect(textarea.disabled).toBe(false); expect(document.activeElement).toBe(textarea);
  await enter();
  const other = document.createElement('button'); host.append(other); other.focus();
  await act(async () => resolve(message('pending')));
  expect(document.activeElement).toBe(other); expect(textarea.readOnly).toBe(false); expect(textarea.value).toBe('');
});
it('preserves history scroll position when a message finishes sending', async () => {
  const box = host.querySelector('.messages-scroll')! as HTMLElement;
  Object.defineProperties(box, { scrollHeight: { value: 2000, configurable: true }, clientHeight: { value: 400, configurable: true } });
  await act(async () => { box.scrollTop = 300; box.dispatchEvent(new Event('scroll', { bubbles: true })); });
  await text('history'); await enter(); expect(box.scrollTop).toBe(300);
});
it('does not send Shift+Enter and respects modifier and IME shortcuts', async () => {
  await text('line'); await enter(true); expect(textarea.value).toBe('line');
  const e = { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, nativeEvent: { isComposing: false } };
  expect(shouldSend(e, 'enter')).toBe(true); expect(shouldSend(e, 'modifier')).toBe(false);
  expect(shouldSend({ ...e, ctrlKey: true }, 'modifier')).toBe(true);
  expect(shouldSend({ ...e, metaKey: true }, 'modifier')).toBe(true);
  expect(shouldSend({ ...e, nativeEvent: { isComposing: true } }, 'enter')).toBe(false);
});

it('queues new typing during a slow request without losing or duplicating messages', async () => {
  let resolve!: (value: unknown) => void;
  mock.api.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await text('first slow'); await enter();
  expect(textarea.value).toBe(''); expect(textarea.readOnly).toBe(false);
  await text('second queued'); await enter();
  await text('third queued'); await enter();
  await text('still editing');
  expect(textarea.value).toBe('still editing'); expect(document.activeElement).toBe(textarea);
  await act(async () => resolve(message('first slow')));
  const posts = mock.api.mock.calls.filter(([path, options]) => path.endsWith('/messages') && options?.method === 'POST');
  expect(posts.map(([,options])=>options.body.content)).toEqual(['first slow','second queued','third queued']);
  expect(new Set(posts.map(([,options])=>options.body.clientId)).size).toBe(3);
  expect(textarea.value).toBe('still editing'); expect(document.activeElement).toBe(textarea);
});
it('keeps the failed snapshot and newer typing separately and retries in order', async () => {
  let reject!: (value: unknown) => void;
  mock.api.mockImplementationOnce(() => new Promise((_,r) => { reject = r; }));
  await text('original failed'); await enter();
  await text('next message'); await enter();
  await text('unfinished draft');
  await act(async () => reject(new Error('offline')));
  expect(textarea.value).toBe('unfinished draft');
  expect(host.querySelector('.outbox-status')?.textContent).toContain('original failed');
  const retry = host.querySelector('.outbox-status button') as HTMLButtonElement;
  await act(async () => retry.click());
  const posts = mock.api.mock.calls.filter(([path, options]) => path.endsWith('/messages') && options?.method === 'POST');
  expect(posts.map(([,options])=>options.body.content)).toEqual(['original failed','original failed','next message']);
  expect(posts[0]![1].body.clientId).toBe(posts[1]![1].body.clientId);
  expect(textarea.value).toBe('unfinished draft');
});

it('accepts forty rapid drafts beyond the former cap and keeps pending delivery unobtrusive', async () => {
  let resolve!: (value: unknown) => void;
  mock.api.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  for (let i = 0; i < 40; i++) { await text(`burst-${i}`); await enter(); }
  await text('next editable draft');
  expect(mock.toast).not.toHaveBeenCalled();
  expect(host.querySelector('.outbox-status')).toBeNull();
  expect(textarea.value).toBe('next editable draft');
  expect(document.activeElement).toBe(textarea);
  await act(async () => resolve(message('burst-0')));
  const posts = mock.api.mock.calls.filter(([path, options]) => path.endsWith('/messages') && options?.method === 'POST');
  expect(posts.map(([, options]) => options.body.content)).toEqual(Array.from({ length: 40 }, (_, i) => `burst-${i}`));
  expect(new Set(posts.map(([, options]) => options.body.clientId)).size).toBe(40);
  expect(textarea.value).toBe('next editable draft');
  expect(host.querySelector('.outbox-status')).toBeNull();
});
