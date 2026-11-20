import {useSyncExternalStore} from 'react';
// Display only; signed versions and updater requests retain their original values.
export function formatDesktopVersion(version: string) {
  return version.replace(/^v(?=\d)/, '').replace(/-nightly\.(?=\d{8}\.)/, '-');
}
export const updateChannels = [
  {value: 'release', label: 'Release'},
  {value: 'nightly', label: 'Nightly'},
] as const;
export type UpdateChannel = (typeof updateChannels)[number]['value'];
export type UpdateStatus = {
  channel: UpdateChannel;
  state: string;
  version: string;
  available_version?: string;
  error?: string;
};
type UpdateProgress = {
  stage: 'downloading' | 'preparing';
  written: number;
  total: number;
};
type Snapshot = {
  progress: UpdateProgress | null;
  status: UpdateStatus | null;
  busy: boolean;
  operation: string | null;
  error: string;
  checkedAt: number | null;
};
let snapshot: Snapshot = {status: null, progress: null, busy: false, operation: null, error: '', checkedAt: null};
const listeners = new Set<() => void>();
const publish = (value: Partial<Snapshot>) => {
  snapshot = {...snapshot, ...value};
  listeners.forEach(listener => listener());
};
export function useDesktopUpdates() {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => snapshot,
    () => snapshot
  );
}
export async function updateAction(path: string, body: unknown = {}, automatic = false) {
  if (snapshot.busy) return false;
  if (
    automatic &&
    (snapshot.status?.state === 'ready' ||
      snapshot.status?.state === 'available' ||
      (snapshot.checkedAt !== null && Date.now() - snapshot.checkedAt < 60 * 60 * 1000))
  )
    return false;
  publish({busy: true, operation: path, error: '', progress: null});
  const tracker = path === 'update-install' ? trackUpdateDownload() : undefined;
  let succeeded = false;
  try {
    const response = await fetch(`/desktop/${path}`, {
      method: path === 'update-status' ? 'GET' : 'POST',
      headers: {'Content-Type': 'application/json'},
      body: path === 'update-status' ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) {
      if (data.state) publish({status: data});
      throw new Error(data.error || 'Update request failed.');
    }
    publish({
      status: data,
      ...(path === 'updates' ? {checkedAt: Date.now()} : {}),
      ...(path === 'update-channel' ? {checkedAt: null} : {}),
    });
    succeeded = true;
    return true;
  } catch (error) {
    publish({error: (error as Error).message, ...(path === 'updates' ? {checkedAt: Date.now()} : {})});
    return false;
  } finally {
    tracker?.();
    // A failed download keeps its last sample on screen; the next attempt clears it.
    publish({busy: false, operation: null, ...(succeeded ? {progress: null} : {})});
  }
}
function trackUpdateDownload() {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const poll = async () => {
    try {
      const response = await fetch('/desktop/update-progress', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response.ok) {
        const progress: UpdateProgress | null = await response.json();
        if (progress && !controller.signal.aborted) publish({progress});
      }
    } catch {
      // The install response owns errors. A missing progress sample is indeterminate.
    } finally {
      if (!controller.signal.aborted) timer = setTimeout(poll, 500);
    }
  };
  timer = setTimeout(poll, 500);
  return () => {
    clearTimeout(timer);
    controller.abort();
  };
}

export function startUpdateChecks() {
  let active = true;
  const initial = window.setTimeout(() => {
    void updateAction('update-status').then(() => {
      if (active) void updateAction('updates', {}, true);
    });
  }, 250);
  const check = () => {
    if (document.visibilityState === 'visible') void updateAction('updates', {}, true);
  };
  const interval = window.setInterval(check, 60 * 60 * 1000);
  window.addEventListener('focus', check);
  return () => {
    active = false;
    clearTimeout(initial);
    clearInterval(interval);
    window.removeEventListener('focus', check);
  };
}
