import { useEffect, useState } from 'react';
export type SendShortcut = 'enter' | 'modifier';
const key = 'harbor.send-shortcut', changed = 'harbor:send-shortcut';
function read(): SendShortcut {
  try { return localStorage.getItem(key) === 'modifier' ? 'modifier' : 'enter'; }
  catch { return 'enter'; }
}
export function useSendShortcut(): [SendShortcut, (value: SendShortcut) => void] {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const update = () => setValue(read());
    window.addEventListener('storage', update); window.addEventListener(changed, update);
    return () => { window.removeEventListener('storage', update); window.removeEventListener(changed, update); };
  }, []);
  return [value, next => {
    setValue(next);
    try { localStorage.setItem(key, next); window.dispatchEvent(new Event(changed)); } catch { /* In-memory preference still works. */ }
  }];
}
export function shouldSend(event: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; nativeEvent: { isComposing: boolean } }, mode: SendShortcut) {
  return event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing &&
    (mode === 'enter' ? !event.ctrlKey && !event.metaKey : event.ctrlKey || event.metaKey);
}
