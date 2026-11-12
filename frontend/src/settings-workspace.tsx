import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useBlocker } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { translate as tr, useLanguage, type TranslationKey } from './i18n';
import { Dialog } from './ui';
import './settings-workspace.css';

export interface SettingsSection { id: string; label: TranslationKey }
export function SettingsWorkspace({ sections, active, children }: { sections: SettingsSection[]; active: string; children: ReactNode }) {
  useLanguage();
  const location = useLocation();
  const links = sections.map(section => <Link key={section.id} to={`${location.pathname}${location.search}#${section.id}`} aria-current={active === section.id ? 'page' : undefined} onClick={e => e.currentTarget.closest('details')?.removeAttribute('open')}>{tr(section.label)}</Link>);
  return <div className="settings-workspace">
    <nav className="workspace-navigation" aria-label={tr('workspaceSections')}>{links}</nav>
    <details className="workspace-mobile-navigation"><summary>{tr(sections.find(section => section.id === active)!.label)}<ChevronDown size={18}/></summary><nav aria-label={tr('workspaceSections')}>{links}</nav></details>
    <div className="workspace-content" key={active}>{children}</div>
  </div>;
}

// Data-router navigation blocking covers links, section changes, Back and Forward.
// Full-page unloads retain the browser's native confirmation.
export function useFormChanges() {
  useLanguage();
  const [dirty, setDirty] = useState(false), [saved, setSaved] = useState(false), [pending, setPending] = useState(false);
  const action = useRef<(() => void) | null>(null);
  const blocker = useBlocker(({currentLocation, nextLocation}) => dirty &&
    currentLocation.pathname + currentLocation.search + currentLocation.hash !== nextLocation.pathname + nextLocation.search + nextLocation.hash);
  const request = (next: () => void) => { if (!dirty) next(); else { action.current = next; setPending(true); } };
  const cancel = () => { action.current = null; setPending(false); if(blocker.state === 'blocked') blocker.reset(); };
  const discard = () => {
    const next = action.current; action.current = null; setDirty(false); setPending(false);
    if(blocker.state === 'blocked') blocker.proceed(); else next?.();
  };
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);
  return {
    dirty, request,
    changed: () => { setDirty(true); setSaved(false); },
    saved: () => { setDirty(false); setSaved(true); },
    reset: () => { setDirty(false); setSaved(false); },
    notice: <p className="workspace-save-state" role="status">{dirty ? tr('workspaceUnsaved') : saved ? tr('workspaceSaved') : ''}</p>,
    dialog: (pending || blocker.state === 'blocked') && <Dialog title={tr('workspaceLeaveTitle')} onClose={cancel}><p>{tr('workspaceLeaveDescription')}</p><div className="dialog-actions"><button className="btn btn-primary" onClick={cancel}>{tr('workspaceKeepEditing')}</button><button className="btn btn-secondary" onClick={discard}>{tr('workspaceDiscard')}</button></div></Dialog>,
  };
}
