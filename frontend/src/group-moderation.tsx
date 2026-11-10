import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, json } from './api';
import { useApp } from './state';
import { getLanguage, useTranslation, type TranslationKey } from './i18n';
import { Dialog } from './ui';
import type { Conversation } from './types';
interface Announcement { id: string; title: string; content: string; pinned: boolean; version: number; createdAt: string; author: { displayName: string }; unread: boolean }
interface Mute { userId: string; reason: string; until: string | null; permanent: boolean; active: boolean }
export function GroupModerationPanel({ conversation }: { conversation: Conversation }) {
 const { user, socket } = useApp(), t = useTranslation(), [rows, setRows] = useState<Announcement[]>([]), [mutes, setMutes] = useState<Mute[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<TranslationKey | ''>(''), [editing, setEditing] = useState<Announcement | null>(null), [deleting, setDeleting] = useState<Announcement | null>(null), [, tick] = useState(0);
 const role = conversation.members.find(m => m.userId === user?.id)?.role, manager = role === 'OWNER' || role === 'ADMIN';
 const load = useCallback(async () => {
  try { const [a, m] = await Promise.all([api<Announcement[]>(`/conversations/${conversation.id}/announcements`), api<Mute[]>(`/conversations/${conversation.id}/mutes`)]); setRows(a); setMutes(m); setError(''); }
  catch (e) { setError(e instanceof ApiError && e.status === 403 ? 'noAccess' : 'groupActionFailed'); }
  finally { setLoading(false); }
 }, [conversation.id]);
 useEffect(() => { void load(); const update = (v: { id: string }) => { if (v.id === conversation.id) void load(); }; socket?.on('conversation:updated', update); const timer = setInterval(() => tick(n => n + 1), 30000); return () => { socket?.off('conversation:updated', update); clearInterval(timer); }; }, [load, socket]);
 async function mutate(path: string, method: string, body?: unknown) {
  if (busy) return false; setBusy(true); setError('');
  try { await api(path, json(method, body)); await load(); return true; }
  catch (e) { setError(e instanceof ApiError && e.status === 403 ? 'noAccess' : 'groupActionFailed'); return false; }
  finally { setBusy(false); }
 }
 const active = (m: Mute) => m.permanent || !!m.until && new Date(m.until).getTime() > Date.now();
 return <section className="settings-section" id="announcements"><h2>{t('announcements')}</h2>{loading && <p role="status">{t('loading')}</p>}{error && <p role="alert">{t(error)}<button type="button" onClick={() => void load()}>{t('retry')}</button></p>}
 {!loading && !error && !rows.length && <p>{t('announcementsEmpty')}</p>}
 {rows.map(row => <article key={row.id} className="search-result"><h3>{row.pinned && <span>{t('pinned')} · </span>}{row.title} {row.unread && <span>{t('unread')}</span>}</h3><small>{row.author.displayName} · {new Date(row.createdAt).toLocaleString(getLanguage())}</small><p className="announcement-content">{row.content}</p><div className="sound-actions">{row.unread && <button disabled={busy} onClick={() => void mutate(`/conversations/${conversation.id}/announcements/${row.id}/read`, 'POST')}>{t('markRead')}</button>}{manager && <><button disabled={busy} onClick={() => setEditing(row)}>{t('editAnnouncement')}</button><button disabled={busy} onClick={() => setDeleting(row)}>{t('deleteAnnouncement')}</button></>}</div></article>)}
 {manager && <form key={editing?.id || 'new'} className="form-stack" onSubmit={async e => {
  e.preventDefault(); const form = e.currentTarget, values = new FormData(form);
  const ok = await mutate(`/conversations/${conversation.id}/announcements${editing ? `/${editing.id}` : ''}`, editing ? 'PATCH' : 'POST', { title: values.get('title'), content: values.get('content'), pinned: values.get('pinned') === 'on', ...(editing ? { version: editing.version } : {}) });
  if (ok) { setEditing(null); form.reset(); }
 }}><h3>{t(editing ? 'editAnnouncement' : 'publishAnnouncement')}</h3><label>{t('announcementTitle')}<input name="title" required maxLength={120} defaultValue={editing?.title || ''} disabled={busy} /></label><label>{t('announcementContent')}<textarea name="content" required maxLength={10000} defaultValue={editing?.content || ''} disabled={busy} /></label><label><input name="pinned" type="checkbox" defaultChecked={editing?.pinned || false} disabled={busy} />{t('pinned')}</label><button className="btn btn-primary" disabled={busy}>{t(busy ? 'loading' : 'saveAnnouncement')}</button>{editing && <button type="button" disabled={busy} onClick={() => setEditing(null)}>{t('cancel')}</button>}</form>}
 <h2>{t('groupMutes')}</h2>{!loading && !error && !mutes.some(active) && <p>{t('noMutedMembers')}</p>}{mutes.filter(active).map(m => <p key={m.userId}>{conversation.members.find(member => member.userId === m.userId)?.user.displayName} · {m.permanent ? t('forever') : t('muteRemaining', { minutes: Math.max(0, Math.ceil((new Date(m.until!).getTime() - Date.now()) / 60000)) })} · {m.reason}</p>)}
 {manager && <form className="form-stack" onSubmit={async e => { e.preventDefault(); const values = new FormData(e.currentTarget); await mutate(`/conversations/${conversation.id}/mutes/${values.get('userId')}`, 'PUT', { duration: values.get('duration'), reason: values.get('reason') }); }}><label>{t('muteMember')}<select name="userId" required disabled={busy}>{conversation.members.filter(m => m.userId !== user?.id && m.role !== 'OWNER' && (role === 'OWNER' || m.role === 'MEMBER')).map(m => <option key={m.userId} value={m.userId}>{m.user.displayName}</option>)}</select></label><label>{t('muteDuration')}<select name="duration" disabled={busy}><option value="10m">{t('tenMinutes')}</option><option value="1h">{t('oneHour')}</option><option value="1d">{t('oneDay')}</option><option value="forever">{t('forever')}</option><option value="off">{t('unmute')}</option></select></label><label>{t('reason')}<input name="reason" required minLength={3} maxLength={500} disabled={busy} /></label><button className="btn btn-secondary" disabled={busy}>{t('applyMute')}</button></form>}
 {deleting && <Dialog title={t('deleteAnnouncement')} onClose={() => { if (!busy) setDeleting(null); }}><p>{deleting.title}</p><button disabled={busy} className="btn btn-danger" onClick={async () => { if (await mutate(`/conversations/${conversation.id}/announcements/${deleting.id}`, 'DELETE')) setDeleting(null); }}>{t('confirmDelete')}</button></Dialog>}
 </section>;
}
