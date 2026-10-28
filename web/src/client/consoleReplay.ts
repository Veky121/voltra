// Wings live events have no collector IDs. Match exact event + ANSI text,
// once per displayed occurrence. This is a bounded heuristic: identical repeated
// output can be mistaken for a delayed copy; evicted matches can display twice.
// Never normalize ANSI or whitespace, or collapse repeats within either source.
export function collectorLineKey(line: string): string {
  line = line.replaceAll('\0', '\uFFFD');
  const marker = ' [line truncated by Voltra]', encoder = new TextEncoder();
  if (line.endsWith(marker) && encoder.encode(line.slice(0, -marker.length)).length <= 16384) return line;
  const bytes = encoder.encode(line);
  if (bytes.length <= 16384) return line;
  let end = 16384;
  while ((bytes[end] & 0xc0) === 0x80) end--;
  return new TextDecoder('utf-8', {ignoreBOM:true}).decode(bytes.subarray(0,end)) + marker;
}
export class ConsoleReplayOverlap {
  private byKey = new Map<string, Set<number>>();
  private pending = new Map<number, string>();
  private nextID = 0;
  private characters = 0;
  private maxLines: number;
  private maxCharacters: number;
  constructor(maxLines = 100_000, maxCharacters = 16 * 1024 * 1024) {
    this.maxLines = maxLines; this.maxCharacters = maxCharacters;
  }
  clear() {
    this.byKey.clear(); this.pending.clear(); this.characters = 0;
  }
  record(event: string, line: string) {
    const key = JSON.stringify([event, collectorLineKey(line)]), id = this.nextID++;
    const ids = this.byKey.get(key) ?? new Set<number>();
    ids.add(id); this.byKey.set(key, ids);
    this.pending.set(id, key); this.characters += key.length;
    while (this.pending.size > this.maxLines || this.characters > this.maxCharacters) {
      this.remove(this.pending.keys().next().value!);
    }
  }
  private remove(id: number) {
    const key = this.pending.get(id)!;
    this.pending.delete(id); this.characters -= key.length;
    const ids = this.byKey.get(key)!;
    ids.delete(id);
    if (!ids.size) this.byKey.delete(key);
  }
  consume(event: string, line: string): boolean {
    const ids = this.byKey.get(JSON.stringify([event, collectorLineKey(line)]));
    if (!ids) return false;
    this.remove(ids.values().next().value!);
    return true;
  }
}
