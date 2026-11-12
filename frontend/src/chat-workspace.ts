import { MediaDraft } from './media-draft';
import type { Message } from './types';

export type ReadingPosition = { anchorId?: string; offset: number; atBottom: boolean };
export type PendingDelivery = { conversationId: string; pending: MediaDraft; reply: Message | null; key: string; createdAt: string; error: string | null };
function createWorkspace(userId: string | null) {
  const listeners = new Set<(message?: Message) => void>();
  return {
    userId, active: userId !== null, drafts: new Map<string, MediaDraft>(), reading: new Map<string, ReadingPosition>(),
    outbox: { current: [] as PendingDelivery[] }, sendLock: { current: false },
    acceptedIds: { current: new Set<string>() }, restoredDraft: { current: new Map<string, { key: string; text: string }>() },
    upload: { active: false, name: '', progress: 0 }, listeners,
    publish(message?: Message) { listeners.forEach(listener => listener(message)); },
  };
}
let workspace = createWorkspace(null);

// Browser-memory edits and immutable deliveries survive routes, never account changes.
// Reading positions contain IDs only; reopening always checks access with the server.
export function chatWorkspaceFor(userId: string | null) {
  if (workspace.userId !== userId) { clearChatWorkspace(); workspace = createWorkspace(userId); }
  return workspace;
}
export function clearChatWorkspace() {
  workspace.active = false;
  workspace.listeners.clear();
  workspace.drafts.forEach(draft => draft.clear());
  workspace.outbox.current.forEach(item => item.pending.clear());
  workspace.outbox.current = [];
  workspace = createWorkspace(null);
}
