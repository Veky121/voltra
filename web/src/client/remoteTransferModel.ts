export type RemoteTransfer = {
  identifier: string; kind?: 'upload' | 'download'; directory: string; name: string;
  state: 'queued' | 'downloading' | 'uploading' | 'awaiting_save' | 'saving' | 'extracting' | 'complete' | 'failed';
  progress?: number; received_bytes?: number; total_bytes?: number; size_known?: boolean;
  error?: string; updated: number;
};

export const transferActive = (entry: RemoteTransfer) => !['complete', 'failed'].includes(entry.state);

// Pending is resumable state; recent activity alone may animate the dock.
export const transferRecentlyActive = (entry: RemoteTransfer, now = Date.now()) => transferActive(entry) && (entry.kind !== 'upload' || (entry.updated <= now + 5000 && now - entry.updated < 30000));
export const transferPollDelay = (entries: RemoteTransfer[], socketReady: boolean, now = Date.now()) => entries.some(entry => transferRecentlyActive(entry, now) && (entry.kind === 'upload' || !socketReady)) ? 5000 : 30000;

export function transferProgress(entry: RemoteTransfer): number | null {
  if (entry.state === 'complete') return 100;
  if (!['downloading', 'uploading'].includes(entry.state)) return null;
  // Old nodes report a fraction without proving the size. Do not turn it into a percentage.
  if (entry.size_known !== true || !Number.isFinite(entry.total_bytes) || entry.total_bytes! <= 0 || !Number.isFinite(entry.received_bytes)) return null;
  return Math.max(0, Math.min(100, entry.received_bytes! / entry.total_bytes! * 100));
}

export function mergeTransfers(current: Record<string, RemoteTransfer>, entries: RemoteTransfer[]) {
  const next = {...current};
  for (const entry of entries) {
    if (!entry.identifier || !Number.isFinite(entry.updated) || entry.updated < (next[entry.identifier]?.updated || 0)) continue;
    if (next[entry.identifier] && !transferActive(next[entry.identifier]) && transferActive(entry)) continue;
    next[entry.identifier] = entry;
  }
  return next;
}

export function reconcileTransfers(current: Record<string, RemoteTransfer>, entries: RemoteTransfer[], kind: 'upload' | 'download', started: Record<string, RemoteTransfer>) {
  const next={...current},present=new Set(entries.map(entry=>entry.identifier));
  for(const [id,entry] of Object.entries(next)) {
    const entryKind=entry.kind==='upload'||id.startsWith('upload-')?'upload':'download';
    // A socket update or newly queued job after the request began wins over an older snapshot.
    if(entryKind===kind&&!present.has(id)&&started[id]===entry)delete next[id];
  }
  return mergeTransfers(next,entries);
}
