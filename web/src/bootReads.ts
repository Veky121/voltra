// public/startup.js starts the first reads while the bundle is still
// downloading and compiling. Each answer is handed to the first request that
// asks for it; everything after that is an ordinary request.
type BootReads = {
  at: number;
  /** The saved-pages revision when the reads began; see accountSnapshots.ts. */
  revision?: string | null;
  take(path: string): Promise<Response | undefined> | undefined;
  /** Abandons every read still on its way. */
  cancel?(): void;
};
type BootGlobal = {__voltraBoot?: BootReads};

// The same key accountSnapshots.ts keeps its revision under. startup.js reads
// it from the browser's storage, so the comparison below does too.
const revisionKey = 'voltra.snapshot-session';
// The one early read whose answer says nothing about who is signed in.
const sessionFree = '/api/setup/status';
/**
 * Whether the session these reads were started under can be shown to be the
 * one still signed in. Anything short of that counts as no: a start that noted
 * no revision, storage that can no longer be read, a revision that moved, and
 * a revision that is not there. A missing key proves nothing, because a
 * sign-in or sign-out that could not write a new value removes the old one.
 */
function sessionVerified(boot: BootReads): boolean {
  if (typeof boot.revision !== 'string' || boot.revision === '') return false;
  try {
    const storage = globalThis.localStorage;
    return !!storage && storage.getItem(revisionKey) === boot.revision;
  } catch {
    return false;
  }
}

// Past this age an early answer is no fresher than asking again.
const lifetime = 15_000;
const signedInKey = 'voltra.signed-in';
// Requests waiting for an early answer, to be released when the answers end.
const waiting = new Set<() => void>();

/**
 * Ends the early answers: a write, a sign-out or their age has made them
 * untrustworthy. Requests still waiting for one are released to ask the panel
 * themselves, and the reads still on their way are abandoned.
 */
export function discardBootReads() {
  const boot = (globalThis as BootGlobal).__voltraBoot;
  delete (globalThis as BootGlobal).__voltraBoot;
  try {
    boot?.cancel?.();
  } catch {
    // Nothing more can be done for a read that will not stop.
  }
  for (const release of [...waiting]) release();
}

/** The revision startup.js saw when it began its reads, or undefined if it began none. */
export function bootReadsRevision(): string | null | undefined {
  return (globalThis as BootGlobal).__voltraBoot?.revision;
}

/**
 * Resolves to the early answer for a GET, body included, or undefined when the
 * caller must fetch. The wait ends when the caller gives up, when the answers
 * are discarded, and when their lifetime runs out, whichever comes first: the
 * request was started without the caller's signal, so the body is read here,
 * where it can still be left behind.
 */
export async function takeBootRead(path: string, signal?: AbortSignal | null): Promise<Response | undefined> {
  const boot = (globalThis as BootGlobal).__voltraBoot;
  if (!boot) return undefined;
  const left = () => boot.at + lifetime - performance.now();
  // Too old, or asked for under a session that cannot be shown to be the
  // current one: another tab may have signed out or in before this page could
  // listen for it. Only the answer that depends on no session is exempt.
  const unverified = () => path !== sessionFree && !sessionVerified(boot);
  if (left() <= 0) {
    discardBootReads();
    return undefined;
  }
  if (unverified()) {
    // A start that noted no revision asked for nothing that depends on the
    // session, so the answer it is still fetching is left alone. Otherwise
    // the session moved, or can no longer be checked, and the batch ends.
    if (typeof boot.revision === 'string') discardBootReads();
    return undefined;
  }
  // Like fetch, a caller that has already given up gets its own reason back.
  signal?.throwIfAborted();
  const pending = boot.take(path);
  if (!pending) return undefined;

  const ended = Symbol('ended');
  let over = false;
  let release = () => {};
  const discarded = new Promise<typeof ended>(resolve => {
    release = () => {
      over = true;
      resolve(ended);
    };
  });
  waiting.add(release);
  const expiry = setTimeout(discardBootReads, left());
  let stop = () => {};
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return;
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, {once: true});
    stop = () => signal.removeEventListener('abort', abort);
  });
  try {
    const response = await Promise.race([pending, aborted, discarded]);
    // `over` also covers an answer that settled in the same instant the answers
    // ended, the clock one whose timer a sleeping tab never ran, and the
    // revision a session that another tab ended while this waited.
    const spent = () => over || left() <= 0 || unverified();
    if (spent() || response === ended || !response) return undefined;
    // A refusal or failure is reported by the caller's own request. The one
    // exception is the desktop host saying the connection itself changed:
    // asking again would be answered by a different connection.
    if (!response.ok && response.status !== 409) return undefined;
    let body: ArrayBuffer | typeof ended | null = null;
    if (response.status !== 204 && response.status !== 205) {
      try {
        body = await Promise.race([response.arrayBuffer(), aborted, discarded]);
      } catch (error) {
        // The caller gave up, or the connection dropped mid-answer. Only the
        // first is the caller's to hear about; the second is asked again.
        if (signal?.aborted) throw error;
        return undefined;
      }
    }
    if (spent() || body === ended) return undefined;
    return new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
  } finally {
    stop();
    clearTimeout(expiry);
    waiting.delete(release);
  }
}

/** startup.js only asks for account reads when they succeeded last time. */
export function rememberSignedIn(signedIn: boolean) {
  try {
    if (signedIn) globalThis.localStorage?.setItem(signedInKey, '1');
    else globalThis.localStorage?.removeItem(signedInKey);
  } catch {
    // Without storage the next start only asks for the session.
  }
}
