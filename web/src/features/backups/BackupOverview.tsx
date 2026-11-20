import {Button, useAPI} from '../../lib';
import type {ResourceList, Schedule} from '../../types/api';
import {can, date, items, useServer} from '../shared/common';
import {backupProtection} from '../servers/serverProtection';
import {backupStorage} from '../servers/serverStorage';
import {formatBytesGB} from '../../resourceUnits';
import {formatDateTime, parseDateTime} from '../../format';

export function backupDisplayName(name: string) {
  return /^Scheduled backup \d+ at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(name)
    ? 'Scheduled backup'
    : name;
}

export function backupOriginLabel(origin?: {type?: string; created_by?: string; schedule_name?: string}) {
  if (origin?.type === 'manual') return origin.created_by ? `Manual by ${origin.created_by}` : 'Manual';
  if (origin?.type === 'scheduled') return origin.schedule_name ? `Scheduled: ${origin.schedule_name}` : 'Scheduled';
  return 'Unknown origin';
}

export function backupCreated(value: string) {
  if (!parseDateTime(value)) return {time: 'Unknown time', date: 'Unknown date'};
  return {time: formatDateTime(value, {style: 'time'}), date: formatDateTime(value, {style: 'date'})};
}

export function BackupOverview({response, error}: {response: any; error: string}) {
  const {base, server, permissions} = useServer();
  const readable = can(permissions, 'schedule.read');
  const schedules = useAPI<ResourceList<Schedule>>(readable ? `${base}/schedules?include=tasks` : null);
  const protection = backupProtection(items(schedules.data));
  const storage = !error ? backupStorage(response?.meta?.storage) : null;
  const count = !error ? response?.meta?.backup_count : undefined;
  const limit = server.feature_limits?.backups;
  const full = typeof count === 'number' && typeof limit === 'number' && limit > 0 && count >= limit;
  return (
    <div className="backup-overview">
      <div className="backup-summary">
        <span>
          {typeof count === 'number'
            ? `${count}${typeof limit === 'number' ? ` / ${limit}` : ''} backups`
            : error
              ? 'Usage unavailable'
              : 'Loading usage…'}
        </span>
        {storage && (
          <span>
            {formatBytesGB(storage.total_bytes)}
            {storage.pending_count > 0 || storage.failed_count > 0 ? ' recorded' : ''}
          </span>
        )}
        {readable && (
          <>
            <span>
              {schedules.error
                ? 'Schedule unavailable'
                : !schedules.data
                  ? 'Loading schedule…'
                  : protection.next
                    ? `Next backup: ${date(protection.next)}`
                    : protection.count
                      ? 'Next backup pending'
                      : 'No scheduled backups'}
            </span>
            {!schedules.error && protection.onlineOnly && <span>Only when online</span>}
            {schedules.error && (
              <Button variant="secondary" onClick={schedules.reload}>
                Retry schedules
              </Button>
            )}
          </>
        )}
      </div>
      {limit === 0 && <p className="backup-limit-note">Backups are disabled for this server.</p>}
      {full && (
        <p className="backup-limit-note">
          Backup limit reached. Delete an unlocked backup to create one manually.
          {readable && !schedules.error && protection.count > 0
            ? ' Scheduled backups replace the oldest unlocked backup.'
            : ''}
        </p>
      )}
    </div>
  );
}
