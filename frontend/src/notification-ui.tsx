import { isConversationMuted } from './conversation-preferences';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from './api';
import { useApp } from './state';
import { useTranslation } from './i18n';
import { soundSessionTimes } from './sound';
import { notificationDefaults, normalizeNotifications, NotificationDispatcher, type NotificationPreferences } from './browser-notifications';
import type { Conversation, Message } from './types';
const memory = new Map<string, NotificationPreferences>();
const storageKey = (id?: string) => `harbor.notifications.${id || 'guest'}`;
function preferences(id?: string) {
 const key = storageKey(id); if (memory.has(key)) return memory.get(key)!; try { const raw = localStorage.getItem(key); return raw ? normalizeNotifications(JSON.parse(raw)) : memory.get(key) || { ...notificationDefaults }; }
 catch { return memory.get(key) || { ...notificationDefaults }; }
}
export function NotificationSettings() {
 const { user } = useApp(), t = useTranslation(), [value, setValue] = useState(() => preferences(user?.id)), [status, setStatus] = useState<'notificationDenied' | 'notificationError' | 'notificationSaved' | null>(null), [busy, setBusy] = useState(false);
 const labels = { enabled: 'notificationTitle', direct: 'notificationDirect', group: 'notificationGroup', mention: 'notificationMention', dnd: 'dnd', scheduled: 'schedule' } as const;
 const supported = typeof Notification !== 'undefined', owner = useRef(user?.id); owner.current = user?.id;
 const attempt = useRef(0);
 useEffect(() => () => { attempt.current++; }, []);
 useEffect(() => { setValue(preferences(user?.id)); setStatus(null); }, [user?.id]);
 function save(patch: Partial<NotificationPreferences>) {
  const next = normalizeNotifications({ ...value, ...patch }); setValue(next);
  try { localStorage.setItem(storageKey(user?.id), JSON.stringify(next)); memory.delete(storageKey(user?.id)); setStatus('notificationSaved'); }
  catch { memory.set(storageKey(user?.id), next); setStatus('notificationError'); }
 }
 async function enable() {
  if (!supported || busy) return; const id = user?.id, generation = ++attempt.current; setBusy(true); let timer: ReturnType<typeof setTimeout> | undefined;
  try { const permission = await Promise.race([Notification.requestPermission(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Notification permission timed out')), 15000); })]); if (owner.current !== id || generation !== attempt.current) return; if (permission === 'granted') save({ enabled: true }); else { save({ enabled: false }); setStatus('notificationDenied'); } }
  catch { if (owner.current === id && generation === attempt.current) setStatus('notificationError'); } finally { if (timer) clearTimeout(timer); if (generation === attempt.current) setBusy(false); }
 }
 return <section className="settings-section sound-settings"><h2>{t('notificationTitle')}</h2><p>{t('notificationHint')}</p>
 {!supported ? <p role="status">{t('notificationUnsupported')}</p> : <><button className="btn btn-primary" type="button" disabled={busy} onClick={() => void enable()}>{t(busy ? 'loading' : 'notificationEnable')}</button>
 {(['enabled', 'direct', 'group', 'mention', 'dnd', 'scheduled'] as const).map(key => <label className="setting-row" key={key}><span>{t(labels[key])}</span><span>{t(value[key] ? 'on' : 'off')} <input type="checkbox" checked={value[key]} disabled={busy} onChange={e => { if (key === 'enabled' && e.target.checked && Notification.permission !== 'granted') void enable(); else save({ [key]: e.target.checked }); }} /></span></label>)}
 <div className="sound-times">{(['start','end'] as const).map(key => <label key={key}>{t(key)}<input type="time" value={value[key]} onChange={e => save({ [key]: e.target.value })} /></label>)}</div></>}
 <p aria-live="polite">{status ? t(status) : ''}</p></section>;
}
export function NotificationRuntime() {
 const { user, socket, conversations, toast } = useApp(), location = useLocation(), navigate = useNavigate(), t = useTranslation();
 const current = useRef({ user, conversations, path: location.pathname, navigate, toast, t }); current.current = { user, conversations, path: location.pathname, navigate, toast, t };
 useEffect(() => {
  if (!user || !socket || typeof Notification === 'undefined') return;
  let live = true;
  const dispatcher = new NotificationDispatcher((title, options) => new Notification(title, options), () => current.current.toast(current.current.t('notificationError'), true));
  const handle = async (message: Message) => {
   const state = current.current; if (!state.user || state.user.id !== user.id || isConversationMuted(user.id, message.conversationId)) return;
   let conversation = state.conversations.find(c => c.id === message.conversationId);
   if (!conversation) { try { conversation = await api<Conversation>(`/conversations/${message.conversationId}`); } catch { return; } }
   if (!live || current.current.user?.id !== user.id) return;
   dispatcher.receive(message, conversation, preferences(user.id), { userId: user.id, username: user.username, active: document.visibilityState === 'visible' && document.hasFocus() && current.current.path.endsWith(`/${conversation.id}`), permission: Notification.permission, serverBoundary: soundSessionTimes.get(socket) ?? Infinity, now: Date.now(), fileLabel: current.current.t('fileType'), imageLabel: current.current.t('imageType'), open: path => { current.current.navigate(path); window.focus(); } });
  };
  const receive = (message: Message) => { void handle(message).catch(() => { if (live) current.current.toast(current.current.t('notificationError'), true); }); };
  socket.on('message:new', receive);
  return () => { live = false; socket.off('message:new', receive); dispatcher.dispose(); };
 }, [user?.id, socket]);
 return null;
}
