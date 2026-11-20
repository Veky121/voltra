import {Feedback} from '../../notifications';
import {useEffect, useState, type ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {Button} from '../../lib';
import {TerminalProgress, TerminalSpinner} from '../../ui/TerminalProgress';
import {formatBytesProgress} from '../../ui/terminalProgressModel';
import {can, useServer} from '../shared/common';
import {RemoteTransferContext, useRemoteTransferQueue} from './useRemoteTransfers';
import {
  transferActive,
  transferFilesAvailable,
  transferCompletionWindow,
  transferRecentlyActive,
  transferRecentlyCompleted,
  transferProgress,
  type RemoteTransfer,
} from './remoteTransferModel';
import {OperationReports} from './OperationStatus';
import {operationMessages, operationPending, operationRecentlyActive} from './operationEvents';
import './serverTransfers.css';

const noChange = () => {};
export function ServerTransfers({
  base,
  permissions,
  children,
}: {
  base: string;
  permissions: string[];
  children: ReactNode;
}) {
  const {server} = useServer();
  const queue = useRemoteTransferQueue(base, permissions, noChange, transferFilesAvailable(server));
  return (
    <RemoteTransferContext.Provider value={queue}>
      {children}
      {(can(permissions, 'file.read') || can(permissions, 'file.create') || can(permissions, 'websocket.connect')) && (
        <>
          <TransferFeedback base={base} queue={queue} />
          <TransferDock key={`${base}:${permissions.join(',')}`} base={base} queue={queue} />
        </>
      )}
    </RemoteTransferContext.Provider>
  );
}

function TransferFeedback({base, queue}: {base: string; queue: ReturnType<typeof useRemoteTransferQueue>}) {
  return (
    <>
      <Feedback
        tone="error"
        eventKey={`transfer-refresh:${base}`}
        message={queue.error ? 'Progress could not be refreshed. The displayed values may be out of date.' : ''}
      />
      {queue.transfers.map(entry => (
        <Feedback
          key={entry.identifier}
          tone="error"
          eventKey={`file-transfer:${entry.identifier}`}
          title={entry.kind === 'upload' ? 'Upload failed' : 'Download failed'}
          message={
            entry.state === 'failed'
              ? entry.error ||
                'The node could not complete this transfer. Check available disk space, then retry from Files.'
              : ''
          }
        />
      ))}
      {queue.operations.map(entry => {
        const info = operationMessages[entry.code];
        return (
          <Feedback
            key={entry.id}
            tone="error"
            eventKey={`game-operation:${entry.id}`}
            title={info.message}
            message={entry.state === 'failed' ? info.recovery || 'Check the server console before retrying.' : ''}
          />
        );
      })}
    </>
  );
}

function TransferDock({base, queue}: {base: string; queue: ReturnType<typeof useRemoteTransferQueue>}) {
  const [expanded, setExpanded] = useState(false),
    [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (!queue.operations.some(operationPending) && !queue.transfers.some(transferActive)) return;
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [queue.operations, queue.transfers]);
  const now = Math.max(clock, Date.now());
  const completed = queue.transfers.filter(entry => transferRecentlyCompleted(entry, now));
  const nextExpiry = completed.reduce(
    (time, entry) => Math.min(time, entry.updated + transferCompletionWindow),
    Infinity
  );
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(() => setClock(Math.max(nextExpiry, Date.now())), Math.max(0, nextExpiry - Date.now()));
    return () => clearTimeout(timer);
  }, [nextExpiry]);
  const visible = queue.transfers.filter(
    entry =>
      transferActive(entry) ||
      (!dismissed.has(entry.identifier) && (entry.state === 'failed' || transferRecentlyCompleted(entry, now)))
  );
  const operations = queue.operations.filter(
    entry =>
      operationPending(entry) ||
      ((entry.state === 'failed' || entry.restart_required) && !dismissed.has(`operation:${entry.id}`))
  );
  const active =
    visible.filter(entry => transferRecentlyActive(entry, now)).length +
    operations.filter(entry => operationRecentlyActive(entry, now)).length;
  const count = visible.length + operations.length;
  const completeCount = visible.filter(entry => entry.state === 'complete').length;
  const failedCount =
    visible.filter(entry => entry.state === 'failed').length +
    operations.filter(entry => entry.state === 'failed').length;
  const pendingCount = count - active - completeCount - failedCount;
  const summary = [
    active && `${active} active`,
    failedCount && `${failedCount} failed`,
    pendingCount && `${pendingCount} pending`,
    completeCount && `${completeCount} complete`,
  ]
    .filter(Boolean)
    .join(' ? ');
  useEffect(() => {
    if (active) setExpanded(true);
  }, [active]);
  if (!count && !queue.error) return null;
  const filesPath = `/server/${encodeURIComponent(base.split('/').pop() || '')}/files`;
  return (
    <section className="server-transfer-dock" aria-label="Server transfers">
      <div className="server-transfer-heading">
        <Button
          variant="secondary"
          aria-expanded={expanded}
          aria-controls="server-transfer-list"
          onClick={() => setExpanded(value => !value)}
        >
          {active > 0 && <TerminalSpinner />}
          Transfers <span>{summary || 'Progress unavailable'}</span>
          <span>{expanded ? 'Hide' : 'Show'}</span>
        </Button>
        {(visible.some(entry => !transferActive(entry)) || operations.some(entry => !operationPending(entry))) && (
          <Button
            variant="secondary"
            onClick={() =>
              setDismissed(
                current =>
                  new Set([
                    ...current,
                    ...visible.filter(entry => !transferActive(entry)).map(entry => entry.identifier),
                    ...operations.filter(entry => !operationPending(entry)).map(entry => `operation:${entry.id}`),
                  ])
              )
            }
          >
            Dismiss
          </Button>
        )}
      </div>
      {expanded && (
        <div id="server-transfer-list" className="server-transfer-list">
          <p className="server-transfer-help">
            Transfers and reported game tasks for this server, including other users. Server downloads continue when you
            change pages.
          </p>
          {queue.error && (
            <Button variant="secondary" onClick={() => void queue.reload()}>
              Check again
            </Button>
          )}
          {visible.map(entry => (
            <TransferRow
              key={entry.identifier}
              entry={entry}
              clock={now}
              filesPath={filesPath}
              dismiss={() => setDismissed(current => new Set([...current, entry.identifier]))}
            />
          ))}
          <OperationReports
            events={operations}
            onDismiss={id => setDismissed(current => new Set([...current, `operation:${id}`]))}
          />
        </div>
      )}
    </section>
  );
}

function TransferRow({
  entry,
  clock,
  filesPath,
  dismiss,
}: {
  entry: RemoteTransfer;
  clock: number;
  filesPath: string;
  dismiss: () => void;
}) {
  const percent = transferProgress(entry),
    active = transferActive(entry),
    recent = transferRecentlyActive(entry, clock);
  const labels = {
    queued: 'Queued',
    downloading: 'Downloading',
    uploading: 'Uploading',
    awaiting_save: 'Awaiting save',
    saving: 'Saving to server',
    extracting: 'Extracting',
    complete: 'Saved to server',
    failed: entry.kind === 'upload' ? 'Upload failed' : 'Download failed',
  };
  const total = entry.size_known ? entry.total_bytes : undefined;
  const detail = formatBytesProgress(entry.received_bytes, total);
  const state = entry.state === 'failed' ? 'failed' : !active ? 'done' : recent ? 'running' : 'waiting';
  return (
    <article className={`server-transfer-row is-${entry.state}`}>
      <div className="server-transfer-title">
        <strong>{entry.name}</strong>
      </div>
      <div className="server-transfer-meta">
        <span>To {entry.directory}</span>
        {(total === undefined || !Number.isFinite(total) || total < 0) && active && <span>Total size unavailable</span>}
      </div>
      <TerminalProgress
        label={active && !recent ? 'No recent update' : labels[entry.state]}
        ariaLabel={`${labels[entry.state]} ${entry.name}`}
        value={entry.state === 'queued' ? null : percent}
        detail={detail}
        state={state}
        width={18}
      />
      {active && !recent && <small>Upload paused or disconnected. Resume it from Files.</small>}
      {entry.state === 'queued' && <small>Waiting for the node to begin the download.</small>}
      {entry.state === 'awaiting_save' && (
        <small>All bytes received. Waiting for the uploader to finish saving the file.</small>
      )}
      {!active && (
        <div className="server-transfer-actions">
          <Link to={`${filesPath}?directory=${encodeURIComponent(entry.directory)}`}>
            {entry.state === 'failed' ? 'Open Files to retry' : 'Open folder'}
          </Link>
          <Button variant="secondary" onClick={dismiss}>
            Dismiss
          </Button>
        </div>
      )}
    </article>
  );
}
