import apiErrors from './locales/api-errors.json';
import { useSyncExternalStore } from 'react';
import messages from './locales/sound.json';
export type Language = 'zh-CN' | 'en';
export type TranslationKey = keyof typeof messages.en;
const storageKey = 'harbor.language';
function savedLanguage(): Language {
  try { return localStorage.getItem(storageKey) === 'en' ? 'en' : 'zh-CN'; }
  catch { return 'zh-CN'; }
}
let language = savedLanguage();
const subscriptions = new Set<() => void>();
const announce = () => subscriptions.forEach(fn => fn());
function onStorage(event: StorageEvent) {
  if (event.key !== storageKey && event.key !== null) return;
  language = savedLanguage(); document.documentElement.lang = language; announce();
}
function subscribe(fn: () => void) {
  document.documentElement.lang = language;
  if (!subscriptions.size) window.addEventListener('storage', onStorage);
  subscriptions.add(fn);
  return () => { subscriptions.delete(fn); if (!subscriptions.size) window.removeEventListener('storage', onStorage); };
}
export const getLanguage = () => language;
export function setLanguage(next: Language) {
  language = next;
  try { localStorage.setItem(storageKey, next); } catch { /* The current page still uses the selected language. */ }
  document.documentElement.lang = next;
  announce();
}
export function useLanguage() { return useSyncExternalStore(subscribe, getLanguage, () => 'zh-CN' as const); }
export function translate(key: TranslationKey, vars: Record<string, string | number> = {}) {
 return messages[getLanguage()][key].replace(/\{(\w+)\}/g, (token, name) => vars[name] === undefined ? token : String(vars[name]));
}
export function useTranslation() {
  const current = useSyncExternalStore(subscribe, getLanguage, () => 'zh-CN' as const);
  return (key: TranslationKey, vars: Record<string, string | number> = {}) =>
    messages[current][key].replace(/\{(\w+)\}/g, (token, name) => vars[name] === undefined ? token : String(vars[name]));
}

export function localizeApiError(message: string) {
 const key = (apiErrors as Record<string, TranslationKey>)[message];
 if (key) return translate(key);
 return translate(message.startsWith(messages['zh-CN'].apiFieldError.split('\uFF0C')[0]) ? 'apiFieldError' : 'apiUnknownError');
}
