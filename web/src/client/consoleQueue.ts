export const CONSOLE_QUEUE_FRAME_MS = 16;
export const CONSOLE_QUEUE_DRAIN_MS = 320;

// Preserve ordering and ANSI state while spreading a burst over a short window.
// The deadline stays fixed as output arrives, so busy servers cannot fall behind.
export class ConsoleLineQueue {
  private lines: string[] = [];
  private head = 0;
  private deadline: number | null = null;

  get size(): number { return this.lines.length - this.head; }

  enqueue(lines: readonly string[]): void {
    for (const line of lines) this.lines.push(line);
  }

  take(now: number, immediate = false): string[] {
    if (!this.size) return [];
    this.deadline ??= now + CONSOLE_QUEUE_DRAIN_MS;
    const frames = Math.max(1, Math.ceil((this.deadline - now) / CONSOLE_QUEUE_FRAME_MS));
    const count = immediate ? this.size : Math.ceil(this.size / frames);
    const batch = this.lines.slice(this.head, this.head + count);
    this.head += batch.length;
    if (!this.size) this.clear();
    else if (this.head >= 4096 && this.head * 2 >= this.lines.length) {
      this.lines = this.lines.slice(this.head);
      this.head = 0;
    }
    return batch;
  }

  clear(): void {
    this.lines = [];
    this.head = 0;
    this.deadline = null;
  }
}
