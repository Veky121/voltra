import {api} from '../../lib';

// One Wings socket per server page. The console and transfer tracking both
// listen on it; it fetches credentials, authenticates, refreshes its token,
// reconnects with backoff and closes at the sign-in boundary.
export type WingsMessage = {event: string; args: any[]};
export type WingsConnection = 'connecting' | 'reconnecting' | 'connected' | 'disconnected';
export type WingsListener = {
  message?(message: WingsMessage): void;
  /** Connection state and the latest socket error, '' when clear. Called at once on subscribe. */
  state?(connection: WingsConnection, error: string): void;
  /** The socket authenticated. Called at once on subscribe when it already is. */
  ready?(): void;
  /** The authenticated connection ended. */
  closed?(): void;
  /**
   * Shows console output as it arrives. While such a listener is present, a log
   * replay is only requested by that listener ('display'), so its output is
   * never repeated by a replay another listener asked for.
   */
  showsOutput?: boolean;
};
export type ServerSocket = {
  subscribe(listener: WingsListener): () => void;
  /**
   * Asks Wings to replay recent output. 'display' is the console's own request;
   * 'recovery' (operation reports) waits while a listener shows output.
   * Returns whether the request was sent now.
   */
  requestLogs(kind: 'display' | 'recovery'): boolean;
  /**
   * A listener's `showsOutput` changed. A recovery replay that was waiting for
   * it is sent once no listener shows output any more.
   */
  outputChanged(): void;
  /** Sends an event on the authenticated socket. Returns whether it was sent. */
  send(event: string, args?: unknown[]): boolean;
  readonly connection: WingsConnection;
  readonly error: string;
  readonly authenticated: boolean;
};
type Timer = ReturnType<typeof setTimeout>;
export type ServerSocketDeps = {
  credentials(base: string): Promise<{socket: string; token: string}>;
  open(url: URL): WebSocket;
  href(): string;
  setTimeout(callback: () => void, ms: number): Timer;
  clearTimeout(timer: Timer | undefined): void;
};
const unwrap = (data: any) => data?.attributes ?? data?.data ?? data;
export const browserServerSocketDeps: ServerSocketDeps = {
  credentials: async base => {
    const d = unwrap(await api(`${base}/websocket`));
    return {socket: String(d.socket), token: String(d.token)};
  },
  open: url => new WebSocket(url),
  href: () => location.href,
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: timer => clearTimeout(timer),
};
export const SOCKET_FAILED = 'The console connection failed. Check the node address and Wings service.';
export const reconnectDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 15000);

export function createServerSocket(
  base: string,
  deps: ServerSocketDeps = browserServerSocketDeps
): ServerSocket & {dispose(): void} {
  const listeners = new Set<WingsListener>();
  let current: WebSocket | undefined,
    retry = 0,
    timer: Timer | undefined,
    disposed = false,
    starting: object | undefined;
  let connection: WingsConnection = 'disconnected',
    error = '',
    authenticated = false;
  let replayed = false,
    pendingRecovery = false,
    session = 0;
  const each = (call: (listener: WingsListener) => void) => {
    for (const listener of Array.from(listeners))
      if (listeners.has(listener))
        try {
          call(listener);
        } catch {
          /* One listener cannot break the others. */
        }
  };
  const setState = (next: WingsConnection, nextError = error) => {
    connection = next;
    error = nextError;
    each(listener => listener.state?.(connection, error));
  };
  const raw = (event: string, args: unknown[] = []) => {
    try {
      current?.send(JSON.stringify({event, args}));
      return true;
    } catch {
      return false;
    }
  };
  const showingOutput = () => Array.from(listeners).some(listener => listener.showsOutput);
  function schedule() {
    deps.clearTimeout(timer);
    timer = undefined;
    if (disposed || !listeners.size) return;
    timer = deps.setTimeout(() => {
      timer = undefined;
      void connect();
    }, reconnectDelay(retry++));
  }
  // Its handlers stay attached but ignore everything once it is not `current`.
  function drop(socket: WebSocket | undefined) {
    if (!socket) return;
    try {
      socket.close();
    } catch {
      /* Already closed. */
    }
  }
  function ended() {
    const was = authenticated;
    authenticated = false;
    replayed = false;
    pendingRecovery = false;
    if (was) each(listener => listener.closed?.());
  }
  async function refreshToken(expired: boolean, socket: WebSocket, started: number) {
    try {
      const {token} = await deps.credentials(base);
      if (current === socket && session === started) raw('auth', [token]);
    } catch (cause) {
      if (current !== socket || session !== started) return;
      setState(connection, cause instanceof Error ? cause.message : String(cause));
      // An expired token cannot be used again: start over with new credentials.
      if (expired) socket.close();
    }
  }
  async function connect() {
    if (disposed || current || starting || !listeners.size) return;
    const attempt = {};
    starting = attempt;
    const started = session;
    setState(retry ? 'reconnecting' : 'connecting');
    let credentials: {socket: string; token: string};
    try {
      credentials = await deps.credentials(base);
    } catch (cause) {
      if (starting !== attempt) return;
      starting = undefined;
      if (disposed || session !== started) return;
      setState('disconnected', cause instanceof Error ? cause.message : String(cause));
      schedule();
      return;
    }
    if (starting !== attempt) return;
    starting = undefined;
    if (disposed || session !== started || !listeners.size) return;
    let socket: WebSocket;
    try {
      const url = new URL(credentials.socket, deps.href());
      if (url.protocol === 'http:') url.protocol = 'ws:';
      if (url.protocol === 'https:') url.protocol = 'wss:';
      socket = current = deps.open(url);
    } catch (cause) {
      setState('disconnected', cause instanceof Error ? cause.message : SOCKET_FAILED);
      schedule();
      return;
    }
    socket.onopen = () => {
      if (current === socket) raw('auth', [credentials.token]);
    };
    socket.onmessage = event => {
      if (current !== socket) return;
      let message: WingsMessage;
      try {
        const parsed = JSON.parse(String(event.data));
        message = {event: String(parsed?.event ?? ''), args: Array.isArray(parsed?.args) ? parsed.args : []};
      } catch {
        setState(connection, 'Received an invalid daemon event.');
        return;
      }
      switch (message.event) {
        case 'auth success':
          // A refreshed token authenticates the same connection again: no new replay or ready.
          retry = 0;
          if (!authenticated) {
            authenticated = true;
            replayed = false;
            setState('connected', '');
            each(listener => listener.ready?.());
          } else setState('connected', '');
          break;
        case 'token expiring':
        case 'token expired':
          void refreshToken(message.event === 'token expired', socket, session);
          break;
        case 'jwt error':
          setState(connection, String(message.args[0] || 'Daemon rejected the request'));
          // A rejected token is not retried on this connection; reconnect with new credentials.
          socket.close();
          break;
        case 'daemon error':
          setState(connection, String(message.args[0] || 'Daemon rejected the request'));
          break;
      }
      each(listener => listener.message?.(message));
    };
    socket.onerror = () => {
      if (current === socket) setState(connection, SOCKET_FAILED);
    };
    socket.onclose = () => {
      if (current !== socket) return;
      current = undefined;
      ended();
      setState('disconnected');
      schedule();
    };
  }
  function restart() {
    // The sign-in changed: nothing from the old connection may reach a listener.
    session++;
    deps.clearTimeout(timer);
    timer = undefined;
    retry = 0;
    const old = current;
    current = undefined;
    starting = undefined;
    drop(old);
    ended();
    if (listeners.size && !disposed) {
      setState('disconnected', '');
      void connect();
    }
  }
  const authChanged = () => restart();
  if (typeof window !== 'undefined') {
    window.addEventListener('panel-auth-changed', authChanged);
    window.addEventListener('desktop-session-rejected', authChanged);
  }
  function sendRecovery() {
    if (!authenticated || replayed) return false;
    replayed = true;
    pendingRecovery = false;
    return raw('send logs');
  }
  return {
    get connection() {
      return connection;
    },
    get error() {
      return error;
    },
    get authenticated() {
      return authenticated;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener.state?.(connection, error);
      if (authenticated) listener.ready?.();
      void connect();
      return () => {
        if (!listeners.delete(listener)) return;
        if (listener.showsOutput && pendingRecovery && !showingOutput()) sendRecovery();
        if (!listeners.size) {
          deps.clearTimeout(timer);
          timer = undefined;
        }
      };
    },
    requestLogs(kind) {
      if (!authenticated) {
        if (kind === 'recovery') pendingRecovery = true;
        return false;
      }
      if (kind === 'display') {
        replayed = true;
        pendingRecovery = false;
        return raw('send logs');
      }
      if (showingOutput()) {
        pendingRecovery = true;
        return false;
      }
      return sendRecovery();
    },
    outputChanged() {
      if (pendingRecovery && !showingOutput()) sendRecovery();
    },
    send(event, args = []) {
      return authenticated && raw(event, args);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      session++;
      deps.clearTimeout(timer);
      timer = undefined;
      const old = current;
      current = undefined;
      drop(old);
      ended();
      listeners.clear();
      if (typeof window !== 'undefined') {
        window.removeEventListener('panel-auth-changed', authChanged);
        window.removeEventListener('desktop-session-rejected', authChanged);
      }
    },
  };
}

type Held = {socket: ReturnType<typeof createServerSocket>; holders: number; linger?: Timer; deps: ServerSocketDeps};
const held = new Map<string, Held>();
/**
 * Closes every pooled socket, including those lingering after a page change.
 * Called at a session boundary: a socket authenticated for one account is
 * never handed to the next, even for the same server.
 */
export function disposeServerSockets() {
  const entries: Held[] = [];
  held.forEach(entry => entries.push(entry));
  held.clear();
  entries.forEach(entry => {
    entry.deps.clearTimeout(entry.linger);
    entry.socket.dispose();
  });
}
if (typeof window !== 'undefined') {
  // A sign-out unmounts the app; a new identity remounts it (setup.tsx). In
  // both, no page keeps a socket across the boundary.
  window.addEventListener('panel-auth-changed', disposeServerSockets);
  window.addEventListener('panel-session-identity-changed', disposeServerSockets);
}
/** How long an unused socket stays open, so a page change does not reconnect. */
export const SOCKET_LINGER_MS = 1500;
/** The page's shared socket for this server. Call `release` when done. */
export function acquireServerSocket(
  base: string,
  deps: ServerSocketDeps = browserServerSocketDeps
): {socket: ServerSocket; release: () => void} {
  let entry = held.get(base);
  if (entry && entry.deps !== deps) {
    entry.deps.clearTimeout(entry.linger);
    entry.socket.dispose();
    held.delete(base);
    entry = undefined;
  }
  if (!entry) {
    entry = {socket: createServerSocket(base, deps), holders: 0, deps};
    held.set(base, entry);
  }
  const owned = entry;
  owned.holders++;
  owned.deps.clearTimeout(owned.linger);
  owned.linger = undefined;
  let released = false;
  return {
    socket: owned.socket,
    release: () => {
      if (released) return;
      released = true;
      if (--owned.holders > 0) return;
      owned.linger = owned.deps.setTimeout(() => {
        if (owned.holders > 0 || held.get(base) !== owned) return;
        held.delete(base);
        owned.socket.dispose();
      }, SOCKET_LINGER_MS);
    },
  };
}
