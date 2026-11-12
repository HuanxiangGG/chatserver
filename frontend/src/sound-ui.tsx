import { useFormChanges } from './settings-workspace';
import { isConversationMuted } from './conversation-preferences';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, json } from './api';
import { useApp } from './state';
import type { Message, Conversation } from './types';
import { SoundPlayer, soundSessionTimes, defaultSound, normalizeSound, type SoundSettings } from './sound';
import { getLanguage, setLanguage, useTranslation, type TranslationKey } from './i18n';
type Key = TranslationKey;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); return true; } catch { return false; } };
export const soundLocale = getLanguage;
let settings = (() => { try { return normalizeSound(JSON.parse(read('harbor.sound.guest') || '{}')); } catch { return { ...defaultSound }; } })();
export const useSoundText = useTranslation;
let player: SoundPlayer | null = null;
let blocked = false;
let syncing = false;
let syncFailed = false;
export function SoundRuntime() {
 const { user, socket, conversations } = useApp(), location = useLocation(), context = useRef({ user, conversations, path: location.pathname });
 context.current = { user, conversations, path: location.pathname };
 useEffect(() => {
  const instance = new SoundPlayer(undefined, () => { blocked = true; notify(); }); player = instance;
  try { instance.preload(); } catch { blocked = true; notify(); }
  return () => { instance.dispose(); if (player === instance) player = null; };
 }, []);
 useEffect(() => {
  let live = true; const id = user?.id;
  syncFailed = false;
  if (!id) { try { settings = normalizeSound(JSON.parse(read('harbor.sound.guest') || '{}')); } catch { settings = { ...defaultSound }; } syncing = false; notify(); return; }
  syncing = true; notify();
  void api<{ sound: unknown }>('/users/me/sound').then(async result => {
   if (!live) return;
   // Import guest preferences once only when the account has no saved preferences.
   if (result.sound) settings = normalizeSound(result.sound);
   else { settings = normalizeSound(JSON.parse(read('harbor.sound.guest') || '{}')); await api('/users/me/sound', json('PUT', settings)); }
   if (live) { write(`harbor.sound.${id}`, JSON.stringify(settings)); notify(); }
  }).catch(() => { if (live) syncFailed = true; notify(); }).finally(() => { if (live) syncing = false; notify(); });
  return () => { live = false; };
 }, [user?.id]);
 useEffect(() => {
  if (!socket) return;
  const connected = () => player?.connected(soundSessionTimes.get(socket) ?? Infinity);
  const ready = (data: { serverTime: number }) => { if (Number.isFinite(data.serverTime)) player?.connected(data.serverTime); };
  socket.on('session:ready', ready);
  if (socket.connected) connected(); socket.on('connect', connected);
  const receive = async (m: Message) => {
   const c = context.current, current = c.user; if (!current || !player || syncing || syncFailed || isConversationMuted(current.id, m.conversationId)) return;
   let conversation = c.conversations.find((v: Conversation) => v.id === m.conversationId);
   if (!conversation) { try { conversation = await api<Conversation>(`/conversations/${m.conversationId}`); } catch { return; } }
   if (context.current.user?.id !== current.id) return;
   // Resolve only current-user accessible conversations; never infer type from untrusted text.
   if (!conversation) return;
   const active = document.visibilityState === 'visible' && document.hasFocus() && context.current.path.endsWith(`/${m.conversationId}`);
   void player.receive(m, settings, { userId: current.id, username: current.username, type: conversation.type, active }).catch(() => { blocked = true; notify(); });
  };
  socket.on('message:new', receive);
  return () => { socket.off('connect', connected); socket.off('session:ready', ready); socket.off('message:new', receive); };
 }, [socket]);
 return null;
}
export function SoundSettingsPanel() {
 const changes = useFormChanges();
 const { user } = useApp(), t = useSoundText(), [, refresh] = useState(0), [status, setStatus] = useState<Key | null>(null), [busy, setBusy] = useState(false), [draft,setDraft] = useState<SoundSettings>(() => ({...settings}));
 const owner = useRef(user?.id); owner.current = user?.id;
 useEffect(() => {
  const fn = () => { refresh(v => v + 1); if(!changes.dirty) setDraft({...settings}); }; listeners.add(fn); fn(); return () => { listeners.delete(fn); };
 }, [changes.dirty]);
 const change = (patch: Partial<SoundSettings>) => { changes.changed(); setDraft(current => normalizeSound({...current,...patch})); setStatus(null); };
 async function enable() { const ok = await player?.unlock(); blocked = !ok; notify(); if (ok) change({ enabled: true }); }
 return <section className="settings-section sound-settings"><h2>{t('title')}</h2><label>{t('language')}<select value={getLanguage()} onChange={e => setLanguage(e.target.value === 'en' ? 'en' : 'zh-CN')}><option value="zh-CN">{t("chinese")}</option><option value="en">{t("english")}</option></select></label>
 {!player?.ready && <button type="button" className="btn btn-secondary sound-enable" disabled={syncing} onClick={() => void enable()}>{t('enable')}</button>}
 {syncFailed && <p role="status">{t('failed')}</p>}
 {blocked && <p role="status">{t('blocked')}</p>}
 {(['enabled','direct','group','mention','dnd','scheduled'] as const).map(key => <label className="setting-row" key={key}><span>{t(key === 'scheduled' ? 'schedule' : key)}</span><span>{t(draft[key] ? 'on' : 'off')} <input type="checkbox" checked={draft[key]} disabled={busy || syncing} onChange={e => change({ [key]: e.target.checked })} /></span></label>)}
 <label>{t('volume', { volume: Math.round(draft.volume * 100) })}<input type="range" min="0" max="100" value={Math.round(draft.volume * 100)} disabled={busy || syncing} onChange={e => change({ volume: Number(e.target.value) / 100 })} /></label>
 <label>{t('tone')}<select value={draft.tone} disabled={busy || syncing} onChange={e => change({ tone: e.target.value === 'bell' ? 'bell' : 'soft' })}><option value="soft">{t('soft')}</option><option value="bell">{t('bell')}</option></select></label>
 <div className="sound-times">{(['start','end'] as const).map(key => <label key={key}>{t(key)}<input type="time" value={draft[key]} disabled={busy || syncing} onChange={e => change({ [key]: e.target.value })} /></label>)}</div><p>{t('hint')}</p>
 <div className="sound-actions"><button type="button" className="btn btn-secondary" disabled={busy || syncing} onClick={async () => { const ok = await player?.test(draft); setStatus(ok ? 'played' : 'blocked'); notify(); }}>{t('test')}</button><button type="button" className="btn btn-primary" disabled={busy || syncing} onClick={async () => { const id = user?.id; setBusy(true); try { if (id) await api('/users/me/sound', json('PUT', draft)); if (owner.current === id) { settings = normalizeSound(draft); if (!write(id ? `harbor.sound.${id}` : 'harbor.sound.guest', JSON.stringify(settings))) throw new Error('Local preference storage unavailable'); setStatus(null); changes.saved(); notify(); } } catch { if (owner.current === id) setStatus('failed'); } finally { setBusy(false); } }}>{t('save')}</button></div>
 {changes.notice}<p aria-live="polite">{busy || syncing ? t('loading') : status ? t(status) : ''}</p>{changes.dialog}</section>;
}
export function SoundEntry() {
 const { user } = useApp(), t = useSoundText(), [, render] = useState(0), [busy,setBusy] = useState(false);
 useEffect(() => { const change = () => render(v => v + 1); listeners.add(change); return () => { listeners.delete(change); }; }, []);
 if (!user || player?.ready || !settings.enabled) return null;
 return <section className="sound-entry-inline" aria-live="polite"><button type="button" disabled={busy || syncing} className="btn btn-secondary" onClick={async () => { setBusy(true); try { const ok = await player?.unlock(); blocked = !ok; notify(); } finally { setBusy(false); } }}>{t(busy ? 'loading' : 'enable')}</button>{blocked && <span>{t('blocked')}</span>}</section>;
}
