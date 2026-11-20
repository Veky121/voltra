import {isRecord} from '../types/api';
import {matchesReadChange, readPolicy} from './readPolicy';
/** A live sample for one path: the same body that path's HTTP read answers with. */
export type LiveSnapshot<T = unknown> = {status: number; data: T; invalidate?: boolean};
type Entry = {
  listeners: Set<(sample: LiveSnapshot) => void>;
  pending: Set<() => void>;
  waiting?: boolean;
  at: number;
  sample?: LiveSnapshot;
};
const readListeners = new Map<string, Set<() => void>>();
// A hint without servers concerns every read of its domains. With servers, only
// reads of those servers and reads that belong to no single server.
type ReadChange = {domains: readonly string[]; servers?: readonly string[]};
let pendingChanges: ReadChange[] = [];
let readTimer: ReturnType<typeof setTimeout> | undefined;
let eventDriven = false,
  heartbeatAt = 0;
const entries = new Map<string, Entry>(),
  navigation = new Set<() => void>();
let socket: WebSocket | undefined,
  attempt = 0,
  revision = 0,
  ready = false,
  attached = false;
let retry: ReturnType<typeof setTimeout> | undefined,
  refresh: ReturnType<typeof setTimeout> | undefined,
  subscriptions: ReturnType<typeof setTimeout> | undefined;
export function livePathAllowed(path: string): boolean {
  if (path === '/api/client?summary=overview&states=1') return true;
  const match = path.match(
    /^\/api\/client\/servers\/[^/?#%.\\]+(?:\/(resources|console-history|steam|backups|schedules|activity|users|files\/list))?(?:\?([^#]*))?$/
  );
  if (!match) return false;
  const family = match[1] || '',
    q = new URLSearchParams(match[2] || '');
  for (const [key, value] of q) {
    if (q.getAll(key).length !== 1) return false;
    if (family === 'files/list' && key === 'directory' && value.length <= 1024 && !/[\x00\r\n]/.test(value)) continue;
    if (family === 'schedules' && key === 'include' && value === 'tasks') continue;
    // The overview's cards: the same sample, sent every 5 s instead of every second.
    if (family === 'resources' && key === 'summary' && value === 'overview') continue;
    if (
      ['backups', 'activity'].includes(family) &&
      ['page', 'per_page'].includes(key) &&
      /^\d+$/.test(value) &&
      Number(value) > 0 &&
      Number(value) <= (key === 'per_page' ? 100 : 10000)
    )
      continue;
    if (family === 'backups' && key === 'sort' && ['newest', 'oldest', 'largest', 'smallest', 'name'].includes(value))
      continue;
    if (family === 'backups' && key === 'origin' && ['manual', 'scheduled', 'unknown'].includes(value)) continue;
    return false;
  }
  return path.length <= 2048;
}
export function isLivePathFresh(path: string): boolean {
  const at = entries.get(path)?.at;
  if (!at || !ready) return false;
  const sampled = /\/(resources|console-history)(?:\?|$)/.test(path);
  return eventDriven && !sampled
    ? Date.now() - heartbeatAt < 45000 && Date.now() - at < 90000
    : Date.now() - at < 12000;
}
function invalidateReads(change: ReadChange) {
  for (const [path, entry] of entries)
    if (matchesReadChange(path, change.domains, change.servers)) {
      entry.at = 0;
      entry.waiting = true;
      for (const listener of entry.pending) listener();
    }
  pendingChanges.push(change);
  if (readTimer !== undefined) return;
  readTimer = setTimeout(() => {
    readTimer = undefined;
    const changes = pendingChanges;
    pendingChanges = [];
    for (const [path, listeners] of readListeners) {
      if (changes.some(change => matchesReadChange(path, change.domains, change.servers)))
        for (const listener of listeners) listener();
    }
  }, 250);
}
const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item: unknown): item is string => typeof item === 'string') : undefined;
/** The socket is connected and delivers snapshots for subscribed paths. */
export function liveSocketReady(): boolean {
  return ready && !!socket;
}
/** Change hints are arriving, so a read that was on screen the whole time is current. */
export function liveHintsHealthy(): boolean {
  return ready && !!socket && eventDriven && Date.now() - heartbeatAt < 45000;
}
export function observeReadInvalidation(path: string, listener: () => void): () => void {
  let listeners = readListeners.get(path);
  if (!listeners) {
    listeners = new Set();
    readListeners.set(path, listeners);
  }
  listeners.add(listener);
  ensureConnected();
  scheduleSubscriptions();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) readListeners.delete(path);
    scheduleSubscriptions();
    maybeStop();
  };
}
function invalidate() {
  if (refresh !== undefined) return;
  refresh = setTimeout(() => {
    refresh = undefined;
    for (const listener of navigation) listener();
  }, 75);
}
function clearFreshness() {
  for (const entry of entries.values()) entry.at = 0;
}
function sendSubscriptions() {
  subscriptions = undefined;
  if (!ready || !socket) return;
  const hidden = typeof document !== 'undefined' && document.hidden;
  socket.send(
    JSON.stringify({
      type: 'subscribe',
      revision: ++revision,
      paths: hidden ? [] : [...entries.keys()].slice(0, 64),
      domains: hidden
        ? []
        : [
            ...new Set([...readListeners.keys(), ...entries.keys()].flatMap(path => readPolicy(path)?.domains || [])),
          ].slice(0, 16),
    })
  );
}
function scheduleSubscriptions() {
  clearTimeout(subscriptions);
  subscriptions = setTimeout(sendSubscriptions, 75);
}
function visibility() {
  clearFreshness();
  scheduleSubscriptions();
}
function detachSocket() {
  ready = false;
  eventDriven = false;
  heartbeatAt = 0;
  clearFreshness();
  clearTimeout(retry);
  clearTimeout(subscriptions);
  if (socket) {
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    socket.close();
    socket = undefined;
  }
}
function detachListeners() {
  if (!attached) return;
  attached = false;
  window.removeEventListener('panel-auth-changed', authChanged);
  window.removeEventListener('desktop-session-rejected', authChanged);
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibility);
}
function authChanged() {
  detachSocket();
  clearTimeout(refresh);
  refresh = undefined;
  const old = [...entries.values()];
  entries.clear();
  navigation.clear();
  readListeners.clear();
  clearTimeout(readTimer);
  readTimer = undefined;
  pendingChanges = [];
  detachListeners();
  for (const entry of old) for (const listener of entry.listeners) listener({status: 401, data: null});
}
function maybeStop() {
  if (entries.size || navigation.size || readListeners.size) return;
  detachSocket();
  clearTimeout(refresh);
  refresh = undefined;
  clearTimeout(readTimer);
  readTimer = undefined;
  pendingChanges = [];
  detachListeners();
  attempt = 0;
}
function connect() {
  if (socket || (!entries.size && !navigation.size && !readListeners.size)) return;
  const url = new URL('/api/client/events', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

  const reconnect = () => {
    ready = false;
    socket = undefined;
    clearFreshness();
    if (!entries.size && !navigation.size && !readListeners.size) return;

    retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) * (0.8 + Math.random() * 0.4));
  };
  let current: WebSocket;
  try {
    current = socket = new WebSocket(url);
  } catch {
    reconnect();
    return;
  }
  current.onmessage = event => {
    if (socket !== current) return;
    let message: any;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!message || message.version !== 1) return;
    if (message.type === 'ready') {
      eventDriven = Array.isArray(message.capabilities) && message.capabilities.includes('event-driven');
      heartbeatAt = Date.now();
      invalidateReads({domains: ['all']});
      attempt = 0;
      ready = Array.isArray(message.capabilities) && message.capabilities.includes('snapshots');
      invalidate();
      if (ready) scheduleSubscriptions();
    } else if (message.type === 'heartbeat') {
      heartbeatAt = Date.now();
    } else if (message.type === 'reads.invalidated' && Array.isArray(message.domains)) {
      invalidateReads({domains: strings(message.domains)!, servers: strings(message.servers)});
    } else if (message.type === 'navigation.invalidated') invalidate();
    else if (['snapshot', 'invalidated', 'unchanged'].includes(message.type) && message.revision === revision) {
      const entry = entries.get(message.path);
      if (!entry || !Number.isInteger(message.status)) return;
      entry.at = message.status === 200 ? Date.now() : 0;
      heartbeatAt = Date.now();
      const waiting = entry.waiting;
      entry.waiting = false;
      if (message.type === 'unchanged') {
        if (waiting && entry.sample) for (const listener of entry.listeners) listener(entry.sample);
        return;
      }

      entry.sample = {status: message.status, data: message.data, invalidate: message.type === 'invalidated'};
      for (const listener of entry.listeners) listener(entry.sample);
    }
  };
  current.onclose = () => {
    if (socket === current) reconnect();
  };
  current.onerror = () => current.close();
}
function ensureConnected() {
  if (!attached) {
    attached = true;
    window.addEventListener('panel-auth-changed', authChanged);
    window.addEventListener('desktop-session-rejected', authChanged);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibility);
  }
  connect();
}
export function observeLivePath<T = unknown>(
  path: string,
  receive: (sample: LiveSnapshot<T>) => void,
  onPending?: () => void
): (() => void) | undefined {
  if (!livePathAllowed(path)) return undefined;
  // As with api<T>, the caller names the body its path answers with.
  const onSample = receive as (sample: LiveSnapshot) => void;
  let entry = entries.get(path);
  if (!entry) {
    entry = {listeners: new Set(), pending: new Set(), at: 0};
    entries.set(path, entry);
  }
  const observed = entry;
  observed.listeners.add(onSample);
  if (onPending) observed.pending.add(onPending);
  if (observed.sample && isLivePathFresh(path)) onSample(observed.sample);
  ensureConnected();
  scheduleSubscriptions();
  return () => {
    observed.listeners.delete(onSample);
    if (onPending) observed.pending.delete(onPending);
    if (!observed.listeners.size && entries.get(path) === observed) {
      entries.delete(path);
      scheduleSubscriptions();
    }
    maybeStop();
  };
}
/** The first error detail of a failed sample's body, if it has one. */
export function liveSampleError(data: unknown): string | undefined {
  const errors = isRecord(data) ? data.errors : undefined,
    first: unknown = Array.isArray(errors) ? errors[0] : undefined,
    detail = isRecord(first) ? first.detail : undefined;
  return typeof detail === 'string' ? detail : undefined;
}
export function observeLiveNavigation(onInvalidate: () => void): () => void {
  const listener = () => onInvalidate();
  navigation.add(listener);
  ensureConnected();
  return () => {
    navigation.delete(listener);
    maybeStop();
  };
}
