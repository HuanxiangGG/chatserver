import type { Message } from './types';
export const soundSessionTimes = new WeakMap<object, number>();
export interface SoundSettings { enabled: boolean; direct: boolean; group: boolean; mention: boolean; volume: number; tone: 'soft' | 'bell'; dnd: boolean; scheduled: boolean; start: string; end: string }
export const defaultSound: SoundSettings = { enabled: true, direct: true, group: true, mention: true, volume: .5, tone: 'soft', dnd: false, scheduled: false, start: '22:00', end: '08:00' };
export function normalizeSound(value: unknown): SoundSettings {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result = { ...defaultSound };
  for (const key of ['enabled','direct','group','mention','dnd','scheduled'] as const) if (typeof v[key] === 'boolean') result[key] = v[key];
  if (typeof v.volume === 'number' && Number.isFinite(v.volume)) result.volume = Math.max(0, Math.min(1, v.volume));
  if (v.tone === 'bell') result.tone = 'bell';
  for (const key of ['start','end'] as const) if (typeof v[key] === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v[key])) result[key] = v[key];
  return result;
}
export function quiet(s: SoundSettings, now = new Date()) {
  if (s.dnd) return true;
  if (!s.scheduled) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  const parse = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
  const start = parse(s.start), end = parse(s.end);
  return start === end || (start < end ? minute >= start && minute < end : minute >= start || minute < end);
}
export class SoundPlayer {
  ready = false;
  private players: HTMLAudioElement[] = [];
  private seen = new Set<string>();
  private last = -Infinity;
  private since = Infinity;
  constructor(private makeAudio = (src: string) => new Audio(src), private failed: () => void = () => {}) {}
  preload() {
    if (!this.players.length) this.players = ['soft','bell','mention'].map(name => { const a = this.makeAudio(`/sounds/${name}.wav`); a.preload = 'auto'; a.load(); return a; });
  }
  async unlock() {
    try {
      this.preload();
      await Promise.all(this.players.map(async a => { a.volume = 0; await a.play(); a.pause(); a.currentTime = 0; }));
      this.ready = true; return true;
    } catch { this.ready = false; this.failed(); return false; }
  }
  connected(at = Date.now()) { this.since = at; }
  private async play(index: number, volume: number) {
    try { const a = this.players[index]; if (!a) return false; a.volume = volume; a.currentTime = 0; await a.play(); return true; }
    catch { this.ready = false; this.failed(); return false; }
  }
  async test(s: SoundSettings) { if (!this.ready && !await this.unlock()) return false; return this.play(s.tone === 'soft' ? 0 : 1, s.volume); }
  async receive(m: Message, s: SoundSettings, context: { userId: string; username: string; type: 'DIRECT' | 'GROUP' | 'CHANNEL'; active: boolean }, now = Date.now()) {
    if (this.seen.has(m.id)) return false;
    this.seen.add(m.id); if (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value!);
    if (!Number.isFinite(Date.parse(m.createdAt)) || !this.ready || !s.enabled || !s.volume || quiet(s, new Date(now)) || m.senderId === context.userId || Date.parse(m.createdAt) < this.since) return false;
    const special = m.replyTo?.sender?.id === context.userId || m.content.split(/\s+/).some(word => word.replace(/[.,!?，。！？:：]+$/u, '').toLowerCase() === `@${context.username.toLowerCase()}`);
    if (special ? !s.mention : context.active || !(context.type === 'DIRECT' ? s.direct : s.group)) return false;
    if (now - this.last < 1000) return false;
    this.last = now;
    return this.play(special ? 2 : s.tone === 'soft' ? 0 : 1, s.volume);
  }
  dispose() { for (const a of this.players) { a.pause(); a.removeAttribute('src'); } this.players = []; this.ready = false; }
}
