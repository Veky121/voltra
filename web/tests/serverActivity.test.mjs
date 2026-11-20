import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import * as model from '../src/features/activity/activityModel.ts';
import {accountNickname} from '../src/features/account/accountProfile.ts';
import {createRenderer} from './domFreeReact.mjs';
import {loadModule} from './loadModule.mjs';

const event = (id, timestamp, properties = {}, overrides = {}) => ({
  id,
  timestamp,
  event: 'server:backup.start',
  properties,
  ...overrides,
});
const namedBackup = () => 'Started a new backup {{name}}';
const at = (day, hour, minute = 0, second = 0) => new Date(2026, 10, day, hour, minute, second).toISOString();
const now = new Date(at(20, 18));
const person = (id = 1) => ({relationships: {actor: {attributes: {id, username: `user${id}`}}}});
const sentence = log => `${log.event} ${log.properties?.file ?? ''}`.trim();
const feed = logs => model.buildActivityFeed(logs, sentence, now);
const clock = new Intl.DateTimeFormat(undefined, {hour: 'numeric', minute: '2-digit'});
const shape = days => days.map(day => day.items.map(item => item.entries.map(entry => entry.id)));

/** One scheduled backup: the result first, as the API lists newest first. */
function scheduledRun(id, day, hour, {fail = false, legacy = false, schedule = 2} = {}) {
  const name = `Scheduled backup ${schedule} at ${new Date(2026, 10, day, hour).toISOString().replace('Z', '389606Z')}`;
  const audit = legacy ? {} : {source: 'scheduled', schedule_id: schedule, schedule_name: 'World backup'};
  return [
    event(
      `${id}-end`,
      at(day, hour, 1, 30),
      {backup: id, name},
      {event: `server:backup.${fail ? 'fail' : 'complete'}`}
    ),
    event(`${id}-start`, at(day, hour), {backup: id, name, ...audit}),
  ];
}

test('activity messages interpolate available properties and fall back for old backup audits', () => {
  const format = properties => model.formatActivityMessage(event('id', '', properties), namedBackup);
  assert.equal(format({name: 'Daily world'}), 'Started a new backup Daily world');
  for (const name of [undefined, null, '', '   ', '{{name}}']) {
    assert.equal(format({name}), 'Started a new backup');
  }
});

test('formatter resolves nested paths and drops incomplete templates for any event', () => {
  const rename = pairs => event('id', '', {files: pairs, count: 1}, {event: 'server:file.rename'});
  const translate = (key, {count}) => {
    assert.equal(key, 'server.file.rename');
    assert.equal(count, 1);
    return 'Renamed {{files.0.from}} to {{files.0.to}}';
  };
  assert.equal(model.formatActivityMessage(rename([{from: '/old', to: '/new'}]), translate), 'Renamed /old to /new');
  assert.equal(model.formatActivityMessage(rename([{from: '/old'}]), translate), 'Renamed or moved files');
  const unknown = event('id', '', {}, {event: 'server:other.event', description: 'Completed {{missing}}'});
  assert.equal(
    model.formatActivityMessage(unknown, () => ''),
    'Recorded an activity event (other event)'
  );
});

test('machine timestamps inside names read as local times, and generated backup names lose them', () => {
  const stamp = '2026-11-10T12:00:01.243389606Z';
  const local = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date('2026-11-10T12:00:01.243Z'));
  const download = event('id', '', {name: `Scheduled backup 2 at ${stamp}`}, {event: 'server:backup.download'});
  assert.equal(
    model.formatActivityMessage(download, () => 'Downloaded the {{name}} backup'),
    `Downloaded the Scheduled backup 2 at ${local} backup`
  );
  assert.equal(model.backupDisplayName(`Scheduled backup 2 at ${stamp}`), 'Scheduled backup 2');
  assert.equal(model.backupDisplayName(`Nightly ${stamp}`), `Nightly ${local}`);
  assert.equal(model.backupDisplayName('Before update'), 'Before update');
  assert.equal(model.tameTimestamps('not a time: 2026-11-10'), 'not a time: 2026-11-10');
});

test('feed groups by local day and folds every run of one schedule into a single item', () => {
  const days = feed([
    ...scheduledRun('c', 20, 16),
    event('stop', at(20, 15), {}, {event: 'server:power.stop', ...person()}),
    ...scheduledRun('b', 20, 14, {fail: true}),
    ...scheduledRun('other', 20, 13, {schedule: 9}),
    ...scheduledRun('a', 20, 11),
    ...scheduledRun('y', 19, 23),
    ...scheduledRun('old', 10, 17, {legacy: true}),
    ...scheduledRun('older', 10, 16, {legacy: true}),
  ]);
  assert.deepEqual(
    days.map(day => day.label),
    [
      'Today',
      'Yesterday',
      new Intl.DateTimeFormat(undefined, {weekday: 'short', month: 'short', day: 'numeric'}).format(
        new Date(at(10, 17))
      ),
    ]
  );
  const [group, stop, other] = days[0].items;
  assert.equal(days[0].items.length, 3);
  assert.equal(group.kind, 'scheduled');
  assert.equal(group.title, 'Scheduled backup “World backup” ran 3 times');
  assert.deepEqual(
    [group.count, group.failures, group.failed, group.entries.length],
    [3, 1, true, 6],
    'three runs, six audit entries, one failure'
  );
  assert.deepEqual(
    group.runs.map(run => [run.id, run.outcome]),
    [
      ['c', 'completed'],
      ['b', 'failed'],
      ['a', 'completed'],
    ]
  );
  assert.equal(
    model.activityTimeRange(group),
    `${clock.format(new Date(at(20, 11)))} – ${clock.format(new Date(at(20, 16, 1)))}`
  );
  assert.equal(stop.kind, 'event');
  assert.equal(other.title, 'Scheduled backup “World backup” completed');
  assert.equal(model.backupDuration(other.runs[0]), '2 min');
  assert.equal(days[1].items[0].count, 1);
  // Audits written before the schedule fields existed are recognised by the generated name.
  assert.equal(days[2].items.length, 1);
  assert.equal(days[2].items[0].title, 'Scheduled backup 2 ran 2 times');
});

test('a backup and its result share one item only when both entries are on the page', () => {
  const start = event('start', at(20, 12), {backup: 'm', name: 'Before update', locked: true}, person());
  const done = event(
    'done',
    at(20, 12, 0, 42),
    {backup: 'm', name: 'Before update'},
    {event: 'server:backup.complete'}
  );
  const [paired] = feed([done, start])[0].items;
  assert.deepEqual(
    [paired.kind, paired.title, paired.lead.id, paired.newest, paired.count],
    ['backup', 'Backup “Before update” completed', 'start', done.timestamp, 1]
  );
  assert.equal(model.backupDuration(paired.runs[0]), '42 sec');

  const [running] = feed([start])[0].items;
  assert.equal(running.title, 'Backup “Before update” started');
  assert.equal(model.backupDuration(running.runs[0]), '');
  const [orphan] = feed([{...done, event: 'server:backup.fail'}])[0].items;
  assert.deepEqual([orphan.title, orphan.failed], ['Backup “Before update” failed', true]);

  // A person's backup never joins the scheduled group, and entries without an identifier stay as written.
  const manual = feed([...scheduledRun('s', 20, 13), done, start, event('bare', at(20, 9), {name: 'x'})])[0].items;
  assert.deepEqual(
    manual.map(item => item.kind),
    ['scheduled', 'backup', 'event']
  );
});

test('identical consecutive events by one actor fold; anything else between them keeps them apart', () => {
  const download = (id, minute, overrides = {}) =>
    event(
      id,
      at(20, 12, minute),
      {file: '/server.properties'},
      {event: 'server:file.download', ...person(), ...overrides}
    );
  const [day] = feed([
    download('d5', 50),
    ...scheduledRun('s', 20, 12),
    download('d4', 40),
    download('d3', 30, person(2)),
    download('d2', 20),
    event('stop', at(20, 12, 15), {}, {event: 'server:power.stop', ...person()}),
    download('d1', 10),
    download('d0', 5, {properties: {file: '/ops.json'}}),
    event('fail-2', at(20, 11), {}, {event: 'server:power.fail'}),
    event('fail-1', at(20, 10), {}, {event: 'server:power.fail'}),
  ]);
  assert.deepEqual(shape([day])[0], [
    ['d5', 'd4'],
    ['s-end', 's-start'],
    ['d3'],
    ['d2'],
    ['stop'],
    ['d1'],
    ['d0'],
    ['fail-2', 'fail-1'],
  ]);
  const [repeat] = day.items;
  assert.deepEqual([repeat.count, repeat.newest, repeat.oldest], [2, at(20, 12, 50), at(20, 12, 40)]);
  assert.equal(day.items.at(-1).failed, true);
  // The same event on another day starts a new item.
  assert.deepEqual(shape(feed([download('today', 0), download('before', 0, {timestamp: at(19, 12)})])), [
    [['today']],
    [['before']],
  ]);
});

test('categories, times and detail fields are presented for people', () => {
  assert.deepEqual(
    [
      'server:power.start',
      'server:sftp.write',
      'server:startup.edit',
      'server:task.update',
      'auth:fail',
      'server:x',
    ].map(model.activityCategory),
    ['power', 'files', 'settings', 'schedules', 'account', 'other']
  );
  assert.deepEqual(
    ['server:backup.fail', 'server:backup.restore-failed', 'server:sftp.denied', 'server:file.write'].map(
      model.activityFailed
    ),
    [true, true, true, false]
  );
  const relative = new Intl.RelativeTimeFormat(undefined, {numeric: 'always', style: 'narrow'});
  const exact = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'long'});
  assert.deepEqual(model.activityTime(at(20, 16), now), {
    relative: relative.format(-2, 'hour'),
    exact: exact.format(new Date(at(20, 16))),
  });
  assert.equal(model.activityTime(at(20, 17, 59, 30), now).relative, 'Just now');
  // Past a day the heading carries the date, so the row shows the clock time.
  assert.equal(model.activityTime(at(11, 9, 5), now).relative, clock.format(new Date(at(11, 9, 5))));
  assert.deepEqual(model.activityTime('never', now), {relative: 'Unknown time', exact: 'never'});

  assert.equal(model.activityPropertyLabel('name', 'server:backup.start'), 'Backup name');
  assert.equal(model.activityPropertyLabel('old', 'server:startup.edit'), 'Previous value');
  assert.equal(model.activityPropertyLabel('checksum_type', 'server:x'), 'Checksum type');
  assert.equal(model.activityPropertyText('reason', 'completion_timeout'), 'Completion timeout');
  assert.equal(model.activityPropertyText('file', 'completion_timeout'), 'completion_timeout');
  assert.deepEqual(
    model.activityPropertyEntries({files: ['a'], files_count: 1, count: 1, retry_count: 2}).map(([key]) => key),
    ['files', 'count', 'retry_count']
  );
});

function mountActivity(pages, {scope} = {}) {
  const renderer = createRenderer();
  const el = renderer.jsxRuntime.jsx;
  const tag = type => props => el(type, props);
  const requests = [];
  const timers = [];
  const state = {error: '', loading: false};
  const react = {react: renderer.React, 'react/jsx-runtime': renderer.jsxRuntime};
  const toggle = ({pressed, onPressedChange, ...rest}) =>
    el('button', {...rest, 'aria-pressed': pressed, onClick: () => onPressedChange(!pressed)});
  const details = loadModule(new URL('../src/features/activity/ActivityDetails.tsx', import.meta.url), {
    ...react,
    '../../components/ui/toggle': {Toggle: toggle},
    './activityModel': model,
  });
  const {default: ServerActivity} = loadModule(
    new URL('../src/features/activity/ServerActivity.tsx', import.meta.url),
    {
      ...react,
      '../../components/ui/empty': {
        Empty: tag('section'),
        EmptyHeader: tag('header'),
        EmptyMedia: () => null,
        EmptyTitle: tag('h3'),
        EmptyDescription: tag('p'),
      },
      '../../components/ui/sheet': {
        Sheet: ({open, children}) => (open ? children : null),
        SheetContent: tag('aside'),
        SheetHeader: tag('header'),
        SheetTitle: tag('h2'),
        SheetDescription: tag('p'),
      },
      '../../components/ui/toggle-group': {
        ToggleGroup: ({value, onValueChange, children, ...rest}) =>
          el('div', {...rest, role: 'group', 'data-value': value[0], onValueChange, children}),
        ToggleGroupItem: tag('option'),
      },
      '../../lib': {
        Button: tag('button'),
        Input: tag('input'),
        useAPI: path => {
          requests.push(path);
          const data = state.loading ? null : (pages(path) ?? null);
          return {data, error: state.error, loading: state.loading, reload() {}};
        },
        useTranslation: () => namedBackup,
      },
      '../../ui/CollectionSkeleton': {CollectionSkeleton: props => el('output', props)},
      '../account/accountProfile': {accountNickname},
      '../shared/common': {
        items: data => data?.data ?? [],
        PageError: ({error}) => (error ? el('samp', {children: error}) : null),
        Pager: () => null,
        value: data => data?.attributes,
      },
      './ActivityDetails': details,
      './activityModel': model,
    },
    {
      setTimeout: run => timers.push(run),
      clearTimeout: id => {
        timers[id - 1] = () => {};
      },
    }
  );
  const view = renderer.mount(ServerActivity, {path: '/activity', scope});
  return {view, requests, state, runTimers: () => timers.splice(0).forEach(run => run())};
}
const className = name => node => node.props.className === name;
const page = (data, total_pages = 1) => ({data, meta: {pagination: {total_pages}}});

test('rows keep one layout: details open in the sheet and rows with nothing more to show are not buttons', async () => {
  const time = new Date().toISOString();
  const props = {backup: 'b1', name: 'Daily backup', locked: true};
  const actor = {relationships: {actor: {attributes: {username: 'operator'}}}};
  const logs = [
    event('backup', time, props, {ip: '2001:db8::1', ...actor}),
    event('power', time, {}, {event: 'server:power.start', ...actor}),
    event('d2', time, {file: '/a.txt'}, {event: 'server:file.download', description: 'Downloaded /a.txt', ...actor}),
    event('d1', time, {file: '/a.txt'}, {event: 'server:file.download', description: 'Downloaded /a.txt', ...actor}),
  ];
  const answer = page(logs);
  const {view} = mountActivity(() => answer);
  const rows = () => view.findAll(className('activity-row'));
  assert.deepEqual(
    rows().map(row => row.type),
    ['button', 'div', 'button']
  );
  assert.match(view.text(rows()[0]), /^Backup “Daily backup” startedoperator2001:db8::1/);
  assert.equal(
    view.findAll(node => node.props['aria-hidden'] === 'true' && node.props.className === 'activity-chevron').length,
    2
  );
  assert.match(view.text(rows()[2]), /^Downloaded \/a\.txt×2, 2 timesoperator/);
  assert.equal(view.find(className('activity-list')).type, 'ul');
  assert.equal(view.findAll(node => node.type === 'aside').length, 0);

  await view.click(rows()[0]);
  const sheet = () => view.find(node => node.type === 'aside');
  assert.equal(rows().length, 3, 'opening details leaves the feed as it was');
  assert.equal(view.findAll(node => node.type === 'pre').length, 0);
  assert.match(view.text(sheet()), /Backup nameDaily backupLockedYesBackup IDb1/);
  assert.match(view.text(sheet()), /Byoperator.*IP address2001:db8::1.*Eventserver:backup\.start/);
  await view.click(view.find(node => node.type === 'button' && node.props['aria-pressed'] === false));
  assert.equal(view.text(view.find(node => node.type === 'pre')), JSON.stringify(props, null, 2));

  await view.click(rows()[2]);
  assert.match(view.text(sheet()), /^Downloaded \/a\.txt ×2/);
  assert.equal(view.findAll(node => node.type === 'pre').length, 0, 'Raw resets for another item');
  assert.equal(view.find(className('activity-detail-times')).children.length, 2);
});

test('filters ask the server, quick filters are presets of the event filter, and states stay in place', async () => {
  const log = event('one', new Date().toISOString(), {}, {event: 'server:power.stop'});
  // useAPI hands back the same object until the answer changes.
  const answers = {value: page([log], 3)};
  const {view, requests, state, runTimers} = mountActivity(() => answers.value);
  const last = () => decodeURIComponent(requests.at(-1));
  const group = () => view.find(node => node.props.role === 'group');
  const input = label => view.find(node => node.type === 'input' && node.props['aria-label'] === label);
  assert.match(last(), /page=1&per_page=25&include=actor&sort=-timestamp&filter\[event\]=&filter\[ip\]=$/);
  assert.equal(group().props['data-value'], 'all');
  assert.deepEqual(
    group().children.map(option => option.props.value),
    ['all', ...model.activityFilterPresets.map(preset => preset.value)]
  );
  assert.equal(view.findAll(className('activity-end')).length, 0);

  view.change(group(), ['backup']);
  assert.match(last(), /filter\[event\]=backup&/);
  assert.equal(input('Filter by event').props.value, 'backup');
  assert.equal(group().props['data-value'], 'backup');

  // Typing waits for a pause before the list is requested again.
  view.change(input('Filter by event'), 'backup.fail');
  assert.match(last(), /filter\[event\]=backup&/);
  runTimers();
  view.rerender();
  assert.match(last(), /filter\[event\]=backup\.fail&/);
  view.change(input('Filter by IP address'), '10.0');
  assert.match(last(), /filter\[ip\]=10\.0$/);

  // The previous answer stays while the next one loads.
  state.loading = true;
  view.rerender();
  assert.equal(view.find(className('activity-feed')).props['aria-busy'], true);
  assert.equal(view.findAll(node => node.type === 'output').length, 0);
  state.loading = false;

  answers.value = page([]);
  view.rerender();
  assert.match(view.text(), /No matching activityNothing in the log matches these filters\.Clear filters/);
  await view.click(view.find(node => node.type === 'button' && view.text(node) === 'Clear filters'));
  assert.match(last(), /filter\[event\]=&filter\[ip\]=$/);
  assert.match(view.text(), /No activity yet/);

  answers.value = page([log]);
  view.rerender();
  assert.equal(view.text(view.find(className('activity-end'))), 'Start of the activity log');
});

test('first load shows the feed skeleton, a failed load offers a retry, and account activity has no server filters', () => {
  const loading = mountActivity(() => null);
  loading.state.loading = true;
  loading.view.rerender();
  assert.equal(loading.view.find(node => node.type === 'output').props.layout, 'activity');

  const failed = mountActivity(() => null);
  failed.state.error = 'The activity log could not be read.';
  failed.view.rerender();
  assert.match(failed.view.text(), /Activity could not be loaded.*Try again/);
  assert.equal(failed.view.text(failed.view.find(node => node.type === 'samp')), 'The activity log could not be read.');

  const none = page([]);
  const account = mountActivity(() => none, {scope: 'account'});
  assert.equal(account.view.findAll(node => node.props.role === 'group').length, 0);
  assert.deepEqual(
    account.view.findAll(node => node.type === 'input').map(node => node.props['aria-label']),
    ['Filter by event']
  );
  assert.match(account.view.text(), /Sign-ins and changes to your account will appear here\./);
});

test('activity styles keep rows fixed and quiet under the global button rule', () => {
  const css = readFileSync(new URL('../src/features/activity/serverActivity.css', import.meta.url), 'utf8');
  const rule = selector => {
    const start = css.indexOf(`\n${selector} {`);
    assert.notEqual(start, -1, `${selector} is styled`);
    return css.slice(start, css.indexOf('}', start));
  };
  const row = rule('.activity-row');
  assert.match(row, /grid-template-columns: 30px minmax\(0, 1fr\) auto 16px/);
  for (const reset of ['border: 0', 'background: transparent', 'white-space: normal', 'filter: none']) {
    assert.ok(row.includes(reset), `rows reset ${reset}`);
  }
  assert.match(rule('button.activity-row:hover'), /filter: none/);
  assert.match(rule('button.activity-row:focus-visible'), /outline: 2px solid var\(--accent\)/);
  assert.match(rule('.activity-sheet [data-slot=sheet-close]'), /background: transparent/);
  assert.match(css, /@container \(max-width: 560px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /position: sticky/);
});
