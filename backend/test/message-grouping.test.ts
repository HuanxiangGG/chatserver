import { expect, it } from 'vitest';
import { continuesMessageGroup } from '../../frontend/src/message-grouping';
import type { Message } from '../../frontend/src/types';
const message = (createdAt: string, senderId = 'a', extra: Partial<Message> = {}) => ({ createdAt, senderId, ...extra }) as Message;
it('groups the same sender within five minutes and breaks on sender, date, pause and unread boundaries', () => {
 const a = message('2026-11-10T12:00:00');
 expect(continuesMessageGroup(a, message('2026-11-10T12:00:01'))).toBe(true);
 expect(continuesMessageGroup(a, message('2026-11-10T12:04:59'))).toBe(true);
 expect(continuesMessageGroup(a, message('2026-11-10T12:05:00'))).toBe(false);
 expect(continuesMessageGroup(a, message('2026-11-10T12:00:01','b'))).toBe(false);
 expect(continuesMessageGroup(a, message('2026-11-10T12:00:01'), true)).toBe(false);
 expect(continuesMessageGroup(message('2026-11-10T23:59:59'),message('2026-11-11T00:00:01'))).toBe(false);
 expect(continuesMessageGroup(undefined,a)).toBe(false);
 expect(continuesMessageGroup(a,message('invalid'))).toBe(false);
 expect(continuesMessageGroup(message(a.createdAt,'a',{retractedAt:a.createdAt}),a)).toBe(false);
});
