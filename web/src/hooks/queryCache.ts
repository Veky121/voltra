import {readPolicy} from './readPolicy';
export type QueryRequest = <T>(path: string, options?: RequestInit) => Promise<T>;
type Snapshot = {data: any; error: string; loading: boolean};
type Entry = {
  path: string;
  request: QueryRequest;
  state: Snapshot;
  expires: number;
  answeredAt: number;
  listeners: Set<() => void>;
  abort?: AbortController;
  flight?: Promise<void>;
  queued: boolean;
  version: number;
};
const entries = new Map<string, Entry>();
const pendingInvalidations = new Set<Entry>();
let epoch = 0;
let sessionScope: unknown;
/** In-memory view state must be fenced by the same authentication boundary as reads. */
export function queryCacheEpoch() {
  return epoch;
}
export function readQuerySnapshot(path: string | null, request: QueryRequest) {
  const entry = path ? entries.get(path) : undefined;
  return entry?.request === request ? entry.state : undefined;
}
/** When this read last answered successfully, or 0. */
export function queryAnsweredAt(path: string | null, request: QueryRequest): number {
  const entry = path ? entries.get(path) : undefined;
  return entry?.request === request ? entry.answeredAt : 0;
}
/** Pass a stable account/session identity on every session refresh. */
export function setQueryCacheScope(scope: unknown) {
  if (!Object.is(scope, sessionScope)) {
    sessionScope = scope;
    purgeQueryCache();
  }
}
export function normalizedQueryPath(path: string): string {
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const url = new URL(path, base);
    return url.origin === base ? url.pathname + url.search : '';
  } catch {
    return '';
  }
}
const MAX_ENTRIES = 150;
// Freshness only: an allowlisted read is not fetched again while this young.
// Explicit allowlist: never widen this to arbitrary server child resources.
export function queryTTL(path: string): number {
  if (/^\/api\/client\/(account|settings)$/.test(path)) return 15000;
  if (/^\/api\/client\/servers\/[^/?#]+\/files\/list\?directory=[^#]*$/.test(path)) return 2000;
  if (/^\/api\/(admin|application)\/locations(?:\?[^#]*)?$/.test(path)) return 15000;
  if (/^\/api\/application\/(nodes|servers)\?per_page=100$/.test(path)) return 5000;
  if (/^\/api\/client(?:\?[^#]*)?$/.test(path)) return 5000;
  if (/^\/api\/client\/servers\/[^/?#]+$/.test(path)) return 5000;
  if (/^\/api\/client\/game-library\/(catalog|templates|steam)(?:\?[^#]*)?$/.test(path)) return 30000;
  return 0;
}
// Never painted from an earlier answer: bytes, signed links, sockets, credentials,
// one-time tokens, account security, live telemetry and the session itself.
const neverStale = [
  /\/(?:events|ws|websocket|contents|download|download-stream|preview|upload|uploads|export|node-installer|signed)(?:\/|$)/,
  /\/(?:password|passwords|credentials|token|tokens|secret|secrets|api-keys|ssh-keys|sftp-password|licences|licenses|pair|pairings|devices|recovery)(?:\/|$)/,
  /\/(?:resources|console-history)(?:\/|$)/,
  /^\/api\/client\/account\/(?!activity(?:\/|$))/,
  /^\/api\/(?:auth|setup|remote)(?:\/|$)/,
];
/**
 * Whether a read keeps its last answer and paints it at once while it is fetched
 * again. Everything else starts empty. Reads the panel refreshes in the background
 * (`readPolicy`) qualify; editing forms, secrets and confirmations of destructive
 * actions are excluded there or here, and a caller that needs a fresh answer uses
 * `useFreshAPI`.
 */
export function queryCacheable(path: string): boolean {
  if (queryTTL(path)) return true;
  let url: URL;
  try {
    url = new URL(path, 'http://panel.local');
  } catch {
    return false;
  }
  if (url.origin !== 'http://panel.local' || url.hash) return false;
  if (/password|token|secret|signature|credential/i.test(url.search)) return false;
  if (neverStale.some(pattern => pattern.test(url.pathname))) return false;
  if (url.pathname === '/locales/locale.json') return true;
  return readPolicy(path) !== null;
}
function emit(entry: Entry) {
  for (const listener of entry.listeners) listener();
}
function entryFor(path: string, request: QueryRequest) {
  let entry = entries.get(path);
  if (entry && entry.request !== request) return undefined;
  if (entry) {
    entries.delete(path);
    entries.set(path, entry);
    return entry;
  } // Most recently used last.
  // Never evict an active consumer. Fall back to an uncached request at capacity.
  if (entries.size >= MAX_ENTRIES) {
    const victim = [...entries].find(([, e]) => !e.listeners.size);
    if (victim) {
      victim[1].abort?.abort();
      entries.delete(victim[0]);
    } else return undefined;
  }
  entry = {
    path,
    request,
    state: {data: null, error: '', loading: false},
    expires: 0,
    answeredAt: 0,
    listeners: new Set(),
    queued: false,
    version: 0,
  };
  entries.set(path, entry);
  return entry;
}
function load(entry: Entry, force = false) {
  if (entry.flight) {
    if (force) entry.queued = true;
    return;
  }
  if (!force && entry.expires > Date.now()) return;
  const generation = epoch,
    version = entry.version,
    abort = new AbortController();
  entry.abort = abort;
  // The last answer stays on screen while it is revalidated.
  entry.state = {...entry.state, error: '', loading: true};
  emit(entry);
  // Install flight before invoking request, including synchronous errors.
  entry.flight = Promise.resolve()
    .then(() => entry.request(entry.path, {signal: abort.signal}))
    .then(
      data => {
        if (epoch === generation && entry.version === version && !abort.signal.aborted) {
          entry.state = {data, error: '', loading: false};
          entry.answeredAt = Date.now();
          entry.expires = entry.answeredAt + queryTTL(entry.path);
          emit(entry);
        }
      },
      error => {
        if (epoch === generation && entry.version === version && !abort.signal.aborted) {
          entry.state = {
            ...entry.state,
            data: [401, 403, 404].includes(Number((error as any)?.status)) ? null : entry.state.data,
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          };
          emit(entry);
        }
      }
    )
    .finally(() => {
      if (entry.abort !== abort) return;
      entry.flight = undefined;
      entry.abort = undefined;
      if (entry.queued && entry.listeners.size) {
        entry.queued = false;
        load(entry, true);
      }
    });
}
export function observeQuery(path: string, request: QueryRequest, listener: (state: Snapshot) => void) {
  if (!queryCacheable(path)) return undefined;
  const entry = entryFor(path, request);
  if (!entry) return undefined;
  const notify = () => listener(entry.state);
  entry.listeners.add(notify);
  notify();
  load(entry);
  return {
    reload: () => load(entry, true),
    unsubscribe: () => {
      entry.listeners.delete(notify);
      if (!entry.listeners.size && entry.flight) {
        entry.version++;
        entry.abort?.abort();
        entry.abort = undefined;
        entry.flight = undefined;
        entry.queued = false;
        entry.state = {...entry.state, loading: false};
      }
    },
  };
}
/** A socket snapshot fences any older HTTP flight for an already cached read. */
export function applyLiveQuery(path: string, data: any, error: string) {
  const entry = entries.get(path);
  if (!entry) return;
  entry.version++;
  entry.abort?.abort();
  entry.abort = undefined;
  entry.flight = undefined;
  entry.queued = false;
  entry.state = {data, error, loading: false};
  if (!error) entry.answeredAt = Date.now();
  entry.expires = error ? 0 : Date.now() + queryTTL(path);
  emit(entry);
}
/** A change arrived, but its replacement snapshot is still being collected. */
export function fenceQueryResponse(path: string) {
  const entry = entries.get(path);
  if (!entry) return;
  entry.version++;
  entry.expires = 0;
  entry.abort?.abort();
  entry.abort = undefined;
  entry.flight = undefined;
  entry.queued = false;
}

type Target = (key: string) => boolean;
const everything: Target = () => true;
const under =
  (...roots: string[]): Target =>
  key =>
    roots.some(root => key === root || key.startsWith(root + '/'));
const exactly =
  (...keys: string[]): Target =>
  key =>
    keys.includes(key);
const any =
  (...targets: Target[]): Target =>
  key =>
    targets.some(target => target(key));
const adminFamilies = (...families: string[]) =>
  under(...families.flatMap(family => [`/api/admin/${family}`, `/api/application/${family}`]));
/**
 * Which cached reads a successful write can change, by route family. Keys are
 * read paths without their query. `null` means none. Anything not recognised
 * refreshes every read: a missed refresh shows wrong data, an extra one costs a
 * request.
 */
export function mutationTargets(mutationPath: string): Target | null {
  const path = normalizedQueryPath(mutationPath).split('?')[0];
  // Another origin, such as a node's signed upload URL, changes no panel read.
  if (!path) return null;
  // Sidebar order and favourites are drawn from their own saved copy.
  if (/\/(navigation|favorite|favourite)(?:\/|$)/.test(path)) return null;
  const server = path.match(/^\/api\/client\/servers\/([^/]+)(?:\/(.*))?$/);
  if (server) {
    const root = `/api/client/servers/${server[1]}`,
      rest = server[2] || '',
      family = rest.split('/')[0];
    // A console command reaches the game, not the panel: its output arrives on the
    // console socket and no cached read changes. Power actions still refresh.
    if (rest === 'command') return null;
    const own = (...families: string[]) => under(...families.map(name => `${root}/${name}`));
    // Most writes add an activity entry for this server.
    const activity = own('activity');
    switch (family) {
      case 'files':
        return any(own('files'), activity);
      // Restoring a backup replaces files and the server's state.
      case 'backups':
        return any(own('backups', 'files'), exactly(root), activity);
      case 'schedules':
        return any(own('schedules'), activity);
      case 'databases':
        return any(own('databases'), exactly(root), activity);
      case 'network':
      case 'allocations':
      case 'proxy':
      case 'proxy-routes':
      case 'subdomain':
        return any(
          own('network', 'allocations', 'proxy', 'proxy-routes', 'subdomain'),
          exactly(root, '/api/client'),
          activity
        );
      case 'users':
        return any(own('users'), activity);
      case 'steam':
        return any(own('steam'), exactly(root), activity);
    }
    // Power, settings, startup, reinstall and anything else: every read of this server.
    return any(under(root), exactly('/api/client'));
  }
  if (path === '/api/client/account' || path.startsWith('/api/client/account/')) return under('/api/client/account');
  if (path.startsWith('/api/client/game-library/'))
    return any(
      under('/api/client/game-library', '/api/client/servers'),
      exactly('/api/client'),
      adminFamilies('servers')
    );
  const admin = path.match(/^\/api\/(?:admin|application)\/([^/]+)/);
  if (admin) {
    // Client views of a server use its UUID, administration uses its number,
    // so a server change refreshes every client server read.
    const clientServers = any(under('/api/client/servers'), exactly('/api/client'));
    switch (admin[1]) {
      case 'servers':
        return any(adminFamilies('servers'), clientServers);
      case 'nodes':
      case 'locations':
        return any(adminFamilies('nodes', 'locations', 'servers'), clientServers);
      case 'users':
        return any(adminFamilies('users'), under('/api/client/account'), exactly('/api/client'));
      case 'eggs':
      case 'nests':
        return any(adminFamilies('eggs', 'nests', 'servers'), under('/api/client/game-library'), clientServers);
    }
  }
  return everything;
}
function invalidateEntry(entry: Entry) {
  entry.version++;
  entry.expires = 0;
  entry.state = {...entry.state, error: '', loading: false};
  entry.abort?.abort();
  entry.abort = undefined;
  entry.flight = undefined;
  entry.queued = false;
  emit(entry);
  if (entry.listeners.size) load(entry, true);
}
/** Call after any out-of-band mutation. Conservative invalidation also refreshes active readers. */
export function invalidateQueryCache(mutationPath?: string) {
  const target = mutationPath === undefined ? everything : mutationTargets(mutationPath);
  if (!target) return;
  // Unwatched answers are kept, but are fetched again before they count as fresh.
  for (const entry of [...entries.values()]) if (target(entry.path.split('?')[0])) invalidateEntry(entry);
}
/** Authentication boundary: fence all old responses and clear every consumer without refetching. */
export function purgeQueryCache() {
  epoch++;
  for (const entry of [...entries.values()]) {
    entry.version++;
    entry.expires = 0;
    entry.answeredAt = 0;
    entry.abort?.abort();
    entry.abort = undefined;
    entry.flight = undefined;
    entry.queued = false;
    entry.state = {data: null, error: '', loading: false};
    emit(entry);
    if (!entry.listeners.size) entries.delete(entry.path);
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('panel-auth-changed', purgeQueryCache);
  window.addEventListener('desktop-session-rejected', purgeQueryCache);
}

/** Fence an older HTTP response before refreshing exactly one watched read. */
export function invalidateExactQuery(path: string): boolean {
  const entry = entries.get(path);
  if (!entry) return false;
  if (pendingInvalidations.has(entry)) return true;
  pendingInvalidations.add(entry);
  const generation = epoch;
  entry.version++;
  entry.expires = 0;
  entry.abort?.abort();
  entry.abort = undefined;
  entry.flight = undefined;
  entry.queued = false;
  entry.state = {...entry.state, loading: false};
  queueMicrotask(() => {
    pendingInvalidations.delete(entry);
    if (generation === epoch && entry.listeners.size) load(entry, true);
  });
  return true;
}
