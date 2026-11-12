import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatWorkspaceFor, clearChatWorkspace } from '../../frontend/src/chat-workspace';
import { MediaDraft } from '../../frontend/src/media-draft';

afterEach(() => clearChatWorkspace());

describe('account-scoped chat workspace', () => {
  it('retains independent drafts and reading positions across page mounts for one account', () => {
    const workspace = chatWorkspaceFor('first-account');
    const first = new MediaDraft(), second = new MediaDraft();
    first.text = 'first conversation draft'; second.text = 'second conversation draft';
    workspace.drafts.set('first-room', first); workspace.drafts.set('second-room', second);
    workspace.reading.set('first-room', { anchorId: 'older-message', offset: -12, atBottom: false });
    const returning = chatWorkspaceFor('first-account');
    expect(returning).toBe(workspace);
    expect(returning.drafts.get('first-room')?.text).toBe('first conversation draft');
    expect(returning.drafts.get('second-room')?.text).toBe('second conversation draft');
    expect(returning.reading.get('first-room')).toEqual({ anchorId: 'older-message', offset: -12, atBottom: false });
  });

  it('erases text and attachment previews on account changes and never restores another account data', () => {
    const urls = { createObjectURL: vi.fn(() => 'blob:account-private-preview'), revokeObjectURL: vi.fn() };
    const privateDraft = new MediaDraft(urls as unknown as typeof URL);
    privateDraft.text = 'private draft';
    privateDraft.stage([new File(['image'], 'private.png', { type: 'image/png' })]);
    const first = chatWorkspaceFor('first-account');
    first.drafts.set('private-room', privateDraft);
    first.reading.set('private-room', { anchorId: 'private-message', offset: 0, atBottom: false });
    const second = chatWorkspaceFor('second-account');
    expect(second).not.toBe(first);
    expect(second.drafts.size).toBe(0); expect(second.reading.size).toBe(0);
    expect(privateDraft.text).toBe(''); expect(privateDraft.items).toEqual([]);
    expect(urls.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:account-private-preview');
    expect(chatWorkspaceFor('first-account').drafts.size).toBe(0);
    expect(chatWorkspaceFor('first-account').reading.size).toBe(0);
  });

  it('clears the workspace on logout even when the next login uses the same account', () => {
    const workspace = chatWorkspaceFor('first-account'), draft = new MediaDraft();
    draft.text = 'logged-out draft'; workspace.drafts.set('room', draft);
    workspace.reading.set('room', { anchorId: 'message', offset: 5, atBottom: false });
    clearChatWorkspace();
    expect(draft.text).toBe('');
    const returning = chatWorkspaceFor('first-account');
    expect(returning).not.toBe(workspace);
    expect(returning.drafts.size).toBe(0); expect(returning.reading.size).toBe(0);
  });

  it('invalidates a pending delivery and removes old subscribers before another account opens chat', () => {
    const first = chatWorkspaceFor('first-account'), pending = new MediaDraft(), listener = vi.fn();
    pending.text = 'private pending delivery';
    pending.prepare(pending.text, ['private-attachment']);
    first.outbox.current.push({ conversationId: 'private-room', pending, key: pending.clientId, reply: null, createdAt: new Date().toISOString(), error: 'offline' });
    first.sendLock.current = true; first.acceptedIds.current.add('old-delivery');
    first.listeners.add(listener);
    const second = chatWorkspaceFor('second-account');
    expect(first.active).toBe(false); expect(second.active).toBe(true);
    expect(first.outbox.current).toEqual([]);
    expect(pending.text).toBe(''); expect(pending.delivery).toBeNull();
    first.publish(); expect(listener).not.toHaveBeenCalled();
    expect(second.outbox.current).toEqual([]); expect(second.sendLock.current).toBe(false);
    expect(second.acceptedIds.current.size).toBe(0); expect(second.restoredDraft.current.size).toBe(0);
  });
});
