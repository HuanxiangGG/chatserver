// Typing is a short-lived state, not one notification per character. Renew it
// during continuous input and send a single stop on idle/blur/navigation/send.
export class TypingReporter {
  private active = false;
  private announcedAt = 0;
  private idle: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly emit: (typing: boolean) => void) {}
  update(hasText: boolean) {
    if (!hasText) { this.stop(); return; }
    if (!this.active || Date.now() - this.announcedAt >= 2000) {
      this.active = true;
      this.announcedAt = Date.now();
      this.emit(true);
    }
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(), 1500);
  }
  stop() {
    clearTimeout(this.idle);
    this.idle = undefined;
    if (this.active) { this.active = false; this.emit(false); }
  }
}
