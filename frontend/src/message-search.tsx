import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { Dialog } from './ui';
import type { Conversation, Message } from './types';
import { soundLocale, useSoundText } from './sound-ui';
export function MessageSearch({ conversation, locate }: { conversation: Conversation; locate: (id: string) => Promise<void> }) {
 const t = useSoundText(), [open, setOpen] = useState(false), [rows, setRows] = useState<Message[]>([]), [busy, setBusy] = useState(false), [searched, setSearched] = useState(false), [error, setError] = useState(''), [cursor, setCursor] = useState<string | null>(null);
 const parameters = useRef(new URLSearchParams()), request = useRef<AbortController | null>(null);
 useEffect(() => {
  request.current?.abort(); setBusy(false); setOpen(false); setRows([]); setBusy(false); setSearched(false); setError(''); setCursor(null); parameters.current = new URLSearchParams();
  return () => request.current?.abort();
 }, [conversation.id]);
 async function run(query: URLSearchParams, append = false) {
  request.current?.abort(); const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
  try {
   const result = await api<{ messages: Message[]; cursor: string | null }>(`/conversations/${conversation.id}/search?${query}`, { signal: controller.signal });
   if (controller.signal.aborted) return;
   setRows(old => append ? [...old, ...result.messages.filter(m => !old.some(v => v.id === m.id))] : result.messages); setCursor(result.cursor); setSearched(true);
  } catch (e) { if (!controller.signal.aborted) setError(t(e instanceof ApiError && e.status === 403 ? 'noAccess' : 'searchError')); }
  finally { if (!controller.signal.aborted) setBusy(false); }
 }
 return <><button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>{t('searchTitle')}</button>{open && <Dialog title={t('searchTitle')} onClose={() => { request.current?.abort(); setBusy(false); setOpen(false); }}><form className="form-stack" onSubmit={e => {
  e.preventDefault(); if (busy) return; const f = new FormData(e.currentTarget), query = new URLSearchParams();
  for (const k of ['q','sender','type']) { const v = String(f.get(k) || '').trim(); if (v) query.set(k, v); }
  if (f.get('from')) query.set('from', `${f.get('from')}T00:00:00.000Z`);
  if (f.get('to')) query.set('to', `${f.get('to')}T23:59:59.999Z`);
  parameters.current = query; void run(query);
 }}><label>{t('keyword')}<input name="q" maxLength={100} /></label><label>{t('sender')}<select name="sender"><option value="">{t('all')}</option>{conversation.members.map(m => <option key={m.userId} value={m.userId}>{m.user.displayName}</option>)}</select></label><div className="sound-times"><label>{t('dateFrom')}<input name="from" type="date" /></label><label>{t('dateTo')}<input name="to" type="date" /></label></div><label>{t('messageType')}<select name="type"><option value="">{t('all')}</option><option value="text">{t('textType')}</option><option value="image">{t('imageType')}</option><option value="file">{t('fileType')}</option></select></label><button className="btn btn-primary" disabled={busy}>{busy ? t('loading') : t('searchButton')}</button></form>
 {error && <p role="alert">{error}</p>}{searched && !rows.length && !busy && <p role="status">{t('noResults')}</p>}
 <div className="search-results">{rows.map(m => <button key={m.id} type="button" className="search-result" disabled={busy} aria-label={t('locate')} onClick={async () => { setBusy(true); try { await locate(m.id); setOpen(false); } catch (e) { setError(t(e instanceof ApiError && e.status === 403 ? 'noAccess' : 'searchError')); } finally { setBusy(false); } }}><strong>{m.sender.displayName}</strong><time>{new Date(m.createdAt).toLocaleString(soundLocale())}</time><span>{m.content || t(m.attachments.some(a => a.mimeType.startsWith('image/')) ? 'imageType' : 'fileType')}</span></button>)}</div>
 {cursor && <button className="btn btn-secondary" disabled={busy} onClick={() => { const q = new URLSearchParams(parameters.current); q.set('cursor', cursor); void run(q, true); }}>{t('nextPage')}</button>}</Dialog>}</>;
}
