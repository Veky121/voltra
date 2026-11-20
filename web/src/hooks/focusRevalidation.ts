// One focus/visibility listener for every read. A return to the page usually
// fires both `focus` and `visibilitychange`; they collapse into one pass after
// a short delay, and each read decides whether it is still fresh.
export type FocusPass = {
  /** The page was hidden since the previous pass, so live hints may have been missed. */
  hidden: boolean;
};
type Registration = {fresh: (pass: FocusPass) => boolean; revalidate: () => void};

export const FOCUS_DEBOUNCE_MS = 150;
/** A read answered this recently is not fetched again on return. */
export const FOCUS_FRESH_MS = 10000;

const registrations = new Set<Registration>();
let timer: ReturnType<typeof setTimeout> | undefined,
  attached = false,
  wasHidden = false;

const pageHidden = () => typeof document !== 'undefined' && document.hidden;
function run() {
  timer = undefined;
  if (pageHidden()) return;
  const pass = {hidden: wasHidden};
  wasHidden = false;
  for (const registration of [...registrations]) {
    // An earlier revalidation may have unmounted a later reader.
    if (!registrations.has(registration)) continue;
    let fresh: boolean;
    try {
      fresh = registration.fresh(pass);
    } catch {
      fresh = false;
    }
    if (!fresh) registration.revalidate();
  }
}
function changed() {
  if (pageHidden()) {
    wasHidden = true;
    clearTimeout(timer);
    timer = undefined;
    return;
  }
  if (timer === undefined) timer = setTimeout(run, FOCUS_DEBOUNCE_MS);
}
function attach() {
  if (attached || typeof window === 'undefined') return;
  attached = true;
  window.addEventListener('focus', changed);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', changed);
}
function detach() {
  if (!attached) return;
  attached = false;
  clearTimeout(timer);
  timer = undefined;
  wasHidden = false;
  window.removeEventListener('focus', changed);
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', changed);
}

/** Revalidate on return to the page unless `fresh` says the value is still current. */
export function onFocusRevalidate(fresh: (pass: FocusPass) => boolean, revalidate: () => void): () => void {
  const registration = {fresh, revalidate};
  registrations.add(registration);
  attach();
  return () => {
    registrations.delete(registration);
    if (!registrations.size) detach();
  };
}

export function answeredRecently(at: number, now = Date.now()): boolean {
  return at > 0 && now - at < FOCUS_FRESH_MS;
}
