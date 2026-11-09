import { useRef, useState } from 'react';
import { api, json, ApiError } from './api';
import { useApp } from './state';
import { useTranslation } from './i18n';
import { Dialog, conversationTitle } from './ui';
import type { Conversation, Message } from './types';
export function ForwardDialog({ messages, close, done }: { messages: Message[]; close: () => void; done: () => void }) {
 const { conversations, friends, user } = useApp(), t = useTranslation(), [target, setTarget] = useState(''), [mode, setMode] = useState<'quote'|'copy'>('quote'), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
 const clientId = useRef(crypto.randomUUID()), prepared = useRef<{ target: string; mode: 'quote'|'copy'; ids: string[] } | null>(null);
 const targets = conversations.filter(c => c.canWrite !== false && c.type !== 'CHANNEL');
 async function send() {
  if (busy || !target) return; setBusy(true); setError('');
  try {
   if (!prepared.current) {
    let id = target;
    if (target.startsWith('friend:')) { const c = await api<Conversation>('/conversations/direct', json('POST', { userId: target.slice(7) })); id = c.id; }
    prepared.current = { target: id, mode, ids: messages.map(m => m.id) };
   }
   const body = prepared.current;
   await api(`/conversations/${body.target}/forward`, json('POST', { sourceIds: body.ids, mode: body.mode, clientId: clientId.current })); done();
  } catch (e) { if (e instanceof ApiError && e.status >= 400 && e.status < 500) { prepared.current = null; clientId.current = crypto.randomUUID(); setConfirm(false); } setError(t(e instanceof ApiError && e.status === 403 ? 'noAccess' : 'forwardFailed')); }
  finally { setBusy(false); }
 }
 return <Dialog title={t('forwardTitle')} onClose={() => { if (!busy) close(); }}><div className="form-stack">
 {!targets.length && !friends.length && <p role="status">{t('forwardEmpty')}</p>}
 <label>{t('forwardTarget')}<select value={target} disabled={busy || confirm || !!prepared.current} onChange={e => setTarget(e.target.value)}><option value="">{t('forwardChoose')}</option>{targets.map(c => <option key={c.id} value={c.id}>{conversationTitle(c, user!.id)}</option>)}{friends.map(f => <option key={f.id} value={`friend:${f.id}`}>{f.displayName}</option>)}</select></label>
 <label>{t('forwardMode')}<select value={mode} disabled={busy || confirm || !!prepared.current} onChange={e => setMode(e.target.value === 'copy' ? 'copy' : 'quote')}><option value="quote">{t('forwardQuote')}</option><option value="copy">{t('forwardCopy')}</option></select></label>
 <p>{t('forwardCount', { count: messages.length })}</p><div className="search-results">{messages.map(m => <article key={m.id} className="search-result"><strong>{m.sender.displayName}</strong><span>{m.content || t(m.attachments.some(a => a.mimeType.startsWith('image/')) ? 'imageType' : 'fileType')}</span></article>)}</div>
 {error && <p role="alert">{error}</p>}
 {!confirm ? <button className="btn btn-primary" disabled={!target || !messages.length} onClick={() => setConfirm(true)}>{t('forwardReview')}</button> : <><p role="status">{t('forwardConfirmHint')}</p><button className="btn btn-primary" disabled={busy} onClick={() => void send()}>{t(busy ? 'loading' : 'forwardConfirm')}</button>{!prepared.current && <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirm(false)}>{t('forwardBack')}</button>}</>}
 </div></Dialog>;
}
