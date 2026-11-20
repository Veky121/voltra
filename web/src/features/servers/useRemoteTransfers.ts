import {createContext, useContext, useEffect, useRef, useState} from 'react';
import {
  mergeTransfers,
  reconcileTransfers,
  transferPollDelay,
  transferReadRestricted,
  type RemoteTransfer,
} from './remoteTransferModel';
export type {RemoteTransfer} from './remoteTransferModel';
import {api} from '../../lib';
import {can} from '../shared/common';
import {acquireServerSocket} from './serverSocket';
import {onFocusRevalidate, answeredRecently} from '../../hooks/focusRevalidation';
import {mergeOperationEvent, operationEventsFromMessage, type OperationEvent} from './operationEvents';

type TransferList = {transfers?: RemoteTransfer[]};
export type RemoteOptions = {url: string; directory: string; filename?: string; use_header?: boolean};
export const RemoteTransferContext = createContext<ReturnType<typeof useRemoteTransferQueue> | null>(null);

export function useRemoteTransferQueue(
  base: string,
  permissions: string[],
  onComplete: () => void,
  filesAvailable = true
) {
  const [records, setRecords] = useState<Record<string, RemoteTransfer>>({}),
    [error, setError] = useState('');
  const [operations, setOperations] = useState<OperationEvent[]>([]);
  const current = useRef({onComplete, filesAvailable});
  current.current = {onComplete, filesAvailable};
  const known = useRef<Record<string, RemoteTransfer>>({});
  const generation = useRef(0);
  const loadRef = useRef<() => Promise<void>>(async () => {});
  const updateFileAccess = useRef<(available: boolean) => void>(() => {});
  const mergeRef = useRef<(entries: RemoteTransfer[]) => void>(() => {});
  useEffect(() => {
    generation.current++;
    let active = true,
      socketReady = false,
      lastSnapshot = 0;
    let pending: AbortController | undefined;
    known.current = {};
    setRecords({});
    setOperations([]);
    setError('');
    const canFiles = can(permissions, 'file.read') || can(permissions, 'file.create');
    const canConsole = can(permissions, 'websocket.connect');

    const merge = (
      entries: RemoteTransfer[],
      kind?: 'upload' | 'download',
      started?: Record<string, RemoteTransfer>
    ) => {
      if (!active) return;
      const next =
        kind && started
          ? reconcileTransfers(known.current, entries, kind, started)
          : mergeTransfers(known.current, entries);
      const completed = entries.some(
        entry => entry.state === 'complete' && known.current[entry.identifier]?.state !== 'complete'
      );

      known.current = next;
      setRecords(next);
      if (completed) current.current.onComplete();
    };
    mergeRef.current = merge;
    const load = async () => {
      if (pending || !active || !canFiles || !current.current.filesAvailable) return;
      const controller = new AbortController();
      pending = controller;
      const {signal} = controller;
      lastSnapshot = Date.now();
      const started = known.current;
      try {
        const results = await Promise.allSettled([
          api<TransferList>(`${base}/files/pulls`, {signal}),
          api<TransferList>(`${base}/files/transfer-progress`, {signal}),
        ]);
        if (active && !signal.aborted && current.current.filesAvailable) {
          const failures: string[] = [];
          for (const [index, result] of results.entries()) {
            if (result.status === 'fulfilled') {
              const entries = result.value.transfers || [];
              merge(entries, index === 0 ? 'download' : 'upload', started);
            } else if (!transferReadRestricted(result.reason)) {
              failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
            }
          }
          setError(failures.join(' '));
        }
      } catch (e) {
        if (active && !signal.aborted && current.current.filesAvailable && !transferReadRestricted(e))
          setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (pending === controller) pending = undefined;
      }
    };
    loadRef.current = load;
    updateFileAccess.current = available => {
      if (available) void load();
      else {
        pending?.abort();
        pending = undefined;
        setError('');
      }
    };
    if (!canFiles && !canConsole)
      return () => {
        active = false;
      };
    // The page's shared Wings socket, also used by the console.
    const held = canConsole ? acquireServerSocket(base) : undefined;
    const unsubscribe = held?.socket.subscribe({
      message: m => {
        if (!active) return;
        try {
          if (canFiles && m.event === 'download progress') merge([JSON.parse(m.args[0])]);
          const reports = operationEventsFromMessage(m);
          if (reports.length)
            setOperations(previous => (active ? reports.reduce(mergeOperationEvent, previous) : previous));
        } catch {
          /* Ignore unrelated or malformed events. */
        }
      },
      // Recent output recovers operation reports that were sent before this page opened.
      ready: () => {
        if (!active) return;
        socketReady = true;
        void load();
        held?.socket.requestLogs('recovery');
      },
      closed: () => {
        socketReady = false;
      },
    });
    void load();
    // Reconcile missed terminal events and support users without socket permission.
    const timer = canFiles
      ? setInterval(() => {
          if (globalThis.document?.hidden) return;
          if (Date.now() - lastSnapshot >= transferPollDelay(Object.values(known.current), socketReady)) void load();
        }, 5000)
      : undefined;
    const stopFocus = canFiles
      ? onFocusRevalidate(
          () => answeredRecently(lastSnapshot),
          () => void load()
        )
      : undefined;
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      generation.current++;
      active = false;
      pending?.abort();
      clearInterval(timer);
      stopFocus?.();
      unsubscribe?.();
      held?.release();
    };
    const reset = () => {
      stop();
      known.current = {};
      setRecords({});
      setOperations([]);
      setError('');
    };
    window.addEventListener('panel-auth-changed', reset);
    window.addEventListener('desktop-session-rejected', reset);
    return () => {
      stop();
      window.removeEventListener('panel-auth-changed', reset);
      window.removeEventListener('desktop-session-rejected', reset);
    };
  }, [base, permissions.join(',')]);
  useEffect(() => {
    updateFileAccess.current(filesAvailable);
  }, [filesAvailable]);
  async function start(options: RemoteOptions) {
    const currentGeneration = generation.current;
    const result = await api<{identifier?: string} | undefined>(`${base}/files/pull`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({...options, foreground: false, tracked: true}),
    });
    if (currentGeneration !== generation.current) return;
    if (!result?.identifier) throw new Error('The node did not return a download identifier.');
    if (!known.current[result.identifier])
      mergeRef.current([
        {
          identifier: result.identifier,
          directory: options.directory,
          name: options.filename || new URL(options.url).pathname.split('/').pop() || 'Download',
          state: 'queued',
          progress: 0,
          updated: 0,
        },
      ]);
    void loadRef.current();
  }
  const canFilesNow = can(permissions, 'file.read') || can(permissions, 'file.create');
  return {
    transfers: canFilesNow ? Object.values(records).sort((a, b) => a.updated - b.updated) : [],
    operations: can(permissions, 'websocket.connect') ? operations : [],
    error: canFilesNow && filesAvailable ? error : '',
    start,
    reload: () => loadRef.current(),
  };
}

export default function useRemoteTransfers(_base: string, _permissions: string[], onComplete: () => void) {
  const shared = useContext(RemoteTransferContext);
  const callback = useRef(onComplete);
  callback.current = onComplete;
  const previous = useRef(new Set<string>());
  useEffect(() => {
    const completed = new Set(
      shared?.transfers.filter(entry => entry.state === 'complete').map(entry => entry.identifier) || []
    );
    if ([...completed].some(id => !previous.current.has(id))) callback.current();
    previous.current = completed;
  }, [shared?.transfers]);
  if (!shared) throw new Error('Remote transfers require the server transfer provider.');
  return shared;
}
