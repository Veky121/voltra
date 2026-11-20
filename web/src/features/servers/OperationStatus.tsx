import {useEffect, useState} from 'react';
import {TerminalProgress} from '../../ui/TerminalProgress';
import {bytesProgressValue, formatBytesProgress} from '../../ui/terminalProgressModel';
import {Button} from '../../lib';
import {formatDateTime} from '../../format';
import {operationMessages, operationPending, operationRecentlyActive, type OperationEvent} from './operationEvents';
import './operationStatus.css';

export function OperationReports({events, onDismiss}: {events: OperationEvent[]; onDismiss: (id: string) => void}) {
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (!events.some(e => e.state === 'queued' || e.state === 'running')) return;
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [events]);
  if (!events.length) return null;
  return (
    <div className="operation-status-list" aria-label="Reported game operations">
      {events.map(event => {
        const info = operationMessages[event.code],
          active = operationPending(event);
        const stale = active && !operationRecentlyActive(event, Math.max(clock, Date.now()));
        const percent = bytesProgressValue(event.bytes, event.total);
        const detail = formatBytesProgress(event.bytes, event.total);
        const state =
          event.state === 'completed' ? 'done' : event.state === 'failed' ? 'failed' : stale ? 'waiting' : 'running';
        return (
          <div key={event.id} className="operation-status">
            <details>
              <summary>{info.message}</summary>
              <div className="operation-status-details">
                {event.restart_required && <p>Restart required to apply this change.</p>}
                {active && (
                  <p>Last reported {formatDateTime(event.at)}. This report does not confirm that the game is ready.</p>
                )}
                {active && !event.total && event.bytes !== undefined && (
                  <p>The provider has not supplied a total size.</p>
                )}
                <small>
                  Reported by {event.source} · {event.code} · {event.id}
                </small>
                {!active && (
                  <Button variant="secondary" onClick={() => onDismiss(event.id)}>
                    Dismiss
                  </Button>
                )}
              </div>
            </details>
            <TerminalProgress
              label={
                stale
                  ? 'No recent update'
                  : state === 'done'
                    ? 'Completed'
                    : state === 'failed'
                      ? 'Failed'
                      : `Reported ${event.phase}`
              }
              ariaLabel={info.message}
              value={stale ? null : percent}
              state={state}
              detail={detail}
              width={18}
            />
          </div>
        );
      })}
    </div>
  );
}
