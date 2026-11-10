import { ReportButton } from './reports';
import { useState } from 'react';
import { Dialog } from './ui';
import { soundLocale, useSoundText } from './sound-ui';
import type { Attachment } from './types';
export function AttachmentPreview({ attachment: a }: { attachment: Attachment }) {
 const [open, setOpen] = useState(false), [failed, setFailed] = useState(false), t = useSoundText();
 const url = `/api/uploads/${encodeURIComponent(a.id)}`, name = a.originalName || a.filename || t('fileType');
 const image = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(a.mimeType);
 return <div className="message-attachment">
 {image ? <button type="button" className="attachment-thumbnail" onClick={() => { setFailed(false); setOpen(true); }} aria-label={t('preview')}><img src={url} alt={name} loading="lazy" /></button> : <a href={url} target="_blank" rel="noreferrer" className="file-card"><strong>{name}</strong><span>{a.mimeType} · {new Intl.NumberFormat(soundLocale(), { maximumFractionDigits: 1 }).format(a.size / 1024)} {t('kib')}</span><span>{t('download')}</span></a>}
 {!image && <ReportButton targetType="FILE" targetId={a.id} />}
 {open && <Dialog title={t('preview')} onClose={() => setOpen(false)}><div className="attachment-lightbox">{failed ? <p role="alert">{t('noAccess')}</p> : <img src={url} alt={name} onError={() => setFailed(true)} />}<p>{name}</p><ReportButton targetType="IMAGE" targetId={a.id} /><a href={url} download={name} className="btn btn-secondary">{t('download')}</a><button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>{t('close')}</button></div></Dialog>}
 </div>;
}
