import ticketAdminMessages from './locales/ticket-admin.json';
import controlsMessages from './locales/community-controls.json';
import apiClientMessages from './locales/api-client.json';
import ticketBotMessages from './locales/ticket-bot.json';
import communityPolicyMessages from './locales/community-policy.json';
import communityMessages from './locales/community.json';
import harborAuthMessages from './locales/auth-harbor.json';
import apiErrors from './locales/api-errors.json';
import { useSyncExternalStore } from 'react';
import baseMessages from './locales/sound.json';
import appearanceMessages from './locales/appearance.json';
import navigationMessages from './locales/navigation.json';
import redesignMessages from './locales/ui-redesign.json';
const messages = { 'zh-CN': { ...ticketAdminMessages['zh-CN'], ...controlsMessages['zh-CN'], ...baseMessages['zh-CN'], ...apiClientMessages['zh-CN'], ...communityMessages['zh-CN'], ...ticketBotMessages['zh-CN'], ...communityPolicyMessages['zh-CN'], ...appearanceMessages['zh-CN'], ...navigationMessages['zh-CN'], ...redesignMessages['zh-CN'], ...harborAuthMessages['zh-CN'] }, en: { ...ticketAdminMessages.en, ...controlsMessages.en, ...baseMessages.en, ...apiClientMessages.en, ...communityMessages.en, ...ticketBotMessages.en, ...communityPolicyMessages.en, ...appearanceMessages.en, ...navigationMessages.en, ...redesignMessages.en, ...harborAuthMessages.en } };
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
function updateDocumentLanguage() {
  document.documentElement.lang = language;
  document.title = translate('uiDocumentTitle');
  let description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!description) { description = document.createElement('meta'); description.name = 'description'; document.head.append(description); }
  description.content = translate('uiDocumentDescription');
}
function onStorage(event: StorageEvent) {
  if (event.key !== storageKey && event.key !== null) return;
  language = savedLanguage(); updateDocumentLanguage(); announce();
}
function subscribe(fn: () => void) {
  updateDocumentLanguage();
  if (!subscriptions.size) window.addEventListener('storage', onStorage);
  subscriptions.add(fn);
  return () => { subscriptions.delete(fn); if (!subscriptions.size) window.removeEventListener('storage', onStorage); };
}
export const getLanguage = () => language;
export function setLanguage(next: Language) {
  language = next;
  try { localStorage.setItem(storageKey, next); } catch { /* The current page still uses the selected language. */ }
  updateDocumentLanguage();
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
