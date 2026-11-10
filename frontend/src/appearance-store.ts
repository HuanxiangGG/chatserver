import { useEffect, useSyncExternalStore } from 'react';
import { api, json } from './api';
export interface AppearancePreferences { mode: 'dark' | 'light' | 'system'; accent: 'indigo' | 'violet' | 'teal'; density: 'comfortable' | 'compact'; fontSize: 14 | 16 | 18; animations: boolean }
export const defaultAppearance: AppearancePreferences = { mode: 'dark', accent: 'indigo', density: 'comfortable', fontSize: 16, animations: true };
export function normalizeAppearance(input: unknown): AppearancePreferences {
 const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
 return { mode: value.mode === 'light' || value.mode === 'system' ? value.mode : 'dark', accent: value.accent === 'violet' || value.accent === 'teal' ? value.accent : 'indigo', density: value.density === 'compact' ? 'compact' : 'comfortable', fontSize: value.fontSize === 14 || value.fontSize === 18 ? value.fontSize : 16, animations: typeof value.animations === 'boolean' ? value.animations : true };
}
const key = (id?: string) => `harbor.appearance.${id || 'guest'}`;
function read(id?: string) { try { const raw = localStorage.getItem(key(id)); if (raw) return normalizeAppearance(JSON.parse(raw)); const legacy = localStorage.getItem('harbor-theme'); return normalizeAppearance(legacy === 'light' || legacy === 'dark' ? { mode: legacy } : defaultAppearance); } catch { return { ...defaultAppearance }; } }
function write(value: AppearancePreferences, id?: string) { try { localStorage.setItem(key(id), JSON.stringify(value)); return true; } catch { return false; } }
let account: string | undefined;
let generation = 0, revision = 0;
let systemDark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
let snapshot: { preferences: AppearancePreferences; resolved: 'light' | 'dark'; status: 'idle' | 'loading' | 'saving' | 'saved' | 'error' } = { preferences: read(), resolved: 'dark', status: 'idle' };
let queue = Promise.resolve();
const listeners = new Set<() => void>();
function apply(preferences: AppearancePreferences, status = snapshot.status) {
 const resolved = preferences.mode === 'system' ? systemDark ? 'dark' : 'light' : preferences.mode;
 snapshot = { preferences, resolved, status };
 if (typeof document !== 'undefined') { const root = document.documentElement; root.dataset.theme = resolved; root.dataset.themeMode = preferences.mode; root.dataset.accent = preferences.accent; root.dataset.density = preferences.density; root.dataset.motion = preferences.animations ? 'full' : 'reduced'; root.style.setProperty('--message-font-size', `${preferences.fontSize}px`); root.style.colorScheme = resolved; }
 listeners.forEach(fn => fn());
}
apply(snapshot.preferences);
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const useAppearance = () => useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
export function updateAppearance(patch: Partial<AppearancePreferences>) {
 const preferences = normalizeAppearance({ ...snapshot.preferences, ...patch }); const local = write(preferences, account); const id = account, token = generation, update = ++revision;
 apply(preferences, local ? id ? 'saving' : 'saved' : 'error');
 if (id) queue = queue.then(async () => { if (token !== generation || id !== account) return; try { await api('/users/me/appearance', json('PUT', preferences)); if (token === generation && update === revision) apply(snapshot.preferences, local ? 'saved' : 'error'); } catch { if (token === generation && update === revision) apply(snapshot.preferences, 'error'); } });
}
export function useAppearanceRuntime(userId?: string) {
 useEffect(() => {
  const media = window.matchMedia?.('(prefers-color-scheme: dark)'); if (!media) return;
  const update = () => { systemDark = media.matches; apply(snapshot.preferences); }; update();
  media.addEventListener('change', update); return () => media.removeEventListener('change', update);
 }, []);
 useEffect(() => {
  const token = ++generation; account = userId; revision = 0; const local = read(userId); apply(local, userId ? 'loading' : 'idle');
  if (userId) void api<{ appearance: unknown }>('/users/me/appearance').then(async result => {
   if (token !== generation || revision !== 0) return;
   const preferences = result.appearance ? normalizeAppearance(result.appearance) : read();
   write(preferences, userId); apply(preferences, result.appearance ? 'idle' : 'saving');
   if (!result.appearance) queue = queue.then(async () => {
    if (token !== generation || revision !== 0) return;
    try { await api('/users/me/appearance', json('PUT', preferences)); if (token === generation && revision === 0) apply(snapshot.preferences, 'saved'); }
    catch { if (token === generation && revision === 0) apply(snapshot.preferences, 'error'); }
   });
  }).catch(() => { if (token === generation && revision === 0) apply(snapshot.preferences, 'error'); });
  return () => { if (token === generation) generation++; };
 }, [userId]);
 useEffect(() => {
  const changed = (event: StorageEvent) => { if (event.key === key(account) || event.key === null) { revision++; apply(read(account), 'idle'); } };
  window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
 }, []);
}
