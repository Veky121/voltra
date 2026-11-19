import {clearAccountSnapshots, snapshotRevisionKey} from './accountSnapshots';
import {discardBootReads, rememberSignedIn} from './bootReads';

/**
 * Everything this browser keeps on behalf of the signed-in account ends with
 * the session: the saved pages, the note that lets the next start ask for
 * account reads early, and any early answers still waiting to be used.
 */
let signOuts = 0;
/** How many times this page has seen the session end. Compare before and after a request to learn whether it spans one. */
export const signedOutCount = () => signOuts;

/**
 * Tells other tabs that whoever is signed in has changed. They judge the early
 * answers they hold by this key. It is moved here as well as by the saved
 * pages, which do not exist in a browser that cannot lock: a fresh random
 * value needs no lock to be written.
 */
export function moveSessionRevision() {
  let storage: Storage | undefined;
  try {
    storage = globalThis.localStorage;
    storage?.setItem(snapshotRevisionKey, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  } catch {
    try {
      // A full store can still drop the key, which changes its value just the same.
      storage?.removeItem(snapshotRevisionKey);
    } catch {
      // Without storage there are no other tabs to tell.
    }
  }
}

export function forgetSignedInAccount() {
  signOuts++;
  moveSessionRevision();
  clearAccountSnapshots();
  rememberSignedIn(false);
  discardBootReads();
}

if (typeof window !== 'undefined') {
  // Sign-out, and any request the panel refuses as unauthenticated.
  window.addEventListener('panel-auth-changed', forgetSignedInAccount);
  window.addEventListener('desktop-session-rejected', forgetSignedInAccount);
  // Another tab signed out or in. Early answers this tab is still holding were
  // asked for under the previous session.
  window.addEventListener('storage', event => {
    if (event.key !== null && event.key !== snapshotRevisionKey) return;
    signOuts++;
    discardBootReads();
  });
}
