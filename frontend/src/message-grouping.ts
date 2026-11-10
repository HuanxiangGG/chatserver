import type { Message } from './types';
// A change of sender, day, unread boundary, or a five-minute pause starts a group.
export function continuesMessageGroup(previous: Message | undefined, message: Message, unread = false) {
  if (!previous || unread || previous.senderId !== message.senderId || previous.retractedAt || previous.deletedAt || message.retractedAt || message.deletedAt) return false;
  const gap = Date.parse(message.createdAt) - Date.parse(previous.createdAt);
  return gap >= 0 && gap < 5 * 60_000 && new Date(previous.createdAt).toDateString() === new Date(message.createdAt).toDateString();
}
