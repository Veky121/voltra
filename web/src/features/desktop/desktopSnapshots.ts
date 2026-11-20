import {adoptAccountSnapshots, setSnapshotStore, type SnapshotStore} from '../../accountSnapshots';

// On the desktop the saved pages live with the host, beside the connection,
// instead of in the WebView's storage. The WebView's storage belongs to
// whichever port the app is running on; the host's copy follows the
// connection and is deleted by unlinking wherever the app happens to run.

/**
 * An in-memory store that reports every change with its full contents, and
 * every removal asked for, whether or not there was anything to remove.
 */
export function memoryStore(
  initial: Record<string, string>,
  changed: (values: Record<string, string>) => void,
  removed?: (key: string) => void
): SnapshotStore {
  const values = new Map(Object.entries(initial));
  const report = () => changed(Object.fromEntries(values));
  return {
    get length() {
      return values.size;
    },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (values.get(key) !== value) {
        values.set(key, value);
        report();
      }
    },
    removeItem(key) {
      removed?.(key);
      if (values.delete(key)) report();
    },
  };
}

let ready: Promise<void> | undefined;
/** The host's copy, read for this page. A relink or unlink reloads the page. */
export function desktopSnapshotsReady(): Promise<void> {
  return (ready ??= loadDesktopSnapshots());
}

/** Reads the host's copy and makes it the store the saved pages use. */
export async function loadDesktopSnapshots(request: typeof fetch = fetch, delay = 500, retryDelay = 5000) {
  // The host hands nothing over, and names nothing to save under, until the
  // panel has accepted the connection in this launch. It says so (`pending`),
  // and is asked again later.
  async function read(): Promise<{connection?: string; pending: boolean; entries: Record<string, string>} | undefined> {
    try {
      const response = await request('/desktop/snapshots', {cache: 'no-store'});
      // The host failing this time says nothing about the next time.
      if (response.status >= 500) return undefined;
      const data = (response.ok ? await response.json() : undefined) as
        {connection?: unknown; pending?: unknown; entries?: unknown} | undefined;
      const entries: Record<string, string> = {};
      if (data?.entries && typeof data.entries === 'object' && !Array.isArray(data.entries))
        for (const [key, value] of Object.entries(data.entries)) if (typeof value === 'string') entries[key] = value;
      return {
        connection: typeof data?.connection === 'string' && data.connection ? data.connection : undefined,
        pending: data?.pending === true,
        entries,
      };
    } catch {
      // Without the host's copy the app starts from the panel alone, and asks again later.
      return undefined;
    }
  }
  const first = await read();
  // The host names the connection its copies are for and accepts them back
  // only under that name. Without the name nothing can be saved.
  let connection = first?.connection;
  // Whether the host's copies are still to come: it said to wait, or could
  // not be asked. Only an answer from it settles that.
  let owed = first === undefined || first.pending;
  // Copies the page threw away meanwhile, such as one that grew too large to
  // keep. The host's older copy of the same thing is not brought back.
  const discarded = new Set<string>();

  /**
   * The late hand-over. By now the page has started from the panel and
   * identified its account in an empty store. The host's copies of that
   * account join it, and only then is there a name to save under. Until then
   * nothing is sent: a save replaces everything the host holds, and the page
   * has not been shown what that is.
   */
  async function handOver() {
    const late = await read();
    // Not reached, or still waiting for the panel: asked again with the next change.
    if (!late || late.pending) return;
    if (late.connection === undefined) owed = false;
    else if (
      await adoptAccountSnapshots(
        Object.fromEntries(Object.entries(late.entries).filter(([key]) => !discarded.has(key)))
      )
    ) {
      connection = late.connection;
      owed = false;
    }
  }

  // One save at a time, always of the newest contents: an answer to an older
  // save can then never undo a newer one.
  let newest: Record<string, string> | undefined;
  let sending = false;
  // A save the host could not make this time (a failed write, a dropped
  // request) is tried again a few times, further apart each time.
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const save = (entries: Record<string, string>) =>
    request('/desktop/snapshots', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({connection, entries}),
    }).catch(() => undefined);
  async function send() {
    if (sending) return;
    sending = true;
    try {
      if (owed) await handOver();
      while (newest !== undefined && connection !== undefined) {
        const entries = newest;
        newest = undefined;
        const response = await save(entries);
        if (!response || response.status >= 500) {
          if (newest !== undefined) continue;
          if (failures < 3) {
            failures++;
            newest = entries;
            retry = setTimeout(() => void send(), retryDelay * failures);
            if (typeof retry === 'object') retry.unref?.();
            return;
          }
          // Still failing: the host must not be left holding an older copy.
          failures = 0;
          await save({});
          continue;
        }
        failures = 0;
        // The app was unlinked or relinked since: these copies belong to no one now.
        if (response.status === 401 || response.status === 409) connection = undefined;
        // The host would not take this copy, and nothing newer is waiting. It
        // must not keep an older one either; an empty copy is always accepted.
        else if (!response.ok && newest === undefined) await save({});
      }
    } finally {
      sending = false;
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  setSnapshotStore(
    memoryStore(
      first?.entries ?? {},
      values => {
        newest = values;
        // Several entries usually change together; send them once. A change also
        // supersedes whatever was waiting to be tried again.
        clearTimeout(retry);
        clearTimeout(timer);
        timer = setTimeout(() => void send(), delay);
      },
      key => {
        if (owed) discarded.add(key);
      }
    )
  );
}
