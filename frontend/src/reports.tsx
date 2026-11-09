import { useCallback, useEffect, useState } from 'react';
import { Flag } from 'lucide-react';
import { api, json } from './api';
import { Dialog } from './ui';
import { useTranslation, type TranslationKey } from './i18n';
const reasons = ['SPAM','HARASSMENT','ILLEGAL','SEXUAL','VIOLENCE','OTHER'] as const;
const statuses = ['OPEN','REVIEWING','RESOLVED','REJECTED'] as const;
type Status = typeof statuses[number];
type Report = { id: string; targetType: string; targetId: string; reason: typeof reasons[number]; details: string; status: Status; resolution: string | null; reporter: { displayName: string }; createdAt: string };
const reportKeys = { SPAM: 'reportSPAM', HARASSMENT: 'reportHARASSMENT', ILLEGAL: 'reportILLEGAL', SEXUAL: 'reportSEXUAL', VIOLENCE: 'reportVIOLENCE', OTHER: 'reportOTHER', OPEN: 'reportOPEN', REVIEWING: 'reportREVIEWING', RESOLVED: 'reportRESOLVED', REJECTED: 'reportREJECTED' } satisfies Record<string, TranslationKey>;
const key = (value: keyof typeof reportKeys) => reportKeys[value];
export function ReportButton({ targetType, targetId }: { targetType: 'USER'|'GROUP'|'MESSAGE'|'IMAGE'|'FILE'; targetId: string }) {
 const t = useTranslation(), [open,setOpen] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState(false), [sent,setSent] = useState(false);
 return <><button type="button" className="icon-btn" title={t('report')} aria-label={t('report')} onClick={() => { setOpen(true); setSent(false); setError(false); }}><Flag size={15}/></button>{open && <Dialog title={t('reportTitle')} onClose={() => { if (!busy) setOpen(false); }}>
 {sent ? <p role="status">{t('reportSuccess')}</p> : <form className="form-stack" onSubmit={async e => { e.preventDefault(); if (busy) return; const values = new FormData(e.currentTarget); setBusy(true); setError(false); try { await api('/reports',json('POST',{targetType,targetId,reason:values.get('reason'),details:values.get('details')})); setSent(true); } catch { setError(true); } finally { setBusy(false); } }}>
 <label>{t('reportReason')}<select name="reason" disabled={busy}>{reasons.map(reason => <option key={reason} value={reason}>{t(key(reason))}</option>)}</select></label>
 <label>{t('reportDetails')}<textarea name="details" required minLength={5} maxLength={2000} rows={4} readOnly={busy}/></label>
 {error && <p role="alert">{t('reportFailed')}</p>}<button className="btn btn-primary" disabled={busy}>{t(busy ? 'reportSubmitting' : 'reportSubmit')}</button></form>}</Dialog>}</>;
}
export function AdminReports() {
 const t=useTranslation(), [filter,setFilter]=useState(''), [rows,setRows]=useState<Report[]>([]), [cursor,setCursor]=useState<string|null>(null), [loading,setLoading]=useState(false), [failed,setFailed]=useState(false), [target,setTarget]=useState<Report|null>(null), [busy,setBusy]=useState(false), [saveError,setSaveError]=useState(false), [saved,setSaved]=useState(false);
 const load=useCallback(async (next?:string) => { setLoading(true); setFailed(false); try { const params=new URLSearchParams(); if(filter) params.set('status',filter); if(next) params.set('cursor',next); const data=await api<{reports:Report[];cursor:string|null}>(`/admin/reports?${params}`); setRows(old=>next?[...old,...data.reports]:data.reports); setCursor(data.cursor); } catch { setFailed(true); } finally { setLoading(false); } },[filter]);
 useEffect(()=>{ void load(); },[load]);
 return <section className="settings-section"><h2>{t('reportsTitle')}</h2><select aria-label={t('reportsTitle')} value={filter} onChange={e=>{ setRows([]); setFilter(e.target.value); }} disabled={loading}><option value="">{t('reportAll')}</option>{statuses.map(status=><option key={status} value={status}>{t(key(status))}</option>)}</select>
 {saved && <p role="status">{t('reportSaved')}</p>}{failed && <button className="btn btn-secondary" onClick={()=>void load()}>{t('reportLoadFailed')}</button>}
 {!loading&&!failed&&!rows.length&&<p>{t('reportEmpty')}</p>}
 {rows.map(row=><article className="settings-section" key={row.id}><p><strong>{row.reporter.displayName}</strong> · {t(key(row.reason))} · {t(key(row.status))}</p><code>{row.targetType} / {row.targetId}</code><p className="report-details">{row.details}</p>{row.resolution&&<blockquote>{row.resolution}</blockquote>}<button className="btn btn-secondary" onClick={()=>{setTarget(row);setSaveError(false);setSaved(false);}}>{t('reportSave')}</button></article>)}
 {loading&&<p role="status">{t('reportLoading')}</p>}{cursor&&<button className="btn btn-secondary" disabled={loading} onClick={()=>void load(cursor)}>{t('reportNext')}</button>}
 {target&&<Dialog title={t('reportSave')} onClose={()=>{if(!busy)setTarget(null);}}><form className="form-stack" onSubmit={async e=>{e.preventDefault();if(busy)return;const values=new FormData(e.currentTarget);setBusy(true);setSaveError(false);try{await api(`/admin/reports/${target.id}`,json('PATCH',{status:values.get('status'),resolution:values.get('resolution')}));setTarget(null);setSaved(true);await load();}catch{setSaveError(true);}finally{setBusy(false);}}}><select name="status" defaultValue={target.status} disabled={busy} aria-label={t('reportAll')}>{statuses.map(status=><option key={status} value={status}>{t(key(status))}</option>)}</select><label>{t('reportResolution')}<textarea name="resolution" required minLength={3} maxLength={500} defaultValue={target.resolution||''} readOnly={busy}/></label>{saveError&&<p role="alert">{t('reportSaveFailed')}</p>}<button className="btn btn-primary" disabled={busy}>{t(busy?'reportSubmitting':'reportSave')}</button></form></Dialog>}</section>;
}
