import { expect, it, vi } from 'vitest';
import { NotificationDispatcher, notificationDefaults, normalizeNotifications } from '../../frontend/src/browser-notifications';
function fixture() {
 const notices: any[] = [], failed = vi.fn(), open = vi.fn();
 const show = vi.fn(() => { const n = { onclick: null, close: vi.fn() }; notices.push(n); return n; });
 const dispatcher = new NotificationDispatcher(show, failed), now = Date.now();
 const message = (id = 'message', values = {}) => ({ id, content: 'hello', senderId: 'other', sender: { displayName: 'Other' }, createdAt: new Date(now).toISOString(), conversationId: 'room', attachments: [], ...values } as any);
 const conversation: any = { id: 'room', type: 'DIRECT' };
 const settings = { ...notificationDefaults, enabled: true };
 const context = { userId: 'me', username: 'alice', active: false, permission: 'granted' as const, serverBoundary: now - 1, now, fileLabel: 'File', imageLabel: 'Image', open };
 return { dispatcher, notices, failed, show, message, conversation, settings, context, open };
}
it.each(['DIRECT', 'GROUP'])('shows new %s messages silently and navigates on click', type => {
 const f = fixture(); f.conversation.type = type;
 expect(f.dispatcher.receive(f.message(), f.conversation, f.settings, f.context)).toBe(true);
 expect(f.show.mock.calls[0][1]).toMatchObject({ silent: true, body: 'hello' });
 f.notices[0].onclick(); expect(f.open).toHaveBeenCalledWith('/chat/room'); expect(f.notices[0].close).toHaveBeenCalledOnce();
});
it('filters own, active, disabled, denied and quiet notifications', () => {
 const f = fixture();
 expect(f.dispatcher.receive(f.message('own', { senderId: 'me' }), f.conversation, f.settings, f.context)).toBe(false);
 expect(f.dispatcher.receive(f.message('active'), f.conversation, f.settings, { ...f.context, active: true })).toBe(false);
 expect(f.dispatcher.receive(f.message('disabled'), f.conversation, notificationDefaults, f.context)).toBe(false);
 expect(f.dispatcher.receive(f.message('denied'), f.conversation, f.settings, { ...f.context, permission: 'denied' })).toBe(false);
 expect(f.dispatcher.receive(f.message('quiet'), f.conversation, { ...f.settings, dnd: true }, f.context)).toBe(false);
 expect(f.show).not.toHaveBeenCalled();
});
it('uses mentions independently of ordinary group notifications', () => {
 const f = fixture(); f.conversation.type = 'GROUP'; f.settings.group = false;
 expect(f.dispatcher.receive(f.message('ordinary'), f.conversation, f.settings, f.context)).toBe(false);
 expect(f.dispatcher.receive(f.message('mention', { content: '@alice hi' }), f.conversation, f.settings, f.context)).toBe(true);
});
it('deduplicates messages, throttles bursts and excludes pre-connect history', () => {
 const f = fixture();
 expect(f.dispatcher.receive(f.message(), f.conversation, f.settings, f.context)).toBe(true);
 expect(f.dispatcher.receive(f.message(), f.conversation, f.settings, { ...f.context, now: f.context.now + 2000 })).toBe(false);
 expect(f.dispatcher.receive(f.message('burst'), f.conversation, f.settings, f.context)).toBe(false);
 expect(f.dispatcher.receive(f.message('old', { createdAt: new Date(f.context.now - 10000).toISOString() }), f.conversation, f.settings, f.context)).toBe(false);
});
it('catches platform failures and reports once without breaking message handlers', () => {
 const f = fixture(); f.show.mockImplementation(() => { throw Error('unsupported'); });
 expect(f.dispatcher.receive(f.message(), f.conversation, f.settings, f.context)).toBe(false);
 expect(f.dispatcher.receive(f.message('second'), f.conversation, f.settings, f.context)).toBe(false); expect(f.failed).toHaveBeenCalledOnce();
});
it('routes channel notifications correctly and closes notices on logout', () => {
 const f = fixture(); f.conversation.channel = { serverId: 'server' };
 f.dispatcher.receive(f.message(), f.conversation, f.settings, f.context); f.notices[0].onclick();
 expect(f.open).toHaveBeenCalledWith('/servers/server/channels/room');
 f.dispatcher.receive(f.message('next'), f.conversation, f.settings, { ...f.context, now: f.context.now + 2000 });
 f.dispatcher.dispose(); expect(f.notices[1].close).toHaveBeenCalledOnce();
});
it('normalizes persisted settings and supports overnight quiet hours', () => {
 expect(normalizeNotifications({ enabled: 'yes', start: '99:00' })).toEqual(notificationDefaults);
 const f = fixture(), now = new Date(2026, 0, 1, 23).getTime();
 expect(f.dispatcher.receive(f.message('quiet', { createdAt: new Date(now).toISOString() }), f.conversation, { ...f.settings, scheduled: true }, { ...f.context, now, serverBoundary: now - 1 })).toBe(false);
});
