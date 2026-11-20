import {useEffect, useState} from 'react';
import {
  Archive,
  CalendarClock,
  ChevronRight,
  Database,
  FileText,
  History,
  Network,
  Power,
  ShieldCheck,
  SlidersHorizontal,
  SquareTerminal,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from '../../components/ui/empty';
import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from '../../components/ui/sheet';
import {ToggleGroup, ToggleGroupItem} from '../../components/ui/toggle-group';
import {Button, Input, useAPI, useTranslation} from '../../lib';
import type {ActivityLog, ResourceList} from '../../types/api';
import {CollectionSkeleton} from '../../ui/CollectionSkeleton';
import {accountNickname} from '../account/accountProfile';
import {items, PageError, Pager, value} from '../shared/common';
import {ActivityDetails} from './ActivityDetails';
import {
  activityFilterPresets,
  activityTime,
  activityTimeRange,
  backupDuration,
  buildActivityFeed,
  formatActivityMessage,
  type ActivityCategory,
  type ActivityItem,
} from './activityModel';
import './serverActivity.css';

const categories: Record<ActivityCategory, {label: string; icon: LucideIcon}> = {
  power: {label: 'Power', icon: Power},
  backup: {label: 'Backups', icon: Archive},
  files: {label: 'Files', icon: FileText},
  console: {label: 'Console', icon: SquareTerminal},
  settings: {label: 'Settings', icon: SlidersHorizontal},
  schedules: {label: 'Schedules', icon: CalendarClock},
  access: {label: 'Access', icon: Users},
  network: {label: 'Network', icon: Network},
  database: {label: 'Databases', icon: Database},
  account: {label: 'Account', icon: ShieldCheck},
  other: {label: 'Activity', icon: History},
};

function actorName(log: ActivityLog) {
  const actor = value(log.relationships?.actor);
  return actor ? accountNickname(actor) : 'System';
}

/** Rows open details only when there is something more to read than the row shows. */
const hasDetails = (item: ActivityItem) =>
  item.entries.length > 1 || Object.keys(item.lead.properties ?? {}).length > 0;

function ActivityRow({item, now, onOpen}: {item: ActivityItem; now: Date; onOpen: (item: ActivityItem) => void}) {
  const {lead} = item;
  const category = categories[item.category];
  const Icon = category.icon;
  const actor = actorName(lead);
  const person = !!lead.relationships?.actor;
  const {relative, exact} = activityTime(item.newest, now);
  const repeated = item.kind === 'event' && item.count > 1;
  const range = activityTimeRange(item);
  const duration = item.runs.length === 1 ? backupDuration(item.runs[0]) : '';
  const notes = [
    lead.is_api && 'API key',
    // A range only when the folded entries span more than one minute.
    item.count > 1 && range.includes('–') && range,
    duration && `took ${duration}`,
    lead.ip,
  ].filter(Boolean);
  const content = (
    <>
      <span className="activity-icon" title={category.label}>
        <Icon aria-hidden="true" />
      </span>
      <span className="activity-main">
        <span className="activity-title">
          {item.title}
          {repeated && (
            <span className="activity-count" title={`${item.count} times`}>
              <span aria-hidden="true">×{item.count}</span>
              <span className="scn:sr-only">, {item.count} times</span>
            </span>
          )}
        </span>
        <span className="activity-meta">
          <span className="activity-actor" data-person={person || undefined}>
            {actor}
          </span>
          {item.failures > 0 && item.count > 1 && <span className="activity-failures">{item.failures} failed</span>}
          {notes.map(note => (
            <span key={String(note)}>{note}</span>
          ))}
        </span>
      </span>
      <time className="activity-when" dateTime={item.newest} title={exact}>
        {relative}
      </time>
    </>
  );
  return (
    <li className="activity-item" data-category={item.category} data-failed={item.failed || undefined}>
      {hasDetails(item) ? (
        <button type="button" className="activity-row" aria-haspopup="dialog" onClick={() => onOpen(item)}>
          {content}
          <ChevronRight className="activity-chevron" aria-hidden="true" />
        </button>
      ) : (
        <div className="activity-row">{content}</div>
      )}
    </li>
  );
}

type ActivityPage = ResourceList<ActivityLog> & {meta?: {pagination?: {total?: number; total_pages?: number}}};

export default function ServerActivity({path, scope = 'server'}: {path: string; scope?: 'server' | 'account'}) {
  const translate = useTranslation('activity');
  const [draft, setDraft] = useState('');
  const [event, setEvent] = useState('');
  const [ip, setIP] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ActivityItem | null>(null);
  const [open, setOpen] = useState(false);
  const query = useAPI<ActivityPage>(
    `${path}?page=${page}&per_page=25&include=actor&sort=-timestamp&filter[event]=${encodeURIComponent(event)}&filter[ip]=${encodeURIComponent(ip)}`
  );

  // Typing settles before the list is asked again; quick filters apply at once.
  useEffect(() => {
    if (draft.trim() === event) return;
    const timer = setTimeout(() => {
      setEvent(draft.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [draft, event]);

  // Keep the last answer on screen while a filter, page or refresh loads, so the
  // feed is replaced once instead of collapsing to a placeholder and back.
  const [shown, setShown] = useState<{path: string; data: ActivityPage} | null>(null);
  if (query.data && (shown?.data !== query.data || shown.path !== path)) setShown({path, data: query.data});
  const data = query.data ?? (shown?.path === path ? shown.data : null);
  const stale = !query.data && !!data && query.loading;

  const now = new Date();
  const days = buildActivityFeed(items(data), log => formatActivityMessage(log, translate), now);
  const filtered = !!event || !!ip;
  const pagination = data?.meta?.pagination;
  const lastPage = !!pagination && page >= (pagination.total_pages ?? 1);
  const applyFilter = (next: string) => {
    setDraft(next);
    setEvent(next);
    setPage(1);
  };
  const clearFilters = () => {
    applyFilter('');
    setIP('');
  };
  const selectedActor = selected ? actorName(selected.lead) : '';

  return (
    <section className="operations-page activity-page server-activity">
      <div className="toolbar server-page-toolbar">
        <h2>Activity</h2>
        <Button variant="secondary" onClick={query.reload}>
          Refresh
        </Button>
      </div>
      <div className="activity-filters">
        <div className="activity-filter-fields">
          <Input
            type="search"
            aria-label="Filter by event"
            value={draft}
            placeholder="Filter by event, for example backup"
            onChange={e => setDraft(e.target.value)}
          />
          {scope === 'server' && (
            <Input
              className="activity-filter-ip"
              aria-label="Filter by IP address"
              value={ip}
              placeholder="IP address"
              onChange={e => {
                setIP(e.target.value);
                setPage(1);
              }}
            />
          )}
        </div>
        {scope === 'server' && (
          <ToggleGroup
            className="activity-presets"
            aria-label="Quick filters"
            value={[draft.trim().toLowerCase() || 'all']}
            onValueChange={(next: unknown[]) => {
              if (typeof next[0] === 'string') applyFilter(next[0] === 'all' ? '' : next[0]);
            }}
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            {activityFilterPresets.map(preset => (
              <ToggleGroupItem key={preset.value} value={preset.value}>
                {preset.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>
      <PageError error={query.error} />
      {!data && query.loading ? (
        <CollectionSkeleton label="Loading activity" layout="activity" count={6} />
      ) : !data && query.error ? (
        <Empty className="activity-empty">
          <EmptyHeader>
            <EmptyTitle>Activity could not be loaded</EmptyTitle>
            <EmptyDescription>Check your connection, then try again.</EmptyDescription>
          </EmptyHeader>
          <Button variant="secondary" onClick={query.reload}>
            Try again
          </Button>
        </Empty>
      ) : !days.length ? (
        <Empty className="activity-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <History aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{filtered ? 'No matching activity' : 'No activity yet'}</EmptyTitle>
            <EmptyDescription>
              {filtered
                ? 'Nothing in the log matches these filters.'
                : scope === 'server'
                  ? 'Power actions, backups, file changes and settings updates will appear here.'
                  : 'Sign-ins and changes to your account will appear here.'}
            </EmptyDescription>
          </EmptyHeader>
          {filtered && (
            <Button variant="secondary" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </Empty>
      ) : (
        <div className="activity-feed" aria-busy={stale || undefined}>
          {days.map(day => (
            <section className="activity-day" key={day.key} aria-label={day.label}>
              <h3 className="activity-day-heading">{day.label}</h3>
              <ul className="activity-list">
                {day.items.map(item => (
                  <ActivityRow
                    key={item.key}
                    item={item}
                    now={now}
                    onOpen={next => {
                      setSelected(next);
                      setOpen(true);
                    }}
                  />
                ))}
              </ul>
            </section>
          ))}
          {lastPage && (
            <p className="activity-end">{filtered ? 'No more matching activity' : 'Start of the activity log'}</p>
          )}
        </div>
      )}
      <Pager data={data} page={page} setPage={setPage} />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="activity-sheet">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {selected.title}
                  {selected.kind === 'event' && selected.count > 1 && ` ×${selected.count}`}
                </SheetTitle>
                <SheetDescription>
                  {selectedActor} ·{' '}
                  {selected.entries.length > 1
                    ? `${days.find(day => day.items.some(item => item.key === selected.key))?.label ?? ''} ${activityTimeRange(selected)}`.trim()
                    : activityTime(selected.newest, now).exact}
                </SheetDescription>
              </SheetHeader>
              <ActivityDetails key={selected.key} item={selected} actor={selectedActor} now={now} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}
