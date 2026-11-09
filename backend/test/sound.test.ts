import { expect, it, vi } from 'vitest';
import { SoundPlayer, defaultSound, normalizeSound, quiet } from '../../frontend/src/sound';
function harness() {
 const audios: any[] = [], failed = vi.fn();
 const engine = new SoundPlayer(() => { const a = { play: vi.fn(async () => {}), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(), currentTime: 0, volume: 0 }; audios.push(a); return a; }, failed);
 const context = { userId: 'me', username: 'alice', type: 'DIRECT' as 'DIRECT' | 'GROUP', active: false };
 const now = Date.now(), message = (id = 'new', patch = {}) => ({ id, senderId: 'other', conversationId: 'room', content: 'hello', createdAt: new Date(now).toISOString(), attachments: [], ...patch } as any);
 const start = async () => { await engine.unlock(); engine.connected(now - 1); audios.forEach(a => a.play.mockClear()); };
 return { engine, audios, failed, context, now, message, start };
}
it('preloads local assets and requires a user gesture before playing', async () => {
 const h = harness(); h.engine.preload(); expect(h.audios).toHaveLength(3);
 expect(await h.engine.receive(h.message(), defaultSound, h.context)).toBe(false);
 expect(h.audios.every(a => a.play.mock.calls.length === 0)).toBe(true);
});
it.each(['DIRECT','GROUP'] as const)('plays genuinely new %s socket messages including attachments', async type => {
 const h = harness(); await h.start();
 expect(await h.engine.receive(h.message('photo', { attachments: [{ mimeType: 'image/png' }] }), defaultSound, { ...h.context, type }, h.now)).toBe(true);
 expect(h.audios[0].play).toHaveBeenCalledOnce();
});
it('uses the special sound for mentions and replies even in the foreground', async () => {
 const h = harness(); await h.start();
 expect(await h.engine.receive(h.message('mention', { content: 'Hi @alice！' }), defaultSound, { ...h.context, active: true }, h.now)).toBe(true);
 expect(await h.engine.receive(h.message('reply', { replyTo: { sender: { id: 'me' } } }), defaultSound, h.context, h.now + 1100)).toBe(true);
 expect(h.audios[2].play).toHaveBeenCalledTimes(2);
});
it('never plays own messages or ordinary messages in the active conversation', async () => {
 const h = harness(); await h.start();
 expect(await h.engine.receive(h.message('self', { senderId: 'me' }), defaultSound, h.context)).toBe(false);
 expect(await h.engine.receive(h.message('active'), defaultSound, { ...h.context, active: true })).toBe(false);
});
it.each([{ enabled: false }, { direct: false }, { volume: 0 }, { dnd: true }])('honors settings %j', async patch => {
 const h = harness(); await h.start(); expect(await h.engine.receive(h.message(), { ...defaultSound, ...patch }, h.context)).toBe(false);
});
it('honors group and mention category switches independently', async () => {
 const h = harness(); await h.start();
 expect(await h.engine.receive(h.message('group'), { ...defaultSound, group: false }, { ...h.context, type: 'GROUP' })).toBe(false);
 expect(await h.engine.receive(h.message('mention', { content: '@alice' }), { ...defaultSound, mention: false }, h.context)).toBe(false);
});
it('honors overnight quiet hours and boundary times in device local time', () => {
 const settings = { ...defaultSound, scheduled: true };
 const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m);
 expect(quiet(settings, at(22))).toBe(true); expect(quiet(settings, at(7, 59))).toBe(true);
 expect(quiet(settings, at(8))).toBe(false); expect(quiet(settings, at(21, 59))).toBe(false);
 expect(quiet({ ...settings, start: '12:00', end: '12:00' }, at(10))).toBe(true);
});
it('deduplicates events and merges bursts to at most one sound per second', async () => {
 const h = harness(); await h.start();
 expect(await h.engine.receive(h.message(), defaultSound, h.context, h.now)).toBe(true);
 expect(await h.engine.receive(h.message(), defaultSound, h.context, h.now + 1200)).toBe(false);
 expect(await h.engine.receive(h.message('burst'), defaultSound, h.context, h.now + 50)).toBe(false);
 expect(await h.engine.receive(h.message('later'), defaultSound, h.context, h.now + 1200)).toBe(true);
});
it('rejects pre-connect and reconnect history and does not replay suppressed messages', async () => {
 const h = harness(); await h.start(); h.engine.connected(h.now + 10000);
 expect(await h.engine.receive(h.message('history'), defaultSound, h.context, h.now + 10000)).toBe(false);
 expect(h.audios.every(a => a.play.mock.calls.length === 0)).toBe(true);
});
it('catches autoplay rejection during unlock and later playback without breaking callers', async () => {
 const h = harness(); h.engine.preload(); h.audios[0].play.mockRejectedValueOnce(new Error('blocked'));
 expect(await h.engine.unlock()).toBe(false); expect(h.failed).toHaveBeenCalledOnce();
 await h.start(); h.audios[0].play.mockRejectedValueOnce(new Error('blocked'));
 expect(await h.engine.receive(h.message(), defaultSound, h.context)).toBe(false); expect(h.engine.ready).toBe(false);
});
it('normalizes persisted settings without allowing invalid volume or time values', () => {
 expect(normalizeSound({ volume: 10, start: '99:00', enabled: 'no' })).toEqual({ ...defaultSound, volume: 1 });
});
