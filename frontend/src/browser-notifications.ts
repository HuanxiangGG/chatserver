import type { Conversation, Message } from './types';
import { defaultSound, normalizeSound, quiet } from './sound';
export interface NotificationPreferences { enabled: boolean; direct: boolean; group: boolean; mention: boolean; dnd: boolean; scheduled: boolean; start: string; end: string }
export const notificationDefaults: NotificationPreferences = { enabled: false, direct: true, group: true, mention: true, dnd: false, scheduled: false, start: '22:00', end: '08:00' };
export function normalizeNotifications(value: unknown): NotificationPreferences {
 const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
 const normalized = normalizeSound(raw);
 const { direct, group, mention, dnd, scheduled, start, end } = normalized;
 const enabled = raw.enabled === true;
 return { enabled, direct, group, mention, dnd, scheduled, start, end };
}
export interface DesktopNotice { onclick: ((event: Event) => unknown) | null; onclose?: ((event: Event) => unknown) | null; close(): void }
export class NotificationDispatcher {
 private seen = new Set<string>();
 private notices = new Set<DesktopNotice>();
 private last = -Infinity;
 private reportedFailure = false;
 constructor(private show: (title: string, options: NotificationOptions) => DesktopNotice, private failed: () => void) {}
 receive(message: Message, conversation: Conversation, preferences: NotificationPreferences, context: { userId: string; username: string; active: boolean; permission: NotificationPermission; serverBoundary: number; now: number; fileLabel: string; imageLabel: string; open: (path: string) => void }) {
  if (this.seen.has(message.id)) return false;
  this.seen.add(message.id); if (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value!);
  const date = Date.parse(message.createdAt);
  if (!Number.isFinite(date) || date < context.serverBoundary || !preferences.enabled || context.permission !== 'granted' || message.senderId === context.userId || context.active || quiet({ ...defaultSound, ...preferences }, new Date(context.now))) return false;
  const mention = message.replyTo?.sender?.id === context.userId || message.content.split(/\s+/).some(word => word.replace(/[.,!?，。！？:：]+$/u, '').toLowerCase() === `@${context.username.toLowerCase()}`);
  if (mention ? !preferences.mention : !(conversation.type === 'DIRECT' ? preferences.direct : preferences.group)) return false;
  if (context.now - this.last < 1000) return false;
  try {
   const notice = this.show(message.sender.displayName, { body: message.content.slice(0, 160) || (message.attachments.some(a => a.mimeType.startsWith('image/')) ? context.imageLabel : context.fileLabel), tag: `harbor:${conversation.id}`, silent: true });
   this.last = context.now; this.notices.add(notice);
   notice.onclose = () => this.notices.delete(notice);
   if (this.notices.size > 100) { const oldest = this.notices.values().next().value!; oldest.close(); this.notices.delete(oldest); }
   notice.onclick = () => {
    try { context.open(conversation.ticket ? `/servers/${conversation.ticket.serverId}/tickets/${conversation.ticket.id}/chat/${conversation.id}` : conversation.channel ? `/servers/${conversation.channel.serverId}/channels/${conversation.id}` : `/chat/${conversation.id}`); }
    catch { this.reportFailure(); }
    finally { notice.close(); this.notices.delete(notice); }
   };
   return true;
  } catch { this.reportFailure(); return false; }
 }
 private reportFailure() { if (!this.reportedFailure) { this.reportedFailure = true; this.failed(); } }
 dispose() { this.notices.forEach(notice => notice.close()); this.notices.clear(); }
}
