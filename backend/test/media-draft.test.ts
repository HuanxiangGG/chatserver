import { describe, it, expect, vi } from 'vitest';
import { MediaDraft, clipboardImages } from '../../frontend/src/media-draft';
const image = (name = 'capture.png') => new File(['image'], name, { type: 'image/png' });
function draft() {
  const urls = { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() };
  return { queue: new MediaDraft(urls as unknown as typeof URL), urls };
}
describe('per-conversation media drafts', () => {
  it('does not intercept plain text or read unrelated clipboard items', () => {
    const unrelated = vi.fn();
    expect(clipboardImages([{kind:'string',type:'text/plain',getAsFile:unrelated}])).toEqual([]);
    expect(unrelated).not.toHaveBeenCalled();
  });
  it('reads only pasted images and ignores unavailable clipboard files', () => {
    const f = image();
    expect(clipboardImages([{kind:'file',type:'image/png',getAsFile:()=>f},{kind:'file',type:'image/png',getAsFile:()=>null}])).toEqual([f]);
  });
  it('stages locally without sending and revokes previews on remove', () => {
    const {queue, urls} = draft(); queue.stage([image()]);
    expect(queue.items[0].attachment).toBeUndefined();
    expect(queue.items[0].preview).toBe('blob:preview');
    queue.remove(queue.items[0].id); expect(queue.items).toEqual([]);
    expect(urls.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it('rejects an invalid batch atomically, including oversize, unsupported and empty files', () => {
    const {queue,urls}=draft();
    for (const invalid of [new File(['x'],'bad.svg',{type:'image/svg+xml'}),new File([],'empty.png',{type:'image/png'}),new File([new Uint8Array(10*1024*1024+1)],'large.png',{type:'image/png'})]) {
      expect(()=>queue.stage([image(),invalid])).toThrow(); expect(queue.items).toHaveLength(0);
    }
    expect(urls.createObjectURL).not.toHaveBeenCalled();
    expect(()=>queue.stage(Array.from({length:6},()=>image()))).toThrow();
  });
  it('preserves failed files, reuses successful uploads and keeps deduplication ID', async () => {
    const {queue}=draft(); queue.text='caption'; queue.stage([image('a.png'), image('b.png')]);
    const id=queue.clientId;
    const upload=vi.fn().mockResolvedValueOnce({id:'a'}).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({id:'b'});
    await expect(queue.upload(upload)).rejects.toThrow('offline');
    expect(queue.items).toHaveLength(2); expect(queue.text).toBe('caption');
    expect(await queue.upload(upload)).toEqual(['a','b']); expect(upload).toHaveBeenCalledTimes(3); expect(queue.clientId).toBe(id);
    const envelope=queue.prepare('caption',['a','b']);
    expect(queue.prepare('changed',[])).toEqual(envelope);
    expect(()=>queue.remove(queue.items[0].id)).toThrow();
    queue.rejected(); expect(queue.delivery).toBeNull();
    queue.stage([]);
    queue.clear(); expect(queue.clientId).not.toBe(id); expect(queue.delivery).toBeNull();
  });
  it('finishes an explicitly sent upload batch when previews are disposed on navigation', async () => {
    const {queue}=draft(); queue.stage([image()]);
    let finish!: (value: any) => void;
    const pending=queue.upload(()=>new Promise(resolve=>{finish=resolve;}));
    queue.clear(); finish({id:'persisted'});
    expect(await pending).toEqual(['persisted']);
  });
  it('isolates conversation drafts and releases all previews on cleanup', () => {
    const a=draft(),b=draft(); a.queue.stage([image()]); b.queue.stage([image()]);
    a.queue.text='A'; b.queue.text='B'; a.queue.clear();
    expect(b.queue.text).toBe('B'); expect(b.queue.items).toHaveLength(1); expect(a.urls.revokeObjectURL).toHaveBeenCalledOnce();
  });
});
