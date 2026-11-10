import { useEffect, useState } from 'react';
import type { Conversation } from './types';
export interface ConversationPreference { pinned?: boolean; muted?: boolean; archivedAt?: string }
type Preferences = Record<string, ConversationPreference>;
const changeEvent = 'harbor:conversation-preferences';
const key = (userId: string) => `harbor.conversations.${userId}`;
export function readConversationPreferences(userId: string): Preferences {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key(userId)) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([id]) => id.length < 150).map(([id, value]) => {
      const v = value && typeof value === 'object' ? value as ConversationPreference : {};
      return [id, { pinned: v.pinned === true, muted: v.muted === true, ...(typeof v.archivedAt === 'string' ? { archivedAt: v.archivedAt } : {}) }];
    }));
  } catch { return {}; }
}
export function updateConversationPreference(userId: string, conversationId: string, patch: ConversationPreference) {
  const current = readConversationPreferences(userId);
  localStorage.setItem(key(userId), JSON.stringify({ ...current, [conversationId]: { ...current[conversationId], ...patch } }));
  window.dispatchEvent(new Event(changeEvent));
}
export function isConversationMuted(userId: string, conversationId: string) { return readConversationPreferences(userId)[conversationId]?.muted === true; }
export function restoreConversation(userId: string, conversationId: string) {
  if (readConversationPreferences(userId)[conversationId]?.archivedAt !== undefined) updateConversationPreference(userId, conversationId, { archivedAt: undefined });
}
export function useConversationPreferences(userId: string) {
  const [value, setValue] = useState(() => readConversationPreferences(userId));
  useEffect(() => {
    const update = () => setValue(readConversationPreferences(userId));
    update(); window.addEventListener(changeEvent, update); window.addEventListener('storage', update);
    return () => { window.removeEventListener(changeEvent, update); window.removeEventListener('storage', update); };
  }, [userId]);
  return value;
}
export function orderConversations(conversations: Conversation[], preferences: Preferences, showArchived = false) {
  return conversations.filter(c => c.type !== 'CHANNEL' && (!!preferences[c.id]?.archivedAt === showArchived)).sort((a, b) => Number(!!preferences[b.id]?.pinned) - Number(!!preferences[a.id]?.pinned) || Date.parse(b.lastMessage?.createdAt || b.updatedAt || '') - Date.parse(a.lastMessage?.createdAt || a.updatedAt || '') || a.id.localeCompare(b.id));
}
