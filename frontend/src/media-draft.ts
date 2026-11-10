import { translate as tr } from './i18n';
import type { Attachment } from './types';
const allowed = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);
export function clipboardImages(items: ArrayLike<Pick<DataTransferItem, 'kind' | 'type' | 'getAsFile'>>): File[] {
  return Array.from(items).filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter((f): f is File => !!f);
}
export class MediaDraft {
  text = '';
  clientId = crypto.randomUUID();
  delivery: { content: string; attachmentIds: string[]; replyToId?: string; clientId: string } | null = null;
  items: { id: string; file: File; preview?: string; attachment?: Attachment }[] = [];
  constructor(private urls = URL) {}
  stage(files: File[]) {
    if (this.delivery) throw Error(tr('screen415'));
    if (this.items.length + files.length > 5) throw Error(tr('screen416'));
    for (const file of files) {
      if (!allowed.has(file.type)) throw Error(tr('screen417'));
      if (file.size > 10 * 1024 * 1024) throw Error(tr('screen418'));
      if (!file.size) throw Error(tr('screen419'));
    }
    this.items.push(...files.map(file => ({ id: crypto.randomUUID(), file, preview: file.type.startsWith('image/') ? this.urls.createObjectURL(file) : undefined })));
  }
  remove(id: string) {
    if (this.delivery) throw Error(tr('screen415'));
    const item = this.items.find(i => i.id === id);
    if (item?.preview) this.urls.revokeObjectURL(item.preview);
    this.items = this.items.filter(i => i.id !== id);
  }
  async upload(send: (file: File) => Promise<Attachment>) {
    // Cache each confirmed attachment so a failed upload or message POST can retry safely.
    const batch = [...this.items];
    for (const item of batch) if (!item.attachment) item.attachment = await send(item.file);
    return batch.map(i => i.attachment!.id);
  }
  prepare(content: string, attachmentIds: string[], replyToId?: string) {
    this.delivery ??= { content, attachmentIds: [...attachmentIds], replyToId, clientId: this.clientId };
    return this.delivery;
  }
  rejected() { this.delivery = null; this.clientId = crypto.randomUUID(); }
  clear() {
    this.delivery = null;
    this.items.forEach(i => { if (i.preview) this.urls.revokeObjectURL(i.preview); });
    this.items = []; this.text = ''; this.clientId = crypto.randomUUID();
  }
}
