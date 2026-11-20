import {useState} from 'react';
import {Toggle} from '../../components/ui/toggle';
import type {ActivityLog} from '../../types/api';
import {
  activityClock,
  activityPropertyEntries,
  activityPropertyLabel,
  activityPropertyText,
  activityTime,
  backupDuration,
  type ActivityItem,
  type BackupRun,
} from './activityModel';

function PropertyValue({name, data, event}: {name: string; data: unknown; event: string}) {
  if (data == null || data === '') return <span className="activity-detail-empty">None</span>;
  if (typeof data === 'boolean') return data ? 'Yes' : 'No';
  if (Array.isArray(data)) {
    return data.length ? (
      <ul className="activity-detail-list">
        {data.map((entry, index) => (
          <li key={index}>
            <PropertyValue name={name} data={entry} event={event} />
          </li>
        ))}
      </ul>
    ) : (
      <span className="activity-detail-empty">None</span>
    );
  }
  if (typeof data === 'object') {
    return <Properties properties={data as Record<string, unknown>} event={event} nested />;
  }
  return activityPropertyText(name, data as string | number);
}

function Properties({
  properties,
  event,
  nested = false,
}: {
  properties: Record<string, unknown>;
  event: string;
  nested?: boolean;
}) {
  const entries = activityPropertyEntries(properties);
  if (!entries.length) return nested ? <span className="activity-detail-empty">None</span> : null;
  return (
    <dl className="activity-detail-fields" data-nested={nested || undefined}>
      {entries.map(([key, data]) => (
        <div key={key}>
          <dt>{activityPropertyLabel(key, event)}</dt>
          <dd>
            <PropertyValue name={key} data={data} event={event} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

const outcomes: Record<BackupRun['outcome'], string> = {
  completed: 'Completed',
  failed: 'Failed',
  started: 'Started, no result yet',
};

/** One line per backup: when it ran, how it ended and how long it took. */
function Runs({runs, now}: {runs: BackupRun[]; now: Date}) {
  return (
    <ol className="activity-detail-runs">
      {runs.map(run => {
        const log = run.end ?? run.start!;
        const duration = backupDuration(run);
        return (
          <li key={run.id} data-outcome={run.outcome}>
            <time dateTime={log.timestamp} title={activityTime(log.timestamp, now).exact}>
              {activityClock(log.timestamp)}
            </time>
            <span>{outcomes[run.outcome]}</span>
            <span>{duration && `${duration}`}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Start and result fields of one backup, once each: the name first and the identifier last. */
function runProperties(run: BackupRun) {
  const {name, backup, ...rest} = {...run.start?.properties, ...run.end?.properties};
  return {name, ...rest, backup};
}

const rawEntry = (log: ActivityLog) => ({event: log.event, timestamp: log.timestamp, properties: log.properties ?? {}});

export function ActivityDetails({item, actor, now}: {item: ActivityItem; actor: string; now: Date}) {
  const [raw, setRaw] = useState(false);
  const {lead, entries, runs} = item;
  const single = entries.length === 1;
  const properties = item.kind === 'event' ? (lead.properties ?? {}) : runs.length === 1 ? runProperties(runs[0]) : {};
  const schedule = item.kind === 'scheduled' ? runs.find(run => run.start)?.start?.properties : undefined;
  const events = Array.from(new Set(entries.map(entry => entry.event)));
  return (
    <div className="activity-details">
      <div className="activity-detail-heading">
        <h3>{raw ? 'Raw record' : 'Details'}</h3>
        <Toggle className="activity-raw-toggle" size="sm" pressed={raw} onPressedChange={setRaw}>
          Raw
        </Toggle>
      </div>
      {raw ? (
        <pre className="activity-detail-raw" tabIndex={0}>
          {JSON.stringify(single ? (lead.properties ?? {}) : entries.map(rawEntry), null, 2)}
        </pre>
      ) : (
        <>
          {item.kind !== 'event' && runs.length === 1 && (
            <dl className="activity-detail-fields">
              {runs[0].start && (
                <div>
                  <dt>Started</dt>
                  <dd>{activityTime(runs[0].start.timestamp, now).exact}</dd>
                </div>
              )}
              {runs[0].end && (
                <div>
                  <dt>{runs[0].outcome === 'failed' ? 'Failed' : 'Completed'}</dt>
                  <dd>{activityTime(runs[0].end.timestamp, now).exact}</dd>
                </div>
              )}
              {backupDuration(runs[0]) && (
                <div>
                  <dt>Duration</dt>
                  <dd>{backupDuration(runs[0])}</dd>
                </div>
              )}
            </dl>
          )}
          <Properties properties={properties} event={lead.event} />
          {runs.length > 1 && (
            <>
              {schedule && (
                <Properties
                  properties={{schedule_name: schedule.schedule_name, schedule_id: schedule.schedule_id}}
                  event={lead.event}
                />
              )}
              <h3>Runs</h3>
              <Runs runs={runs} now={now} />
            </>
          )}
          {item.kind === 'event' && !single && (
            <>
              <h3>{entries.length} times</h3>
              <ol className="activity-detail-times">
                {entries.map(entry => (
                  <li key={entry.id}>
                    <time dateTime={entry.timestamp}>{activityTime(entry.timestamp, now).exact}</time>
                  </li>
                ))}
              </ol>
            </>
          )}
          <h3>Record</h3>
          <dl className="activity-detail-fields">
            <div>
              <dt>By</dt>
              <dd>{actor}</dd>
            </div>
            {lead.ip && (
              <div>
                <dt>IP address</dt>
                <dd>{lead.ip}</dd>
              </div>
            )}
            {lead.is_api && (
              <div>
                <dt>Through</dt>
                <dd>API key</dd>
              </div>
            )}
            <div>
              <dt>{events.length > 1 ? 'Events' : 'Event'}</dt>
              <dd>
                {events.map(event => (
                  <code key={event}>{event}</code>
                ))}
              </dd>
            </div>
          </dl>
        </>
      )}
    </div>
  );
}
