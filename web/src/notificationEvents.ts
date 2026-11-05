/** App-wide feedback bus. Usable outside React, including socket handlers. */
export type NotificationTone = 'info' | 'success' | 'warning' | 'error';
export type NotificationInput = { message: string; title?: string; tone?: NotificationTone; key?: string; durationMs?: number; progress?: number };
export type NotificationEvent = NotificationInput & { id: number; tone: NotificationTone; title: string; path: string; time: string; dismissed: boolean; revision: number };
let events: NotificationEvent[] = [];
let activeId: number | null = null;
let sequence = 0;
let snapshot: { events: NotificationEvent[]; activeId: number | null } = { events, activeId };
const listeners = new Set<() => void>();
const titles: Record<NotificationTone, string> = { info: 'Update', success: 'Done', warning: 'Needs attention', error: 'Something went wrong' };
function commit() {
  if (!events.some(event => event.id === activeId && !event.dismissed)) {
    const pending = events.filter(event => !event.dismissed);
    activeId = (pending.find(event => event.tone === 'error') || pending[0])?.id ?? null;
  }
  snapshot = { events, activeId };
  listeners.forEach(listener => listener());
}
export const notifications = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => snapshot,
  publish(input: NotificationInput): number {
    if (!input.message.trim()) return 0;
    const tone = input.tone ?? 'info';
    const path = typeof location === 'undefined' ? '' : location.pathname;
    const existing = events.find(event => input.key ? event.key === input.key : !event.dismissed && event.path === path && event.message === input.message && event.tone === tone);
    if (existing) {
      if (existing.message !== input.message || existing.tone !== tone || existing.progress !== input.progress) notifications.update(existing.id, { ...input, tone });
      return existing.id;
    }
    const id = ++sequence;
    events = [...events, { ...input, id, tone, title: input.title ?? titles[tone], path, time: new Date().toLocaleTimeString(), dismissed: false, revision: 0 }].slice(-100);
    const pending = events.filter(event => !event.dismissed && event.id !== activeId);
    const overflow = new Set(pending.slice(0, Math.max(0, pending.length - 10)).map(event => event.id));
    events = events.map(event => overflow.has(event.id) ? { ...event, dismissed: true } : event);
    commit();
    return id;
  },
  update(id: number, patch: Partial<NotificationInput>) {
    events = events.map(event => {
      if (event.id !== id) return event;
      const changed = (patch.message !== undefined && patch.message !== event.message) || (patch.tone !== undefined && patch.tone !== event.tone);
      return { ...event, ...patch, title: patch.title ?? (patch.tone ? titles[patch.tone] : event.title), revision: event.revision + (changed ? 1 : 0), dismissed: changed ? false : event.dismissed };
    });
    commit();
  },
  dismiss(id: number) { events = events.map(event => event.id === id ? { ...event, dismissed: true } : event); commit(); },
  resolve(key: string) { events = events.map(event => event.key === key ? { ...event, key: undefined, dismissed: true } : event); commit(); },
  clear() { events = []; commit(); },
};
