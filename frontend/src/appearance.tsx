import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from './i18n';
import { updateAppearance, useAppearance, type AppearancePreferences } from './appearance-store';
export function AppearanceSettings() {
 const t = useTranslation(), { preferences: value, status } = useAppearance();
 const busy = status === 'loading';
 const modes = [{ value: 'dark', label: 'appearanceDark', icon: Moon }, { value: 'light', label: 'appearanceLight', icon: Sun }, { value: 'system', label: 'appearanceSystem', icon: Monitor }] as const;
 return <section className="settings-section appearance-settings" id="appearance"><h2>{t('appearanceTitle')}</h2><p>{t('appearanceDescription')}</p>
 <div className="theme-options" role="group" aria-label={t('appearanceTheme')}>
 {modes.map(mode => <button type="button" disabled={busy} aria-pressed={value.mode === mode.value} className={`theme-choice ${value.mode === mode.value ? 'selected' : ''}`} key={mode.value} onClick={() => updateAppearance({ mode: mode.value })}><span className={`theme-preview preview-${mode.value}`}><i/><div><i/><i/><i/></div></span><span><mode.icon size={16}/>{t(mode.label)}{value.mode === mode.value && <Check size={16}/>}</span></button>)}
 </div>
 <label className="appearance-field"><span>{t('appearanceAccent')}</span><select disabled={busy} value={value.accent} onChange={e => updateAppearance({ accent: e.target.value as AppearancePreferences['accent'] })}><option value="indigo">{t('appearanceIndigo')}</option><option value="violet">{t('appearanceViolet')}</option><option value="teal">{t('appearanceTeal')}</option></select></label>
 <label className="appearance-field"><span>{t('appearanceDensity')}</span><select disabled={busy} value={value.density} onChange={e => updateAppearance({ density: e.target.value as AppearancePreferences['density'] })}><option value="comfortable">{t('appearanceComfortable')}</option><option value="compact">{t('appearanceCompact')}</option></select></label>
 <label className="appearance-field"><span>{t('appearanceFont')}</span><select disabled={busy} value={value.fontSize} onChange={e => updateAppearance({ fontSize: Number(e.target.value) as AppearancePreferences['fontSize'] })}>{([14,16,18] as const).map(size => <option value={size} key={size}>{t('appearanceFontSize', { size })}</option>)}</select></label>
 <label className="setting-row"><span>{t('appearanceAnimations')}</span><input type="checkbox" disabled={busy} checked={value.animations} onChange={e => updateAppearance({ animations: e.target.checked })}/></label>
 <p className={status === 'error' ? 'appearance-error' : 'muted'} aria-live="polite">{t(status === 'loading' ? 'appearanceLoading' : status === 'saving' ? 'appearanceSaving' : status === 'saved' ? 'appearanceSaved' : status === 'error' ? 'appearanceError' : 'appearanceLocal')}</p>
 {status === 'error' && <button type="button" className="btn btn-secondary" onClick={() => updateAppearance({})}>{t('appearanceRetry')}</button>}
 </section>;
}
