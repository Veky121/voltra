import type {ActivityLog} from '../../types/api';

type TranslateActivity = (key: string, values: Record<string, unknown>, fallback: string) => string;

const fallbackMessages: Record<string, string> = {
  'server:backup.start': 'Started a new backup',
  'server:backup.complete': 'Completed a backup',
  'server:backup.fail': 'A backup failed',
  'server:backup.restore': 'Restored a backup',
  'server:backup.restore-complete': 'Completed a backup restore',
  'server:backup.restore-failed': 'A backup restore failed',
  'server:file.read': 'Viewed a file',
  'server:file.write': 'Edited a file',
  'server:file.rename': 'Renamed or moved files',
  'server:file.delete': 'Deleted files',
  'server:console.command': 'Ran a console command',
  'server:settings.rename': 'Renamed the server',
  'server:settings.description': 'Changed the server description',
};

const hasPlaceholder = /{{[^{}]*}}/;
const isoTimestamp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})/g;

const dayFormat = new Intl.DateTimeFormat(undefined, {weekday: 'short', month: 'short', day: 'numeric'});
const dayYearFormat = new Intl.DateTimeFormat(undefined, {year: 'numeric', month: 'short', day: 'numeric'});
const clockFormat = new Intl.DateTimeFormat(undefined, {hour: 'numeric', minute: '2-digit'});
const stampFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const exactFormat = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'long'});
const relativeFormat = new Intl.RelativeTimeFormat(undefined, {numeric: 'always', style: 'narrow'});
const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

// Go writes nanoseconds; keep the milliseconds every engine parses.
const parseTime = (value: string) => new Date(value.replace(/(\.\d{3})\d+/, '$1'));

/** Replaces machine timestamps inside a name or sentence with a short local time. */
export function tameTimestamps(text: string) {
  return text.replace(isoTimestamp, stamp => {
    const date = parseTime(stamp);
    return Number.isFinite(date.getTime()) ? stampFormat.format(date) : stamp;
  });
}

function interpolate(template: string, properties: Record<string, unknown>) {
  return template.replace(/{{([^{}]+)}}/g, (token, path: string) => {
    const value = path
      .trim()
      .split('.')
      .reduce<unknown>((parent, key) => {
        if (parent && typeof parent === 'object' && Object.hasOwn(parent, key)) {
          return (parent as Record<string, unknown>)[key];
        }
      }, properties);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'string' && value.trim()) return tameTimestamps(value);
    if (Array.isArray(value) && value.length && value.every(item => typeof item === 'string')) return value.join(', ');
    return token;
  });
}

export function formatActivityMessage(log: ActivityLog, translate: TranslateActivity) {
  const properties = log.properties ?? {};
  // Pass count so the locale can select the plural form. Resolve other fields here
  // so missing values, including nested paths and nulls, use a complete sentence.
  const key = log.event.replace(':', '.');
  const count =
    typeof properties.count === 'number' || typeof properties.count === 'string' ? properties.count : undefined;
  const values = {...properties, email: properties.nickname || 'User'};
  const message = interpolate(translate(key, {count}, ''), values);
  if (message.trim() && !hasPlaceholder.test(message)) return message;

  const description = interpolate(log.description ?? '', values);
  if (description.trim() && !hasPlaceholder.test(description)) return description;

  const label = log.event
    .replace(/^[^:]+:/, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
  if (Object.hasOwn(fallbackMessages, log.event)) return fallbackMessages[log.event];
  return label ? `Recorded an activity event (${label})` : 'Recorded an activity event';
}

export type ActivityCategory =
  | 'power'
  | 'backup'
  | 'files'
  | 'console'
  | 'settings'
  | 'schedules'
  | 'access'
  | 'network'
  | 'database'
  | 'account'
  | 'other';

const categoryByStem: Record<string, ActivityCategory> = {
  power: 'power',
  backup: 'backup',
  file: 'files',
  sftp: 'files',
  console: 'console',
  settings: 'settings',
  startup: 'settings',
  configuration: 'settings',
  java: 'settings',
  'quick-setup': 'settings',
  steam: 'settings',
  reinstall: 'settings',
  install: 'settings',
  installed: 'settings',
  'game-library': 'settings',
  minecraft: 'settings',
  schedule: 'schedules',
  task: 'schedules',
  subuser: 'access',
  allocation: 'network',
  subdomain: 'network',
  database: 'database',
};

/** `server:backup.start` is a backup event; account and sign-in events share one category. */
export function activityCategory(event: string): ActivityCategory {
  const [scope, rest = ''] = event.split(':');
  if (scope === 'auth' || scope === 'user') return 'account';
  const stem = rest.split('.')[0];
  return Object.hasOwn(categoryByStem, stem) ? categoryByStem[stem] : 'other';
}

/** Failures and refusals are the only events that earn a warning colour. */
export const activityFailed = (event: string) => /fail|denied|blocked/.test(event.replace(/^[^:]+:/, ''));

/** One backup followed from request to result, when both ends are on the page. */
export type BackupRun = {
  id: string;
  name: string;
  outcome: 'completed' | 'failed' | 'started';
  start?: ActivityLog;
  end?: ActivityLog;
};

export type ActivityItem = {
  key: string;
  kind: 'event' | 'backup' | 'scheduled';
  category: ActivityCategory;
  failed: boolean;
  title: string;
  /** How many times the event or the scheduled backup happened. */
  count: number;
  /** The entry that names the actor and address. */
  lead: ActivityLog;
  /** Every underlying log entry, newest first. */
  entries: [ActivityLog, ...ActivityLog[]];
  runs: BackupRun[];
  failures: number;
  newest: string;
  oldest: string;
};

export type ActivityDay = {key: string; label: string; items: ActivityItem[]};

const lifecycle: Record<string, BackupRun['outcome']> = {
  'server:backup.start': 'started',
  'server:backup.complete': 'completed',
  'server:backup.fail': 'failed',
};
const scheduledName = /^Scheduled backup (\d+) at \S+$/;
const actorOf = (log: ActivityLog) => log.relationships?.actor?.attributes;
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : '');

/** "Scheduled backup 2 at 2026-11-10T12:00:01.243389606Z" is "Scheduled backup 2"; the row carries the time. */
export function backupDisplayName(name: unknown) {
  const value = text(name);
  return scheduledName.test(value) ? value.replace(/ at \S+$/, '') : tameTimestamps(value);
}

/** The schedule a system backup belongs to, read from the audit fields or the generated name. */
function scheduleOf(run: BackupRun) {
  if ((run.start && actorOf(run.start)) || (run.end && actorOf(run.end))) return null;
  const generated = scheduledName.exec(run.name)?.[1];
  if (generated) return generated;
  const props = run.start?.properties;
  if (props?.source !== 'scheduled') return null;
  const schedule = props.schedule_id ?? props.schedule_name;
  return typeof schedule === 'number' || text(schedule) ? String(schedule) : 'schedule';
}

function dayLabel(date: Date, now: Date) {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const key = dayKey(date);
  if (key === dayKey(now)) return 'Today';
  if (key === dayKey(yesterday)) return 'Yesterday';
  return (date.getFullYear() === now.getFullYear() ? dayFormat : dayYearFormat).format(date);
}

function backupTitle(item: ActivityItem) {
  const run = item.runs[0];
  const scheduleName = text(item.runs.find(entry => entry.start)?.start?.properties?.schedule_name);
  if (item.kind === 'scheduled') {
    const label = scheduleName
      ? `Scheduled backup “${scheduleName}”`
      : backupDisplayName(run.name) || 'Scheduled backup';
    return item.count > 1 ? `${label} ran ${item.count} times` : `${label} ${run.outcome}`;
  }
  const name = backupDisplayName(run.name);
  return `${name ? `Backup “${name}”` : 'Backup'} ${run.outcome}`;
}

/**
 * Turns one page of audit entries (newest first) into the feed.
 *
 * - A backup's start and its result share one item when both are on the page.
 * - Runs of one schedule share one item per day.
 * - Identical events by the same actor fold while nothing else happens between
 *   them. Scheduled backups do not interrupt such a run.
 */
export function buildActivityFeed(
  logs: ActivityLog[],
  format: (log: ActivityLog) => string,
  now = new Date()
): ActivityDay[] {
  const runs = new Map<string, BackupRun>();
  for (const log of logs) {
    const outcome = Object.hasOwn(lifecycle, log.event) ? lifecycle[log.event] : undefined;
    const id = text(log.properties?.backup);
    if (!outcome || !id) continue;
    const run = runs.get(id) ?? {id, name: text(log.properties?.name), outcome};
    if (outcome === 'started') run.start ??= log;
    else if (!run.end) {
      run.end = log;
      run.outcome = outcome;
    }
    run.name ||= text(log.properties?.name);
    runs.set(id, run);
  }

  type DayState = {day: ActivityDay; schedules: Map<string, ActivityItem>; previous?: ActivityItem; repeat?: string};
  const days = new Map<string, DayState>();
  const placed = new Set<string>();
  const extend = (item: ActivityItem, ...entries: ActivityLog[]) => {
    item.entries.push(...entries);
    item.oldest = entries.at(-1)!.timestamp;
  };

  for (const log of logs) {
    const date = parseTime(log.timestamp);
    const known = Number.isFinite(date.getTime());
    const key = known ? dayKey(date) : '';
    let state = days.get(key);
    if (!state) {
      state = {day: {key, label: known ? dayLabel(date, now) : 'Unknown date', items: []}, schedules: new Map()};
      days.set(key, state);
    }

    const id = Object.hasOwn(lifecycle, log.event) ? text(log.properties?.backup) : '';
    const run = id ? runs.get(id) : undefined;
    if (run && (run.start === log || run.end === log)) {
      // The run was placed at its newest entry, usually the result.
      if (placed.has(run.id)) continue;
      placed.add(run.id);
      const entries = [run.end, run.start].filter(entry => entry !== undefined) as [ActivityLog, ...ActivityLog[]];
      const schedule = scheduleOf(run);
      const failed = run.outcome === 'failed';
      const group = schedule === null ? undefined : state.schedules.get(schedule);
      if (group) {
        group.runs.push(run);
        group.count++;
        group.failed ||= failed;
        group.failures += Number(failed);
        extend(group, ...entries);
        continue;
      }
      const item: ActivityItem = {
        key: log.id,
        kind: schedule === null ? 'backup' : 'scheduled',
        category: 'backup',
        failed,
        title: '',
        count: 1,
        lead: run.start ?? run.end!,
        entries,
        runs: [run],
        failures: Number(failed),
        newest: entries[0].timestamp,
        oldest: entries.at(-1)!.timestamp,
      };
      state.day.items.push(item);
      if (schedule === null) state.previous = state.repeat = undefined;
      else state.schedules.set(schedule, item);
      continue;
    }

    const actor = actorOf(log);
    const repeat = JSON.stringify([
      log.event,
      actor ? (actor.uuid ?? actor.id ?? actor.username) : null,
      log.ip ?? '',
      log.description,
      log.properties,
    ]);
    if (state.previous && state.repeat === repeat) {
      state.previous.count++;
      extend(state.previous, log);
      continue;
    }
    const item: ActivityItem = {
      key: log.id,
      kind: 'event',
      category: activityCategory(log.event),
      failed: activityFailed(log.event),
      title: format(log),
      count: 1,
      lead: log,
      entries: [log],
      runs: [],
      failures: 0,
      newest: log.timestamp,
      oldest: log.timestamp,
    };
    state.day.items.push(item);
    state.previous = item;
    state.repeat = repeat;
  }

  return Array.from(days.values(), ({day}) => {
    for (const item of day.items) if (item.kind !== 'event') item.title = backupTitle(item);
    return day;
  });
}

export const activityClock = (timestamp: string) => {
  const date = parseTime(timestamp);
  return Number.isFinite(date.getTime()) ? clockFormat.format(date) : timestamp;
};

/** "11:00 AM – 4:30 PM" for a folded item, or the single time when they match. */
export function activityTimeRange(item: Pick<ActivityItem, 'newest' | 'oldest'>) {
  const first = activityClock(item.oldest);
  const last = activityClock(item.newest);
  return first === last ? first : `${first} – ${last}`;
}

/**
 * The last day reads as elapsed time. Older entries sit under a dated heading,
 * where the clock time says more than "9 days ago". `exact` is the hover text.
 */
export function activityTime(timestamp: string, now: Date) {
  const date = parseTime(timestamp);
  if (!Number.isFinite(date.getTime())) return {relative: 'Unknown time', exact: timestamp};
  const seconds = (date.getTime() - now.getTime()) / 1000;
  const exact = exactFormat.format(date);
  if (Math.abs(seconds) >= 86400) return {relative: clockFormat.format(date), exact};
  const unit = (
    [
      ['hour', 3600],
      ['minute', 60],
    ] as const
  ).find(([, size]) => Math.abs(seconds) >= size);
  return {relative: unit ? relativeFormat.format(Math.trunc(seconds / unit[1]), unit[0]) : 'Just now', exact};
}

/** How long a backup took, from its two audit entries. */
export function backupDuration(run: BackupRun) {
  if (!run.start || !run.end) return '';
  const seconds = Math.round(
    (parseTime(run.end.timestamp).getTime() - parseTime(run.start.timestamp).getTime()) / 1000
  );
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 1) return 'under a second';
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

const propertyNames: Record<string, string> = {
  allocation: 'Address',
  backup: 'Backup ID',
  command: 'Command',
  configured: 'Has a value',
  count: 'Count',
  directory: 'Directory',
  file: 'File path',
  files: 'Files',
  from: 'From',
  job_id: 'Job ID',
  locked: 'Locked',
  new: 'New value',
  nickname: 'User',
  old: 'Previous value',
  permissions: 'Permissions',
  reason: 'Reason',
  schedule_id: 'Schedule ID',
  schedule_name: 'Schedule name',
  source: 'Source',
  to: 'To',
  truncate: 'Delete files before restoring',
  url: 'URL',
  variable: 'Variable',
};

export function activityPropertyLabel(key: string, event: string): string {
  if (key === 'name') {
    if (event.startsWith('server:backup.')) return 'Backup name';
    if (event.startsWith('server:schedule.') || event.startsWith('server:task.')) return 'Schedule name';
    if (event === 'server:file.create-directory') return 'Directory name';
  }
  if (Object.hasOwn(propertyNames, key)) return propertyNames[key];
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

const worded = new Set(['reason', 'source', 'kind', 'mode', 'action']);

/** Property text for people: local times, and words for the codes the panel writes. */
export function activityPropertyText(key: string, value: string | number) {
  if (typeof value === 'number') return String(value);
  if (worded.has(key) && /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(value)) {
    const words = value.replace(/[_-]+/g, ' ');
    return words[0].toUpperCase() + words.slice(1);
  }
  return tameTimestamps(value);
}

/** The panel adds `<key>_count` beside every list; the list already shows its length. */
export function activityPropertyEntries(properties: Record<string, unknown> | null | undefined) {
  const all = properties ?? {};
  return Object.entries(all).filter(
    ([key]) => !(key.endsWith('_count') && Array.isArray(all[key.slice(0, -'_count'.length)]))
  );
}

/** Quick filters are plain presets for the event filter, which matches event names. */
export const activityFilterPresets = [
  {label: 'Power', value: 'power'},
  {label: 'Backups', value: 'backup'},
  {label: 'Files', value: 'file'},
  {label: 'Console', value: 'console'},
  {label: 'Startup', value: 'startup'},
  {label: 'Settings', value: 'settings'},
  {label: 'Schedules', value: 'schedule'},
  {label: 'Access', value: 'subuser'},
  {label: 'Network', value: 'allocation'},
] as const;
