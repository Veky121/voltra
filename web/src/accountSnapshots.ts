// What an account last saw, kept so a page can draw before the panel answers.
//
// A copy belongs to one account. It is removed when that account signs out,
// when the panel rejects the session, and when another account is identified
// (see signedOut.ts for the first two). It is only a head start: every reader
// still asks the panel.
//
// Several tabs share one store, and a tab only learns who is signed in when it
// reads the account. Three things keep one account's pages from being filed
// under, or shown to, another:
//
// 1. The store names its owner. Every read and write checks that name first,
//    so a tab that still believes in the previous account saves nothing and
//    reads nothing until it has identified the account again.
// 2. The store carries a revision that changes at every sign-out and every
//    change of owner. An account answer can arrive late, so it may name the
//    owner only if the revision is the one its request started under;
//    otherwise it is believed only if it agrees with the owner already named.
//    A tab also remembers the revision it identified its account under, and
//    counts as identified only while the store still shows that revision:
//    the same name appearing again after someone else was signed in between
//    is a different session, and what this tab asked for before it is not
//    saved for it.
// 3. Every change to the store (naming the owner, signing out, saving a copy)
//    runs under one lock shared by all tabs, so the check and the change that
//    depends on it are not separated by another tab's change.
//
// The browser's storage is shared by every tab, and only that lock makes it
// safe to change. Where the browser does not offer one (the Web Locks API is
// missing on a panel served over plain HTTP on anything but localhost), nothing
// is kept in it at all: pages there simply start from the panel. The desktop
// app keeps its copies with its host and has a single page, so it needs none.
//
// Even with the lock, a tab can briefly see storage a moment older than
// another tab's last write. So those three keep misfiling rare; what makes it
// harmless is a fourth rule that does not depend on timing:
//
// 4. A copy filed under an account can be read only by a tab that has
//    identified that account, and every way the app can see a session end
//    (sign-out, a refused request, a signed-out start) removes every copy. A
//    copy that was misfiled during one account's session is therefore removed
//    before the account it was filed under can sign in and read it.
//
// What none of this can see is a session replaced outside the app, with no
// sign-out, in a tab that is closed before its next session check. The app
// has no way to notice that swap either, and shows such a tab the new
// account's data in the old account's page until that check.
const prefix = 'voltra.snapshot.v1.';
const ownerKey = 'voltra.snapshot-owner';
export const snapshotRevisionKey = 'voltra.snapshot-session';
const lockName = 'voltra.snapshot-store';
const lockPatience = 2000;
const limit = 512 * 1024;
const maxAge = 7 * 24 * 60 * 60 * 1000;

export type SnapshotStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
/** The part of the Web Locks API used here. */
export type SnapshotLocks = {request(name: string, callback: () => unknown): Promise<unknown>};

let account = '';
// The store's revision when this tab identified `account`.
let identifiedUnder: string | null = null;
// Changes whenever the account this tab saves for, or the revision it was
// identified under, changes or is lost. A request notes it when it starts.
let generation = 0;
// null: the browser's own storage. The desktop app supplies its host's store.
let chosen: SnapshotStore | undefined | null = null;
// null: the browser's own lock manager.
let chosenLocks: SnapshotLocks | undefined | null = null;

/** Replaces the browser's storage. `undefined` keeps nothing at all; `null` returns to the browser's. */
export function setSnapshotStore(store: SnapshotStore | undefined | null) {
  chosen = store;
}

/** Replaces the browser's lock manager. `undefined` is a browser without one. */
export function setSnapshotLocks(locks: SnapshotLocks | undefined | null) {
  chosenLocks = locks;
}

/**
 * Whether the saved pages live in storage that other tabs share. The desktop
 * app's host-backed store is this page's alone, so nothing can change it
 * between the page starting its first reads and reading the account.
 */
export function snapshotStoreIsShared(): boolean {
  return chosen === null;
}

function sharedLocks(): SnapshotLocks | undefined {
  try {
    return chosenLocks !== null ? chosenLocks : (globalThis.navigator as {locks?: SnapshotLocks} | undefined)?.locks;
  } catch {
    return undefined;
  }
}

function local(): SnapshotStore | undefined {
  if (chosen !== null) return chosen;
  // Shared storage is used only where its changes can be serialized.
  if (!sharedLocks()) return undefined;
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Runs a change to the store while no other tab is changing it. Without a
 * lock the change runs at once: that is the desktop app's own store, which no
 * other page shares. A browser that refuses the lock changes nothing.
 */
function exclusively(change: () => void): Promise<void> {
  const locks = sharedLocks();
  if (!locks) {
    change();
    return Promise.resolve();
  }
  // The lock is only ever held for the length of one of these changes, so a
  // turn comes at once. Should the browser withhold it all the same, the
  // caller is not kept waiting: the change then happens whenever it is granted.
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>(resolve => { giveUp = setTimeout(resolve, lockPatience); });
  if (typeof giveUp === 'object') giveUp.unref?.();
  const turn = locks.request(lockName, change).then(() => undefined, () => undefined);
  return Promise.race([turn, waited]).finally(() => clearTimeout(giveUp));
}

function forget() {
  if (account) generation++;
  account = '';
  identifiedUnder = null;
}

/** Names this tab's account and the revision it was identified under. */
function believe(next: string, under: string | null) {
  if (next !== account || under !== identifiedUnder) generation++;
  account = next;
  identifiedUnder = next ? under : null;
}

/**
 * Whether the store still belongs to the account this tab identified, in the
 * session it identified it in: the same owner, under the same revision.
 */
function owned(storage: SnapshotStore | undefined): storage is SnapshotStore {
  if (!account || !identifiedUnder || !storage) return false;
  try {
    if (storage.getItem(ownerKey) === account && storage.getItem(snapshotRevisionKey) === identifiedUnder) return true;
  } catch {
    // A store that cannot be read cannot be trusted.
  }
  forget();
  return false;
}

function fresh(raw: string | null, now: number): {value: unknown} | undefined {
  if (!raw) return undefined;
  const saved = JSON.parse(raw) as {at?: unknown; value?: unknown} | null;
  return typeof saved?.at === 'number' && now >= saved.at && now - saved.at < maxAge ? {value: saved.value} : undefined;
}

/** Removes saved copies: all of them, or all but the fresh ones of `keep`. */
function removeCopies(storage: SnapshotStore, keep: string, now: number) {
  const stale: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    let fine = false;
    try {
      fine = !!keep && key.endsWith(`.${keep}`) && !!fresh(storage.getItem(key), now);
    } catch {
      // A damaged copy is removed with the rest.
    }
    if (!fine) stale.push(key);
  }
  for (const key of stale) storage.removeItem(key);
}

/** The store's revision now. Take it when an account read starts and give it to identifySnapshotAccount with the answer. */
export function snapshotRevision(storage: SnapshotStore | undefined = local()): string | null | undefined {
  try {
    return storage ? storage.getItem(snapshotRevisionKey) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The store's revision as of this call's turn among the changes already
 * waiting. An account read that begins right after a sign-out must start from
 * the revision that sign-out leaves behind, not the one it is about to replace.
 */
export function snapshotRevisionInTurn(storage: SnapshotStore | undefined = local()): Promise<string | null | undefined> {
  let revision: string | null | undefined;
  return exclusively(() => { revision = snapshotRevision(storage); }).then(() => revision);
}

/**
 * Names the signed-in account. Copies kept for any other account are removed,
 * and so are this account's copies once they are too old to be used.
 *
 * This is the change itself, made at once. The app reaches it only through
 * identifySnapshotAccount and clearAccountSnapshots, which hold the lock.
 */
export function setSnapshotAccount(next: string, storage: SnapshotStore | undefined = local(), now = Date.now()) {
  let under: string | null = null;
  try {
    if (storage) {
      // A sign-out, and any change of owner, starts a new revision. So does a
      // store that has none yet.
      if (!next || storage.getItem(ownerKey) !== next || !storage.getItem(snapshotRevisionKey)) storage.setItem(snapshotRevisionKey, `${now.toString(36)}-${Math.random().toString(36).slice(2)}`);
      if (next) storage.setItem(ownerKey, next);
      else storage.removeItem(ownerKey);
      removeCopies(storage, next, now);
      under = storage.getItem(snapshotRevisionKey);
    }
  } catch {
    // A store that cannot name its owner is never read or written.
    under = null;
  }
  believe(next, under);
}

function identify(next: string, started: string | null | undefined, storage: SnapshotStore | undefined, now: number): boolean {
  if (started !== undefined && snapshotRevision(storage) === started) {
    setSnapshotAccount(next, storage, now);
    return true;
  }
  // The store moved on. The answer is still right if the store names the same account.
  let owner: string | null = null;
  try {
    owner = storage ? storage.getItem(ownerKey) : null;
  } catch {
    // A store that cannot be read names no one.
  }
  if (owner === next) {
    believe(next, snapshotRevision(storage) ?? null);
    return true;
  }
  if (account) owned(storage);
  return false;
}

/**
 * Names the account an account read identified, unless a sign-out or another
 * account arrived while that read was on its way. `started` is the revision
 * taken when the read began. Resolves to whether this tab now saves for `next`.
 */
export async function identifySnapshotAccount(next: string, started: string | null | undefined, storage: SnapshotStore | undefined = local(), now = Date.now()): Promise<boolean> {
  if (!next) return false;
  let identified = false;
  await exclusively(() => { identified = identify(next, started, storage, now); });
  return identified;
}

/**
 * Ends the account's saved copies. The copies themselves are removed at once,
 * so nothing is left behind even if the page is about to be closed; the store
 * then stops naming its owner under the lock.
 */
export function clearAccountSnapshots(storage: SnapshotStore | undefined = local()) {
  forget();
  try {
    if (storage) removeCopies(storage, '', 0);
  } catch {
    // The locked change below removes them again.
  }
  void exclusively(() => setSnapshotAccount('', storage));
}

/**
 * This tab's account is no longer who is signed in, though nobody signed out
 * here. The tab stops saving at once. The store is emptied only if it still
 * names that account: if another tab has already identified the next one, the
 * store is theirs.
 */
export function releaseSnapshotAccount(storage: SnapshotStore | undefined = local()) {
  const previous = account;
  forget();
  if (!previous) return;
  void exclusively(() => {
    try {
      if (storage?.getItem(ownerKey) === previous) setSnapshotAccount('', storage);
    } catch {
      // A store that cannot be read is cleared at the next sign-out.
    }
  });
}

/**
 * Identifies the account, and the session, a request is being made for. Pass it to
 * writeAccountSnapshot with the answer, so an answer that arrives after the
 * account changed is not saved for the next one.
 */
export function snapshotOwner(): number | undefined {
  return account ? generation : undefined;
}

/**
 * Reads a copy. A copy that is too old or damaged is simply not used: reading
 * happens outside the lock, so it removes nothing, and such copies are cleared
 * the next time the account is identified.
 */
export function readAccountSnapshot<T>(name: string, storage: SnapshotStore | undefined = local(), now = Date.now()): T | undefined {
  if (!owned(storage)) return undefined;
  try {
    return fresh(storage.getItem(`${prefix}${name}.${account}`), now)?.value as T | undefined;
  } catch {
    // Blocked or damaged storage only loses the head start.
    return undefined;
  }
}

/**
 * Takes in copies that were kept elsewhere and are handed over after this tab
 * has identified its account: the desktop host does that when a launch began
 * before it had heard from the panel. Only what naming the account would have
 * left in place joins the store: usable copies filed under that account. A
 * copy the store already holds is newer and stays. Resolves to whether the
 * store was this tab's account's to add to; if not, nothing was taken.
 */
export async function adoptAccountSnapshots(entries: Record<string, string>, storage: SnapshotStore | undefined = local(), now = Date.now()): Promise<boolean> {
  let adopted = false;
  await exclusively(() => {
    if (!owned(storage)) return;
    for (const [key, text] of Object.entries(entries)) {
      if (!key.startsWith(prefix) || !key.endsWith(`.${account}`)) continue;
      try {
        if (storage.getItem(key) === null && fresh(text, now)) storage.setItem(key, text);
      } catch {
        // A damaged copy, or one the store cannot take, is left behind.
      }
    }
    adopted = true;
  });
  return adopted;
}

/** A saved list of records, or nothing unless every record has the named text fields. */
export function readSavedList<T extends object>(name: string, fields: string[], storage: SnapshotStore | undefined = local(), now = Date.now()): T[] | undefined {
  const saved = readAccountSnapshot<unknown>(name, storage, now);
  if (!Array.isArray(saved)) return undefined;
  const valid = saved.every(record => record && typeof record === 'object' && fields.every(field => typeof (record as Record<string, unknown>)[field] === 'string'));
  return valid ? saved as T[] : undefined;
}

/**
 * Saves a copy for the account `owner` identified, if that is still the
 * signed-in account. `owner` is what snapshotOwner() returned when the request
 * for `value` began, and it is never guessed: a request that began while
 * nobody was identified saves nothing, whoever is signed in when it ends.
 */
export function writeAccountSnapshot(name: string, value: unknown, owner: number | undefined, storage: SnapshotStore | undefined = local(), now = Date.now()) {
  if (owner === undefined) return;
  void exclusively(() => {
    // Checked here, under the lock: the owner cannot change between this and the save.
    if (owner !== generation || !owned(storage)) return;
    const key = `${prefix}${name}.${account}`;
    try {
      const text = JSON.stringify({at: now, value});
      if (text.length > limit) storage.removeItem(key);
      else storage.setItem(key, text);
    } catch {
      // A full or blocked store only loses the head start.
    }
  });
}

if (typeof window !== 'undefined') {
  // Another tab changed who the store belongs to. Checking on the event keeps
  // this tab from drawing a copy it read a moment ago; every read and write
  // makes the same check anyway.
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === ownerKey || event.key === snapshotRevisionKey) owned(local());
  });
}
