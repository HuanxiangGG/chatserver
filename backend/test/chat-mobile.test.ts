// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { ChatPage } from '../../frontend/src/chat';
import { installVisualViewport } from '../../frontend/src/viewport';
import { translate } from '../../frontend/src/i18n';
const mock = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn(), refresh: vi.fn(async () => {}), uploadFile: vi.fn() }));
vi.mock('../../frontend/src/api', () => ({ api: mock.api, uploadFile: mock.uploadFile, json: (method: string, body: unknown) => ({ method, body }), ApiError: class extends Error {} }));
const listeners = new Map<string, Set<(data: any) => void>>();
const socket = { connected: true, emit: vi.fn(), on: (event: string, fn: (data: any) => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(fn); }, off: (event: string, fn: (data: any) => void) => listeners.get(event)?.delete(fn) };
vi.mock('../../frontend/src/state', () => ({ useApp: () => ({ user: { id: 'me', username: 'me', displayName: 'Me' }, conversations: [], socket, sync: 0, refresh: mock.refresh, toast: mock.toast }) }));
vi.mock('../../frontend/src/layout', () => ({ CreateGroup: () => null }));
let root: Root, host: HTMLDivElement, input: HTMLTextAreaElement, cleanupViewport: () => void;
let visibleHeight = 844, sequence = 0;
const viewportEvents = new EventTarget();
const resizeObservers: { callback: ResizeObserverCallback; target?: Element; disconnected: boolean }[] = [];
const me = { id: 'me', displayName: 'Me', username: 'me' }, peer = { id: 'peer', displayName: 'Peer', username: 'peer' };
function conversation(id = 'room') { return { id, type: 'DIRECT', canWrite: true, members: [{ userId: me.id, user: me }, { userId: peer.id, user: peer }] }; }
function message(content: string, id = String(++sequence), room = 'room') { return { id, content, conversationId: room, senderId: peer.id, sender: peer, createdAt: new Date().toISOString(), attachments: [], reads: [] }; }
function Harness() {
 const navigate = useNavigate();
 return React.createElement(React.Fragment, null, React.createElement('button', { 'data-route': 'next', onClick: () => navigate('/chat/second') }, 'next'), React.createElement('button', { 'data-route': 'first', onClick: () => navigate('/chat/room') }, 'first'), React.createElement(ChatPage));
}
async function text(value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function key(options: KeyboardEventInit = {}) { await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options })); }); }
function posts() { return mock.api.mock.calls.filter(([path, options]) => path.endsWith('/messages') && options?.method === 'POST'); }
beforeEach(async () => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
 localStorage.clear(); listeners.clear(); sequence = 0; visibleHeight = 844; resizeObservers.length = 0;
 vi.stubGlobal('ResizeObserver', class {
  record: typeof resizeObservers[number];
  constructor(callback: ResizeObserverCallback) { this.record = { callback, disconnected: false }; resizeObservers.push(this.record); }
  observe(target: Element) { this.record.target = target; }
  disconnect() { this.record.disconnected = true; }
 });
 Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
 Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
 Object.defineProperty(window, 'visualViewport', { configurable: true, value: { get height() { return visibleHeight; }, offsetTop: 0, scale: 1, addEventListener: viewportEvents.addEventListener.bind(viewportEvents), removeEventListener: viewportEvents.removeEventListener.bind(viewportEvents) } });
 vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => window.setTimeout(() => fn(0), 0));
 vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
 vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
 vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function(this: HTMLTextAreaElement) { return Math.max(24, this.value.split('\n').length * 24); });
 mock.api.mockReset(); mock.toast.mockClear(); mock.uploadFile.mockReset();
 mock.api.mockImplementation(async (path: string, options: any) => {
  if (options?.method === 'POST' && path.endsWith('/messages')) return { ...message(options.body.content, undefined, path.split('/')[2]), sender: me, senderId: me.id };
  if (options?.method) return {};
  if (path.endsWith('/messages')) return { messages: [], hasMore: false };
  return conversation(path.split('/')[2]);
 });
 host = document.createElement('div'); document.body.append(host); root = createRoot(host); cleanupViewport = installVisualViewport();
 await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/chat/room'] }, React.createElement(Routes, null, React.createElement(Route, { path: '/chat/:id', element: React.createElement(Harness) })))));
 input = host.querySelector('textarea')!; input.focus();
});
afterEach(async () => { await act(async () => root.unmount()); cleanupViewport(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('keeps the focused composer instance and draft as the mobile visible frame shrinks and restores', async () => {
 await text('draft above the keyboard');
 await act(async () => { visibleHeight = 480; viewportEvents.dispatchEvent(new Event('resize')); await new Promise(resolve => setTimeout(resolve, 5)); });
 expect(document.documentElement.dataset.keyboard).toBe('open'); expect(host.querySelector('textarea')).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('draft above the keyboard');
 await key(); expect(document.activeElement).toBe(input); expect(input.value).toBe('');
 await act(async () => { visibleHeight = 844; viewportEvents.dispatchEvent(new Event('resize')); await new Promise(resolve => setTimeout(resolve, 5)); });
 expect(document.documentElement.dataset.keyboard).toBe('closed'); expect(host.querySelector('textarea')).toBe(input); expect(posts()).toHaveLength(1);
});
it('retains Chinese composition until committed Enter and preserves Shift+Enter multiline drafts', async () => {
 await text('中文输入'); await key({ isComposing: true }); expect(posts()).toHaveLength(0); expect(input.value).toBe('中文输入');
 await key({ keyCode: 229, isComposing: false }); expect(posts()).toHaveLength(0); expect(input.value).toBe('中文输入');
 await key({ shiftKey: true }); expect(posts()).toHaveLength(0);
 await text('中文输入\nsecond line'); expect(input.style.height).toBe('48px');
 await key(); expect(posts()[0]![1].body.content).toBe('中文输入\nsecond line'); expect(input.value).toBe(''); expect(document.activeElement).toBe(input);
});
it('caps multiline height and restores each conversation draft and size after navigation', async () => {
 const firstDraft = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
 await text(firstDraft); expect(input.style.height).toBe('140px');
 await act(async () => (host.querySelector('[data-route=next]') as HTMLButtonElement).click());
 input = host.querySelector('textarea')!; expect(input.value).toBe(''); expect(input.style.height).toBe('24px');
 await text('second room draft');
 await act(async () => (host.querySelector('[data-route=first]') as HTMLButtonElement).click());
 input = host.querySelector('textarea')!; expect(input.value).toBe(firstDraft); expect(input.style.height).toBe('140px');
});
it('opens details as a keyboard accessible mobile dialog and closes without replacing the composer', async () => {
 const details = host.querySelector(`button[aria-label="${translate('screen445')}"]`) as HTMLButtonElement;
 details.focus(); await act(async () => details.click());
 const dialog = host.querySelector('[role=dialog]')!;
 expect(dialog.getAttribute('aria-modal')).toBe('true'); expect(dialog.contains(document.activeElement)).toBe(true); expect(host.querySelector('textarea')).toBe(input);
 await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
 expect(host.querySelector('[role=dialog]')).toBeNull(); expect(document.activeElement).toBe(details); expect(host.querySelector('textarea')).toBe(input);
});
it('renders long incoming content as text and deduplicates repeated Socket deliveries', async () => {
 const content = '<img src=x onerror=alert(1)>' + 'longword'.repeat(300), incoming = message(content, 'same-id');
 await act(async () => { for (const callback of listeners.get('message:new') || []) { callback(incoming); callback(incoming); } });
 expect(host.querySelectorAll('#message-same-id')).toHaveLength(1); expect(host.querySelector('#message-same-id .message-content')?.textContent).toBe(content);
 expect(host.querySelector('#message-same-id .message-content img')).toBeNull(); expect(host.querySelector('textarea')).toBe(input);
});
it('leaves typing usable during a staged file upload and sends the queued attachment once', async () => {
 let resolve!: (value: any) => void;
 mock.uploadFile.mockImplementationOnce((_file, progress) => { progress(43); return new Promise(done => { resolve = done; }); });
 const fileInput = host.querySelector('input[type=file]') as HTMLInputElement;
 Object.defineProperty(fileInput, 'files', { configurable: true, value: [new File(['%PDF test'], 'document.pdf', { type: 'application/pdf' })] });
 await act(async () => fileInput.dispatchEvent(new Event('change', { bubbles: true })));
 await text('file caption'); await key();
 expect(host.querySelector('.upload-progress')).not.toBeNull(); expect(input.readOnly).toBe(false); expect(input.disabled).toBe(false);
 await text('next draft while uploading');
 await act(async () => resolve({ id: 'attachment', filename: 'document.pdf', mimeType: 'application/pdf', size: 9 }));
 expect(posts()).toHaveLength(1); expect(posts()[0]![1].body.attachmentIds).toEqual(['attachment']); expect(input.value).toBe('next draft while uploading');
});
it('closes only the topmost preview on Escape even when touch focus remains outside both mobile dialogs', async () => {
 const incoming = { ...message('image caption', 'preview-message'), attachments: [{ id: 'preview-attachment', filename: 'image.png', mimeType: 'image/png', size: 128 }] };
 await act(async () => { for (const callback of listeners.get('message:new') || []) callback(incoming); });
 const details = host.querySelector(`button[aria-label="${translate('screen445')}"]`) as HTMLButtonElement;
 details.focus(); await act(async () => details.click());
 expect(host.querySelectorAll('[role=dialog]')).toHaveLength(1);
 const thumbnail = host.querySelector('.conversation-info .attachment-thumbnail') as HTMLButtonElement;
 await act(async () => thumbnail.click());
 expect(host.querySelectorAll('[role=dialog]')).toHaveLength(2);
 expect(host.querySelector('.attachment-lightbox')).not.toBeNull();
 // Some mobile browsers retain focus on an underlying composer after a touch
 // interaction. Escape is handled at document level rather than relying on a
 // key event bubbling from inside the preview.
 input.focus(); expect(host.querySelector('[role=dialog]')!.contains(document.activeElement)).toBe(false);
 const firstEscape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
 await act(async () => input.dispatchEvent(firstEscape));
 expect(firstEscape.defaultPrevented).toBe(true);
 expect(host.querySelectorAll('[role=dialog]')).toHaveLength(1);
 expect(host.querySelector('.attachment-lightbox')).toBeNull(); expect(host.querySelector('.info-dialog')).not.toBeNull();
 expect(host.querySelector('textarea')).toBe(input);
 input.focus(); await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
 expect(host.querySelector('[role=dialog]')).toBeNull(); expect(document.activeElement).toBe(details);
});

it('keeps the latest visible during keyboard and multiline resize, but preserves history reading', async () => {
 const scroller = host.querySelector('.messages-scroll') as HTMLDivElement;
 let clientHeight = 546;
 Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => clientHeight });
 Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2000 });
 scroller.scrollTop = 1454;
 const observer = resizeObservers.find(item => item.target === scroller && !item.disconnected)!;
 expect(observer).toBeDefined();
 async function resized(height: number) {
  clientHeight = height;
  await act(async () => { observer.callback([], {} as ResizeObserver); await new Promise(resolve => setTimeout(resolve, 5)); });
 }
 // Browser scrollTop is clamped by its real layout; jsdom records the assigned
 // target, which must be the complete scroll height for bottom anchoring.
 await resized(247); expect(scroller.scrollTop).toBe(2000);
 await text(Array.from({ length: 8 }, (_, i) => `line ${i}`).join('\n'));
 await resized(179); expect(scroller.scrollTop).toBe(2000); expect(document.activeElement).toBe(input);
 scroller.scrollTop = 120;
 await act(async () => scroller.dispatchEvent(new Event('scroll', { bubbles: true })));
 await resized(100); expect(scroller.scrollTop).toBe(120);
 await act(async () => scroller.dispatchEvent(new Event('load', { bubbles: false })));
 await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
 expect(scroller.scrollTop).toBe(120);
 await act(async () => (host.querySelector('[data-route=next]') as HTMLButtonElement).click());
 expect(observer.disconnected).toBe(true);
});

it('keeps the editable draft when Socket delivery precedes delayed HTTP acknowledgements', async () => {
 const requests: { content: string; resolve: (value: unknown) => void }[] = [];
 const previousApi = mock.api.getMockImplementation()!;
 mock.api.mockImplementation((path: string, options: any) => {
  if (options?.method === 'POST' && path.endsWith('/messages')) return new Promise(resolve => requests.push({ content: options.body.content, resolve }));
  return previousApi(path, options);
 });
 for (const content of ['queued first', 'queued second', 'queued third']) { await text(content); await key(); }
 await text('new draft before acknowledgements');
 for (let index = 0; index < 3; index++) {
  expect(requests).toHaveLength(index + 1);
  const request = requests[index]!, delivered = { ...message(request.content, `delayed-${index}`), sender: me, senderId: me.id };
  await act(async () => { for (const callback of listeners.get('message:new') || []) callback(delivered); });
  await text(`new draft while acknowledgement ${index} waits`);
  await act(async () => {
   request.resolve(delivered);
   // Let the network continuation queue updates before another input event.
   await Promise.resolve();
   Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, `latest editing ${index}`);
   input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(input.value).toBe(`latest editing ${index}`);
  expect(document.activeElement).toBe(input); expect(host.querySelector('textarea')).toBe(input);
  expect(host.querySelectorAll(`#message-delayed-${index}`)).toHaveLength(1);
 }
 expect(requests.map(request => request.content)).toEqual(['queued first', 'queued second', 'queued third']);
 expect(host.querySelector('.outbox-status')).toBeNull();
});

it('uses one sender header and one receipt for consecutive messages and exposes exact timestamps', async () => {
 const first = message('short one', 'group-one'), second = message('short two', 'group-two');
 await act(async () => { for (const callback of listeners.get('message:new') || []) { callback(first); callback(second); } });
 expect(host.querySelector('#message-group-one .message-meta')).not.toBeNull();
 expect(host.querySelector('#message-group-two .message-meta')).toBeNull();
 expect(host.querySelector('#message-group-two .message-avatar')).toBeNull();
 const actions = host.querySelector('#message-group-two .message-more') as HTMLButtonElement;
 await act(async () => actions.click());
 expect(host.querySelector('#message-group-two .message-menu time')?.getAttribute('datetime')).toBe(second.createdAt);
});

it('continues queued delivery when Socket confirms a message whose HTTP acknowledgement fails', async () => {
 let reject!: (error: Error) => void;
 mock.api.mockImplementationOnce(() => new Promise((_,fail) => { reject = fail; }));
 await text('socket confirmed'); await key(); await text('following draft'); await key();
 const sent = posts()[0]![1].body;
 await act(async () => { for (const callback of listeners.get('message:new') || []) callback({...message('socket confirmed','socket-confirmed'),sender:me,senderId:me.id,clientId:sent.clientId}); });
 await act(async () => reject(new Error('acknowledgement lost')));
 expect(posts()).toHaveLength(2); expect(host.querySelector('.outbox-status')).toBeNull();
 expect(host.querySelectorAll('#message-socket-confirmed')).toHaveLength(1);
 expect(posts()[1]![1].body.content).toBe('following draft');
 expect(document.activeElement).toBe(input);
});

it('does not confuse keyboard resize scroll events with a request to read older messages', async () => {
 const box = host.querySelector('.messages-scroll') as HTMLDivElement;
 let height = 546; Object.defineProperty(box,'clientHeight',{configurable:true,get:()=>height});
 Object.defineProperty(box,'scrollHeight',{configurable:true,value:2000}); box.scrollTop=1454;
 await act(async () => box.dispatchEvent(new Event('scroll',{bubbles:true})));
 await act(async () => { visibleHeight=430; height=240; viewportEvents.dispatchEvent(new Event('resize')); box.dispatchEvent(new Event('scroll',{bubbles:true})); await new Promise(resolve=>setTimeout(resolve,10)); });
 expect(box.scrollTop).toBe(2000);
 box.scrollTop=120; await act(async () => box.dispatchEvent(new Event('scroll',{bubbles:true})));
 await act(async () => { visibleHeight=844; height=546; viewportEvents.dispatchEvent(new Event('resize')); await new Promise(resolve=>setTimeout(resolve,10)); });
 expect(box.scrollTop).toBe(120);
});
