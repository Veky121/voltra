import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

// One bundle, so the overview snapshot, the account store and the sign-out
// handling share state as they do in the app. Loading it again under another
// name gives a second, independent copy: another tab.
const bundle = await build({stdin: {contents: "export * from './src/accountSnapshots'; export * from './src/signedOut'; export {takeBootRead} from './src/bootReads'; export * from './src/navigationSnapshot'; export * from './src/desktopSnapshots'; export * from './src/client/overviewSnapshot'; export * from './src/hooks/queryCache';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts'}, bundle: true, write: false, format: 'esm', platform: 'node'});
// A lock that is always free: each change runs at once, as it does in a
// browser when no other tab is changing the store. Tests that are about
// waiting for a turn supply their own.
const free = {request: (name, change) => { change(); return Promise.resolve(); }};
const load = async tag => {
  const instance = await import(`data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n// ${tag}`).toString('base64')}`);
  instance.setSnapshotLocks(free);
  return instance;
};
const c = await load('no window');
const settle = () => new Promise(resolve => setImmediate(resolve));

function memory() {
  const values = new Map();
  return {values, get length() { return values.size; }, key: index => [...values.keys()][index] ?? null, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
}
function useStorage(storage) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true, writable: true});
  return () => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; };
}
const week = 7 * 24 * 60 * 60 * 1000;
const owner = 'voltra.snapshot-owner';
const revision = 'voltra.snapshot-session';
// The saved copies alone, and everything the store holds about an account.
const copies = storage => [...storage.values.keys()].filter(key => key !== owner && key !== revision);
const kept = storage => [...storage.values.keys()].filter(key => key !== revision);
const write = (page, name, value, storage, now) => page.writeAccountSnapshot(name, value, page.snapshotOwner(), storage, now);

test('a saved copy is read only by the account that wrote it', () => {
  const storage = memory();
  c.setSnapshotAccount('', storage);
  write(c, 'navigation', ['nobody'], storage, 1000);
  assert.deepEqual(kept(storage), [], 'nothing is saved before an account is known');
  c.setSnapshotAccount('account-a', storage, 1000);
  write(c, 'navigation', [{uuid: 'a'}], storage, 1000);
  write(c, 'overview', [{uuid: 'a'}], storage, 1000);
  assert.deepEqual(c.readAccountSnapshot('navigation', storage, 2000), [{uuid: 'a'}]);
  storage.setItem('voltra.game-library.v1.account-a', 'kept');
  c.setSnapshotAccount('account-b', storage, 2000);
  assert.equal(c.readAccountSnapshot('navigation', storage, 2000), undefined);
  assert.deepEqual(copies(storage), ['voltra.game-library.v1.account-a'], 'another account removes the copies, and only the copies');
  assert.equal(storage.values.get(owner), 'account-b');
});

test('signing out removes every copy and stops further saving', () => {
  const storage = memory();
  c.setSnapshotAccount('account-a', storage, 1000);
  write(c, 'navigation', [1], storage, 1000);
  c.clearAccountSnapshots(storage);
  assert.deepEqual(kept(storage), [], 'the copies and the owner are gone');
  write(c, 'navigation', [2], storage, 1000);
  assert.deepEqual(kept(storage), []);
  assert.equal(c.readAccountSnapshot('navigation', storage, 1000), undefined);
});

test('an answer is saved only for the account that asked for it', () => {
  const storage = memory();
  c.setSnapshotAccount('account-a', storage, 1000);
  const asked = c.snapshotOwner();
  c.writeAccountSnapshot('navigation', ['for a'], asked, storage, 1000);
  assert.deepEqual(c.readAccountSnapshot('navigation', storage, 1000), ['for a']);
  // The account changes while a request is in flight; its answer arrives late.
  c.setSnapshotAccount('account-b', storage, 1000);
  c.writeAccountSnapshot('navigation', ['asked as a'], asked, storage, 1000);
  assert.deepEqual(copies(storage), [], 'a late answer is not saved for the next account');
  c.setSnapshotAccount('account-a', storage, 1000);
  c.writeAccountSnapshot('navigation', ['asked before a signed out'], asked, storage, 1000);
  assert.deepEqual(copies(storage), [], 'nor for the same account after it has been away');
  c.clearAccountSnapshots(storage);
  assert.equal(c.snapshotOwner(), undefined);
});

test('an account answer names the owner only if nobody signed out or in while it travelled', async () => {
  const storage = memory();
  c.clearAccountSnapshots(storage);

  // The ordinary case: nothing changed between asking and the answer.
  let started = c.snapshotRevision(storage);
  assert.equal(await c.identifySnapshotAccount('account-a', started, storage, 1000), true);
  assert.equal(storage.values.get(owner), 'account-a');
  write(c, 'navigation', ['a'], storage, 1000);

  // Asked as A, then a sign-out: the late answer must not sign A back in.
  started = c.snapshotRevision(storage);
  c.clearAccountSnapshots(storage);
  assert.equal(await c.identifySnapshotAccount('account-a', started, storage, 1000), false, 'a sign-out alone changes the revision');
  assert.equal(storage.values.has(owner), false);
  write(c, 'navigation', ['late'], storage, 1000);
  assert.deepEqual(copies(storage), []);

  // Asked before anyone was known, then a sign-out and another account.
  started = c.snapshotRevision(storage);
  c.clearAccountSnapshots(storage);
  c.setSnapshotAccount('account-b', storage, 1000);
  write(c, 'navigation', ['b'], storage, 1000);
  assert.equal(await c.identifySnapshotAccount('account-a', started, storage, 1000), false);
  assert.equal(storage.values.get(owner), 'account-b', "the late answer does not take B's store");
  assert.deepEqual(copies(storage), ['voltra.snapshot.v1.navigation.account-b'], "nor remove B's copies");

  // A late answer that agrees with the store is simply right.
  assert.equal(await c.identifySnapshotAccount('account-b', started, storage, 1000), true);
  assert.deepEqual(c.readAccountSnapshot('navigation', storage, 1000), ['b']);
  // An answer whose starting point is unknown is held to the same test.
  assert.equal(await c.identifySnapshotAccount('account-a', undefined, storage, 1000), false);
  assert.equal(await c.identifySnapshotAccount('account-b', undefined, storage, 1000), true);
  assert.equal(await c.identifySnapshotAccount('', c.snapshotRevision(storage), storage, 1000), false);
  c.clearAccountSnapshots(storage);
});

test('a request that began while nobody was identified saves nothing, whoever is signed in when it ends', () => {
  const storage = memory();
  // Tab one shows A's sidebar when another tab switches to B: it forgets A,
  // and its next poll starts with no owner and is answered for B.
  c.setSnapshotAccount('account-a', storage, 1000);
  storage.setItem(owner, 'account-b');
  assert.equal(c.readAccountSnapshot('navigation', storage, 1000), undefined);
  const askedAsNobody = c.snapshotOwner();
  assert.equal(askedAsNobody, undefined);
  // While that answer is on its way the other tab signs back in as A, and
  // this tab identifies A again.
  c.clearAccountSnapshots(storage);
  c.setSnapshotAccount('account-a', storage, 1000);
  assert.notEqual(c.snapshotOwner(), undefined);
  // The answer, which is B's list, arrives.
  c.writeAccountSnapshot('navigation', [{uuid: 'b-server', identifier: 'b', name: "B's server"}], askedAsNobody, storage, 1000);
  assert.deepEqual(copies(storage), [], "B's list is not filed under A");
  assert.equal(c.readAccountSnapshot('navigation', storage, 1000), undefined);
  // The overview keeps the same rule: it notes its owner once, when its reads begin.
  c.clearAccountSnapshots(storage);
});

test('old, future, damaged and oversized copies only lose the head start', () => {
  const storage = memory();
  c.setSnapshotAccount('account-a', storage, 1000);
  const key = 'voltra.snapshot.v1.navigation.account-a';
  write(c, 'navigation', [1], storage, 1000);
  assert.equal(c.readAccountSnapshot('navigation', storage, 1000 + week), undefined, 'an expired copy is not used');
  // Reading removes nothing: it runs outside the lock, and a copy another tab
  // has just saved under the same key must not be lost to a reader that
  // looked a moment too early.
  assert.equal(storage.values.has(key), true);
  write(c, 'navigation', [1], storage, 5000);
  assert.equal(c.readAccountSnapshot('navigation', storage, 4000), undefined, 'a copy from the future is not trusted');
  storage.setItem(key, 'not json');
  assert.equal(c.readAccountSnapshot('navigation', storage, 1000), undefined, 'a damaged copy is not used');
  assert.equal(storage.values.has(key), true, 'and is left for the cleanup that holds the lock');
  write(c, 'navigation', [1], storage, 1000);
  write(c, 'navigation', 'x'.repeat(600 * 1024), storage, 1000);
  assert.equal(storage.values.has(key), false, 'an oversized value replaces nothing and leaves nothing stale');

  // Identifying the account again also clears what is too old or unreadable, read or not.
  write(c, 'navigation', [1], storage, 1000);
  write(c, 'overview', [1], storage, 1000 + week - 10);
  storage.setItem('voltra.snapshot.v1.other.account-a', 'not json');
  c.setSnapshotAccount('account-a', storage, 1000 + week);
  assert.deepEqual(copies(storage), ['voltra.snapshot.v1.overview.account-a']);

  const blocked = {get length() { throw new Error('blocked'); }, key() { throw new Error('blocked'); }, getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); }};
  assert.doesNotThrow(() => c.setSnapshotAccount('account-a', blocked));
  assert.doesNotThrow(() => write(c, 'navigation', [1], blocked));
  assert.equal(c.readAccountSnapshot('navigation', blocked), undefined);
  assert.equal(c.readAccountSnapshot('navigation', undefined), undefined);
});

test('a saved list is used only when every record has the fields the page reads', () => {
  const storage = memory();
  c.setSnapshotAccount('account-a', storage, 1000);
  const server = {uuid: 'u1', identifier: 's1', name: 'Survival', favorite: true};
  write(c, 'navigation', [server], storage, 1000);
  assert.deepEqual(c.readSavedList('navigation', ['uuid', 'identifier', 'name'], storage, 1000), [server]);
  for (const damaged of [[server, {uuid: 'u2', identifier: 's2'}], [server, null], [server, 'text'], {uuid: 'u1'}, 'text', null, [{...server, name: 7}]]) {
    write(c, 'navigation', damaged, storage, 1000);
    assert.equal(c.readSavedList('navigation', ['uuid', 'identifier', 'name'], storage, 1000), undefined, JSON.stringify(damaged));
  }
  write(c, 'navigation', [], storage, 1000);
  assert.deepEqual(c.readSavedList('navigation', ['uuid'], storage, 1000), [], 'an account with no servers has an empty list, not a missing one');
});

test('only what a card or the sidebar draws is saved, whatever the panel sends', () => {
  const secret = 'SENTINEL-SECRET';
  // A detailed server answer, as an older or different panel might send for the list.
  const detailed = {
    uuid: 'u1', identifier: 's1', name: 'Survival', description: 'Friends', node: 'home', status: null, is_installing: false,
    limits: {cpu: 200, memory: 4096, disk: 10240, swap: 0, io: 500, oom_disabled: secret},
    game: 'minecraft', egg_name: 'Paper', docker_image: 'ghcr.io/example/java:21',
    artwork: {game: 'minecraft', server_icon: '/api/client/servers/u1/artwork/icon', pack_name: 'Pack', token: secret},
    invocation: `java -jar server.jar --token ${secret}`, sftp_details: {ip: secret, port: 2022}, internal_id: secret, server_owner: true,
    resources: {cpu_absolute: 42}, resourceError: false, liveState: 'running', favorite: true, last_visited_at: '2026-11-19T08:00:00Z',
    relationships: {
      allocations: {data: [{attributes: {ip: secret, port: 25565}}]},
      variables: {data: [
        {attributes: {env_variable: 'MINECRAFT_LOADER', server_value: 'paper', default_value: secret, description: secret}},
        {attributes: {env_variable: 'STEAM_APP_ID', server_value: '896660'}},
        {attributes: {env_variable: 'APP_ID', server_value: `1; ${secret}`}},
        {attributes: {env_variable: 'RCON_PASSWORD', server_value: secret}},
        {attributes: {env_variable: 'MINECRAFT_LOADER', server_value: secret}},
      ]},
    },
  };
  const card = c.savedServerCard(detailed);
  assert.ok(!JSON.stringify(card).includes(secret), JSON.stringify(card));
  assert.deepEqual(JSON.parse(JSON.stringify(card)), {
    uuid: 'u1', identifier: 's1', name: 'Survival', description: 'Friends', node: 'home', status: null, is_installing: false,
    limits: {cpu: 200, memory: 4096, disk: 10240}, game: 'minecraft', egg_name: 'Paper', docker_image: 'ghcr.io/example/java:21',
    artwork: {game: 'minecraft', server_icon: '/api/client/servers/u1/artwork/icon', pack_name: 'Pack'},
    relationships: {variables: {data: [{attributes: {env_variable: 'MINECRAFT_LOADER', server_value: 'paper'}}, {attributes: {env_variable: 'STEAM_APP_ID', server_value: '896660'}}]}},
  });
  const entry = c.savedNavigationEntry(detailed);
  assert.ok(!JSON.stringify(entry).includes(secret), JSON.stringify(entry));
  assert.deepEqual(JSON.parse(JSON.stringify(entry)), {uuid: 'u1', identifier: 's1', name: 'Survival', egg_name: 'Paper', artwork: {game: 'minecraft', server_icon: '/api/client/servers/u1/artwork/icon', pack_name: 'Pack'}, status: null, favorite: true, last_visited_at: '2026-11-19T08:00:00Z'});
  assert.doesNotThrow(() => { c.savedServerCard(null); c.savedServerCard({relationships: {variables: {data: [null, 'text']}}}); c.savedNavigationEntry(undefined); });
});

test('the sidebar is saved when it changes, not every time it is read again', () => {
  const storage = memory();
  const restore = useStorage(storage);
  try {
    c.setSnapshotAccount('account-a');
    const key = 'voltra.snapshot.v1.navigation.account-a';
    const servers = [{uuid: 'u1', identifier: 's1', name: 'Survival', favorite: true, internal: 'dropped'}];
    c.saveNavigation(servers, c.snapshotOwner(), 1000);
    const first = storage.values.get(key);
    assert.deepEqual(JSON.parse(first).value, [{uuid: 'u1', identifier: 's1', name: 'Survival', status: null, favorite: true, last_visited_at: null}]);
    // The same list a minute later: on the desktop every save is sent to the host, so none is made.
    c.saveNavigation(servers, c.snapshotOwner(), 61_000);
    assert.equal(storage.values.get(key), first);
    c.saveNavigation([{...servers[0], favorite: false}], c.snapshotOwner(), 62_000);
    assert.equal(JSON.parse(storage.values.get(key)).value[0].favorite, false, 'a change is saved');
    // Unchanged for a day: saved again, so the copy does not grow too old to use.
    const second = storage.values.get(key);
    c.saveNavigation([{...servers[0], favorite: false}], c.snapshotOwner(), 62_000 + 24 * 60 * 60 * 1000);
    assert.notEqual(storage.values.get(key), second);
    // A request that began with nobody identified saves nothing.
    storage.values.delete(key);
    c.saveNavigation([{...servers[0], name: 'Other'}], undefined, 62_000);
    assert.equal(storage.values.has(key), false);
  } finally {
    c.clearAccountSnapshots();
    restore();
  }
});

test('the overview list is saved without live readings and restored as being checked', t => {
  const storage = memory();
  const restore = useStorage(storage);
  t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: 1_000_000});
  try {
    c.setQueryCacheScope('overview-a');
    c.setSnapshotAccount('account-a');
    const epoch = c.queryCacheEpoch();
    const servers = [
      {uuid: 'u1', name: 'Survival', status: null, liveState: 'running', resources: {cpu_absolute: 42}, resourceError: false},
      {uuid: 'u2', name: 'Creative', status: 'suspended', liveState: 'suspended'},
      {uuid: 'u3', name: 'New', status: null, is_installing: true, liveState: 'installing'},
    ];
    const renamed = [{...servers[0], name: 'Renamed'}, ...servers.slice(1)];
    const asked = c.snapshotOwner();
    c.writeOverviewSnapshot(servers, epoch, asked);
    const key = 'voltra.snapshot.v1.overview.account-a';
    const first = storage.values.get(key);
    assert.deepEqual(JSON.parse(first).value.map(s => [s.uuid, s.name, s.status, s.is_installing, s.resources, s.liveState]), [['u1', 'Survival', null, false, undefined, undefined], ['u2', 'Creative', 'suspended', false, undefined, undefined], ['u3', 'New', null, true, undefined, undefined]]);
    assert.equal(c.readOverviewSnapshot(), servers, 'a recent in-memory view still wins');

    // Readings change every second; the saved list follows at its own pace
    // and always ends on the latest list.
    t.mock.timers.tick(1000);
    c.writeOverviewSnapshot(renamed, epoch, asked);
    assert.equal(storage.values.get(key), first, 'saves are spaced out');
    t.mock.timers.tick(8999);
    assert.equal(storage.values.get(key), first);
    t.mock.timers.tick(1);
    assert.equal(JSON.parse(storage.values.get(key)).value[0].name, 'Renamed', 'the latest list is saved when the interval ends');
    const second = storage.values.get(key);
    t.mock.timers.tick(10_000);
    c.writeOverviewSnapshot(renamed.map(s => ({...s, resources: {cpu_absolute: 7}})), epoch, asked);
    assert.equal(storage.values.get(key), second, 'an unchanged list is not rewritten');
    // A list is waiting to be saved when the overview is left and reopened.
    // The reopened page first publishes the list it restored, which has no
    // owner; that must not displace the save that is waiting.
    t.mock.timers.tick(1000);
    const again = [{...servers[0], name: 'Renamed again'}, ...servers.slice(1)];
    c.writeOverviewSnapshot(again, epoch, asked);
    c.writeOverviewSnapshot(again, epoch, undefined);
    assert.equal(c.readOverviewSnapshot(), again, 'the restored list is still what the page shows');
    t.mock.timers.tick(10_000);
    assert.equal(JSON.parse(storage.values.get(key)).value[0].name, 'Renamed again', 'the waiting save was still made');
    c.writeOverviewSnapshot(renamed, epoch, asked);
    t.mock.timers.tick(10_000);
    c.writeOverviewSnapshot(renamed, epoch, asked);
    // Unless it has been a day: a page left open must not let its copy grow too old to use.
    const settled = storage.values.get(key);
    t.mock.timers.tick(24 * 60 * 60 * 1000);
    c.writeOverviewSnapshot(renamed, epoch, asked);
    assert.notEqual(storage.values.get(key), settled, 'an unchanged list is saved again after a day');
    assert.equal(JSON.parse(storage.values.get(key)).value[0].name, 'Renamed');

    // After a restart only the saved list exists.
    t.mock.timers.tick(300_001);
    assert.deepEqual(c.readOverviewSnapshot().map(s => [s.name, s.liveState, s.resources]), [['Renamed', 'unknown', undefined], ['Creative', 'suspended', undefined], ['New', 'installing', undefined]]);
    storage.setItem(key, JSON.stringify({at: Date.now(), value: [{name: 'no uuid'}]}));
    assert.equal(c.readOverviewSnapshot(), undefined, 'a copy of the wrong shape is ignored');

    // A list queued for the previous session is never saved for the next one.
    c.writeOverviewSnapshot(servers, epoch, asked);
    c.writeOverviewSnapshot(renamed, epoch, asked);
    c.setQueryCacheScope('overview-b');
    c.setSnapshotAccount('account-b');
    assert.equal(c.readOverviewSnapshot(), undefined, 'nothing crosses to the next account');
    t.mock.timers.tick(20_000);
    c.writeOverviewSnapshot(servers, epoch, asked);
    assert.deepEqual(copies(storage), [], 'late writes from the previous session are dropped');
  } finally {
    t.mock.timers.reset();
    c.clearAccountSnapshots();
    restore();
  }
});

test('the overview list is never saved for an account identified after it was read', t => {
  const storage = memory();
  const restore = useStorage(storage);
  t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: 5_000_000});
  try {
    c.setQueryCacheScope('overview-reader');
    c.setSnapshotAccount('account-a');
    const epoch = c.queryCacheEpoch();
    const asked = c.snapshotOwner(); // the overview asks for its list as account A
    // Another account is identified before this page has noticed anything.
    c.setSnapshotAccount('account-b');
    c.writeOverviewSnapshot([{uuid: 'u1', name: "A's server"}], epoch, asked);
    assert.deepEqual(copies(storage), [], "A's list is not filed under B");
    // A list restored from a saved copy, never asked for, has no owner and is not saved again.
    t.mock.timers.tick(10_000);
    c.writeOverviewSnapshot([{uuid: 'u1', name: 'Restored'}], epoch, undefined);
    assert.deepEqual(copies(storage), []);
    // Once this page asks again, as B, the list it gets is B's and is saved.
    t.mock.timers.tick(10_000);
    c.writeOverviewSnapshot([{uuid: 'u2', name: "B's server"}], epoch, c.snapshotOwner());
    assert.deepEqual(copies(storage), ['voltra.snapshot.v1.overview.account-b'], 'a re-identified page saves again without a reload');
  } finally {
    t.mock.timers.reset();
    c.clearAccountSnapshots();
    restore();
  }
});

test('a rejected session and a sign-out end the saved copies, the note and the early answers', async () => {
  const storage = memory();
  const restore = useStorage(storage);
  const oldWindow = globalThis.window;
  globalThis.window = new EventTarget();
  try {
    // An instance loaded with a window registers the app's listeners.
    const page = await load('with window');
    for (const event of ['desktop-session-rejected', 'panel-auth-changed']) {
      page.setSnapshotAccount('account-a');
      write(page, 'overview', [{uuid: 'u1'}]);
      storage.setItem('voltra.signed-in', '1');
      assert.ok(storage.values.has('voltra.snapshot.v1.overview.account-a'));
      globalThis.__voltraBoot = {at: 0, take() {}};
      window.dispatchEvent(new Event(event));
      assert.deepEqual(kept(storage), [], `${event} removes the copies, their owner and the signed-in note`);
      assert.equal(globalThis.__voltraBoot, undefined, `${event} drops unused early answers`);
      write(page, 'overview', [{uuid: 'u1'}]);
      assert.deepEqual(kept(storage), [], 'and nothing is saved until an account is identified again');
    }
  } finally {
    globalThis.window = oldWindow;
    delete globalThis.__voltraBoot;
    restore();
  }
});

test('two tabs share one store: a tab left on the previous account can neither save nor read', async () => {
  const storage = memory();
  const restore = useStorage(storage);
  const oldWindow = globalThis.window;
  try {
    // Each tab has its own window and its own idea of who is signed in.
    globalThis.window = new EventTarget();
    const one = await load('tab one');
    const windowOne = globalThis.window;
    globalThis.window = new EventTarget();
    const two = await load('tab two');
    const windowTwo = globalThis.window;
    const keyA = 'voltra.snapshot.v1.navigation.account-a';

    one.setSnapshotAccount('account-a');
    two.setSnapshotAccount('account-a');
    write(two, 'navigation', [{uuid: 'a-server'}]);
    assert.deepEqual(one.readAccountSnapshot('navigation'), [{uuid: 'a-server'}], 'tabs of one account share its copies');

    // Tab one signs out. Tab two has not noticed; its next poll runs with no session.
    const askedAsA = two.snapshotOwner();
    windowOne.dispatchEvent(new Event('panel-auth-changed'));
    assert.deepEqual(kept(storage), []);
    two.writeAccountSnapshot('navigation', [{uuid: 'anything'}], askedAsA);
    assert.deepEqual(kept(storage), [], 'a tab cannot save once its account signed out elsewhere');

    // Tab one signs in as B. Tab two still believes in A and polls with B's session.
    two.setSnapshotAccount('account-a');
    const staleOwner = two.snapshotOwner();
    one.setSnapshotAccount('account-b');
    two.writeAccountSnapshot('navigation', [{uuid: 'b-server', name: 'B only'}], staleOwner);
    write(two, 'navigation', [{uuid: 'b-server', name: 'B only'}]);
    assert.equal(storage.values.has(keyA), false, "B's list is never saved under A's name");
    assert.equal(two.readAccountSnapshot('navigation'), undefined, 'and the stale tab reads nothing');
    assert.equal(two.snapshotOwner(), undefined, 'until it identifies the account again');

    // An account answer that tab two asked for as A arrives only now, after
    // tab one signed out and B signed in. It must not hand the store back to A.
    one.clearAccountSnapshots();
    two.setSnapshotAccount('account-a');
    const askedBeforeTheSwitch = two.snapshotRevision();
    windowOne.dispatchEvent(new Event('panel-auth-changed'));
    await one.identifySnapshotAccount('account-b', one.snapshotRevision());
    write(one, 'navigation', [{uuid: 'b-server'}]);
    assert.equal(await two.identifySnapshotAccount('account-a', askedBeforeTheSwitch), false, 'the late answer is refused');
    assert.equal(storage.values.get(owner), 'account-b');
    assert.deepEqual(one.readAccountSnapshot('navigation'), [{uuid: 'b-server'}], "B's copies survive it");
    write(two, 'navigation', [{uuid: 'b-server', name: 'polled with the session of B'}]);
    assert.equal(storage.values.has(keyA), false, "and tab two still cannot file B's list under A");

    // The browser also tells the other tab; it then stops at once.
    two.setSnapshotAccount('account-b');
    write(two, 'navigation', [{uuid: 'b-server'}]);
    one.setSnapshotAccount('account-c');
    globalThis.__voltraBoot = {at: performance.now(), revision: null, take() {}, cancel() {}};
    windowTwo.dispatchEvent(Object.assign(new Event('storage'), {key: owner, newValue: 'account-c'}));
    assert.equal(two.snapshotOwner(), undefined);
    assert.ok(globalThis.__voltraBoot, 'the owner key alone does not end early answers');
    windowTwo.dispatchEvent(Object.assign(new Event('storage'), {key: revision, newValue: 'next'}));
    assert.equal(globalThis.__voltraBoot, undefined, 'a sign-out or sign-in in another tab ends the early answers held here');
    windowTwo.dispatchEvent(Object.assign(new Event('storage'), {key: 'voltra.unrelated', newValue: null}));
    one.clearAccountSnapshots();
  } finally {
    globalThis.window = oldWindow;
    restore();
  }
});

test('a tab that finds another account signed in lets go without taking the copies of the next account', () => {
  const storage = memory();
  // Nobody signed out here, but the session is someone else's now. If the
  // store still names this tab's account, it is emptied.
  c.setSnapshotAccount('account-a', storage, 1000);
  write(c, 'navigation', ['a'], storage, 1000);
  c.releaseSnapshotAccount(storage);
  assert.deepEqual(kept(storage), [], 'the copies of the account that is gone are removed');
  assert.equal(c.snapshotOwner(), undefined);

  // If another tab has already identified the next account, the store is theirs.
  c.setSnapshotAccount('account-a', storage, 1000);
  storage.setItem(owner, 'account-b');
  storage.setItem('voltra.snapshot.v1.navigation.account-b', JSON.stringify({at: 1000, value: ['b']}));
  c.releaseSnapshotAccount(storage);
  assert.equal(c.snapshotOwner(), undefined, 'this tab stops saving');
  assert.equal(storage.values.get(owner), 'account-b');
  assert.deepEqual(copies(storage), ['voltra.snapshot.v1.navigation.account-b'], "and leaves the next account's copies alone");
  c.releaseSnapshotAccount(storage);
  assert.deepEqual(copies(storage), ['voltra.snapshot.v1.navigation.account-b'], 'a tab that believes in no one changes nothing');
  storage.values.clear();
});

test('a browser that cannot serialize changes to shared storage keeps nothing in it', async () => {
  const storage = memory();
  const restore = useStorage(storage);
  const page = await load('no locks');
  // A panel served over plain HTTP on a LAN address: no Web Locks.
  page.setSnapshotLocks(undefined);
  try {
    assert.equal(await page.identifySnapshotAccount('account-a', page.snapshotRevision()), false, 'nobody is named');
    page.setSnapshotAccount('account-a');
    write(page, 'navigation', [{uuid: 'u1', identifier: 's1', name: 'Never saved'}]);
    page.writeOverviewSnapshot([{uuid: 'u1', name: 'Never saved'}], page.queryCacheEpoch(), page.snapshotOwner());
    assert.equal(storage.values.size, 0, 'nothing reaches the shared storage');
    assert.equal(page.savedNavigation(), undefined);
    storage.setItem(owner, 'account-a');
    storage.setItem('voltra.snapshot.v1.navigation.account-a', JSON.stringify({at: Date.now(), value: [{uuid: 'u1', identifier: 's1', name: 'Left by an earlier build'}]}));
    assert.equal(page.savedNavigation(), undefined, 'and nothing is read from it');

    // Other tabs still judge their early answers by the revision, so a
    // sign-out moves it even though no copies exist here.
    storage.values.clear();
    page.forgetSignedInAccount();
    const moved = storage.values.get(revision);
    assert.ok(moved, 'a sign-out is announced to other tabs without a lock');
    assert.deepEqual(kept(storage), []);

    // A sign-in over a session that is still live has the same duty, and a
    // store too full to take a new value still gives up the old one.
    page.moveSessionRevision();
    assert.notEqual(storage.values.get(revision), moved, 'a sign-in is announced too');
    const full = {getItem: () => 'old', setItem() { throw new Error('quota'); }, removed: [], removeItem(key) { this.removed.push(key); }};
    const restoreFull = useStorage(full);
    page.moveSessionRevision();
    restoreFull();
    useStorage(storage);
    assert.deepEqual(full.removed, [revision]);
    const announced = storage.values.get(revision);

    // And a page that began loading under the previous account, in another
    // tab, does not use the answers it asked for before that sign-out. Its
    // bundle only starts now, so it never saw the change happen.
    const loading = await load('still loading, no locks');
    loading.setSnapshotLocks(undefined);
    const asked = new Response('{"attributes":{"uuid":"account-a"}}', {status: 200, headers: {'content-type': 'application/json'}});
    const cancelled = [];
    globalThis.__voltraBoot = {at: performance.now(), revision: announced, take: () => Promise.resolve(asked), cancel: () => cancelled.push(1)};
    page.forgetSignedInAccount(); // tab two signs out again, through the app
    assert.notEqual(storage.values.get(revision), announced);
    assert.equal(await loading.takeBootRead('/api/client/account'), undefined, 'the previous account is not drawn under the next session');
    assert.equal(globalThis.__voltraBoot, undefined);
    assert.equal(cancelled.length, 1);

    // The desktop app's own store belongs to one page and needs no lock.
    const sent = [];
    await page.loadDesktopSnapshots(async (path, options = {}) => { sent.push(options.method || 'GET'); return new Response('{"connection":"c","entries":{}}'); }, 0);
    assert.equal(await page.identifySnapshotAccount('account-a', page.snapshotRevision()), true);
    write(page, 'navigation', [{uuid: 'u1', identifier: 's1', name: 'Kept by the host'}]);
    assert.equal(page.savedNavigation()[0].name, 'Kept by the host');
  } finally {
    page.clearAccountSnapshots();
    page.setSnapshotStore(null);
    restore();
  }
});

test('a lock the browser never grants does not keep the page waiting', async t => {
  const storage = memory();
  const restore = useStorage(storage);
  const page = await load('withheld lock');
  page.setSnapshotLocks({request: () => new Promise(() => {})});
  t.mock.timers.enable({apis: ['setTimeout']});
  try {
    const identified = page.identifySnapshotAccount('account-a', null);
    let settled = false;
    identified.then(() => { settled = true; });
    await settle();
    assert.equal(settled, false, 'it waits its turn at first');
    t.mock.timers.tick(2000);
    assert.equal(await identified, false, 'then goes on without the saved pages');
    assert.equal(storage.values.size, 0);
  } finally {
    t.mock.timers.reset();
    restore();
  }
});

test('the same account signed in again after someone else is a different session', async () => {
  const storage = memory();
  const restore = useStorage(storage);
  const b = [{uuid: 'b-server', identifier: 'b', name: "B's server"}];
  try {
    for (const reidentifies of [false, true]) {
      storage.values.clear();
      const one = await load(`suspended tab ${reidentifies}`);
      const two = await load(`busy tab ${reidentifies}`);
      // Tab one has identified A and asks for its sidebar. The answer is slow.
      await one.identifySnapshotAccount('account-a', one.snapshotRevision());
      await two.identifySnapshotAccount('account-a', two.snapshotRevision());
      const asked = one.snapshotOwner();
      assert.notEqual(asked, undefined);
      // Tab one is suspended and hears nothing of what follows. In tab two A
      // signs out and B signs in, so tab one's request is answered for B. Then
      // B signs out and A signs back in.
      two.forgetSignedInAccount();
      await two.identifySnapshotAccount('account-b', two.snapshotRevision());
      two.forgetSignedInAccount();
      await two.identifySnapshotAccount('account-a', two.snapshotRevision());
      assert.equal(storage.values.get(owner), 'account-a', 'the store names A again');
      // Tab one wakes up. Whether or not it reads its account again first,
      // the answer it asked for in the earlier session is B's and is not saved.
      if (reidentifies) assert.equal(await one.identifySnapshotAccount('account-a', one.snapshotRevision()), true);
      one.writeAccountSnapshot('navigation', b, asked);
      one.saveNavigation(b, asked);
      assert.deepEqual(copies(storage), [], `B's sidebar is not filed under A (re-identified first: ${reidentifies})`);
      if (!reidentifies) {
        assert.equal(one.readAccountSnapshot('navigation'), undefined, 'and a tab still in the earlier session reads nothing');
        assert.equal(one.snapshotOwner(), undefined);
      }
      // A fresh page that identifies A finds nothing of B's.
      const fresh = await load(`fresh tab ${reidentifies}`);
      await fresh.identifySnapshotAccount('account-a', fresh.snapshotRevision());
      assert.equal(fresh.savedNavigation(), undefined);
      // What the reawakened tab asks for from now on is A's, and is saved.
      if (reidentifies) {
        one.writeAccountSnapshot('navigation', [{uuid: 'a-server', identifier: 'a', name: "A's server"}], one.snapshotOwner());
        assert.equal(fresh.savedNavigation()[0].name, "A's server");
      }
      fresh.clearAccountSnapshots();
    }
  } finally {
    restore();
  }
});

test('changes to the shared store are made one at a time across tabs', async () => {
  const storage = memory();
  const restore = useStorage(storage);
  // One lock manager for both tabs, as a browser has: each change waits its
  // turn and then runs whole, so a check and the change that depends on it
  // cannot be separated by the other tab.
  const queue = [];
  const locks = {request: (name, change) => new Promise(resolve => queue.push(() => resolve(change())))};
  const turn = async () => { queue.shift()(); await settle(); };
  try {
    const one = await load('locked tab one');
    const two = await load('locked tab two');
    one.setSnapshotLocks(locks);
    two.setSnapshotLocks(locks);

    // Tab two asked for the account as A. Its answer arrives while tab one
    // signs out and B signs in. Wherever the late answer takes its turn among
    // those two changes, the store ends up naming B and nothing of B's is
    // filed under A.
    for (const lateTurn of [0, 1, 2]) {
      queue.length = 0;
      storage.values.clear();
      one.setSnapshotAccount('account-a');
      two.setSnapshotAccount('account-a');
      const started = two.snapshotRevision();
      const results = {};
      const steps = [
        () => one.clearAccountSnapshots(),
        // B's own account read begins after the sign-out, under the revision of that moment.
        () => { results.b = one.identifySnapshotAccount('account-b', one.snapshotRevision()); },
      ];
      steps.splice(lateTurn, 0, () => { results.late = two.identifySnapshotAccount('account-a', started); });
      for (const step of steps) {
        step();
        while (queue.length) await turn();
      }
      assert.equal(await results.b, true, `B is identified (late answer in turn ${lateTurn})`);
      assert.equal(storage.values.get(owner), 'account-b', `the store names B (late answer in turn ${lateTurn})`);
      // Before the sign-out the answer was simply true; after it, it is refused.
      assert.equal(await results.late, lateTurn === 0, `late answer in turn ${lateTurn}`);
      two.writeAccountSnapshot('navigation', [{uuid: 'b-server'}], two.snapshotOwner() ?? 0);
      while (queue.length) await turn();
      assert.deepEqual(copies(storage), [], `nothing is filed by the stale tab (late answer in turn ${lateTurn})`);
    }

    // A sign-out's change is still waiting its turn when the next account read
    // begins. The read takes its starting point in turn, behind that change,
    // so the answer is not mistaken for one that predates the sign-out.
    queue.length = 0;
    storage.values.clear();
    one.setSnapshotAccount('account-a');
    one.clearAccountSnapshots();
    const startsAfterSignOut = one.snapshotRevisionInTurn();
    assert.equal(queue.length, 2, 'both wait their turn');
    while (queue.length) await turn();
    const next = one.identifySnapshotAccount('account-b', await startsAfterSignOut);
    while (queue.length) await turn();
    assert.equal(await next, true, 'the account signed in right after a sign-out is identified');
    assert.equal(storage.values.get(owner), 'account-b');

    // A save decided before another tab's sign-out is not carried out after it.
    queue.length = 0;
    storage.values.clear();
    const identified = one.identifySnapshotAccount('account-a', one.snapshotRevision());
    await turn();
    assert.equal(await identified, true);
    one.writeAccountSnapshot('overview', [{uuid: 'u1'}], one.snapshotOwner());
    two.clearAccountSnapshots();
    assert.deepEqual(copies(storage), [], 'the save has not happened yet');
    while (queue.length) await turn();
    assert.deepEqual(kept(storage), [], 'the sign-out, next in line, removed what the save had just written');
  } finally {
    restore();
  }
});

test('a desktop start the host could not vouch for saves nothing until its pages are handed over', async t => {
  const storage = memory();
  const restore = useStorage(storage);
  t.mock.timers.enable({apis: ['setTimeout']});
  const now = Date.now();
  const copy = (value, at = now) => JSON.stringify({at, value});
  // What the host kept from earlier launches: pages of this account the page
  // has not opened yet in this one, one it has, one too old, and another account's.
  const held = {
    'voltra.snapshot-owner': 'account-a', 'voltra.snapshot-session': 'an-earlier-launch',
    'voltra.snapshot.v1.navigation.account-a': copy([{uuid: 'u1', identifier: 's1', name: 'Kept by the host'}]),
    'voltra.snapshot.v1.catalog.account-a': copy({games: ['kept']}),
    'voltra.snapshot.v1.overview.account-a': copy([{uuid: 'old'}], now - week - 1),
    'voltra.snapshot.v1.navigation.account-b': copy([{uuid: 'b1', identifier: 'sb', name: 'Someone else'}]),
  };
  let accepted = false;
  const requests = [];
  const host = async (path, options = {}) => {
    requests.push({method: options.method || 'GET', body: options.body});
    if (options.method === 'POST') return new Response('{"saved":true}');
    // Until the panel has accepted the connection the host hands over nothing
    // and names nothing to save under.
    return new Response(JSON.stringify(accepted ? {connection: 'connection-1', entries: held} : {pending: true, entries: {}}));
  };
  const posts = () => requests.filter(request => request.method === 'POST');
  const pass = async () => { t.mock.timers.tick(500); await settle(); await settle(); await settle(); };
  try {
    await c.loadDesktopSnapshots(host, 500);
    assert.equal(c.savedNavigation(), undefined, 'nothing is drawn from pages that were not handed over');
    // The panel answers the page; the host has not caught up yet.
    c.setSnapshotAccount('account-a');
    write(c, 'navigation', [{uuid: 'u2', identifier: 's2', name: 'From the panel'}]);
    await pass();
    assert.equal(requests.length, 2, 'the page asks again when it has something to save');
    assert.deepEqual(posts(), [], 'and saves nothing over pages it has not been shown');

    accepted = true;
    write(c, 'overview', [{uuid: 'u2'}]);
    await pass();
    assert.equal(posts().length, 1);
    const sent = JSON.parse(posts()[0].body);
    assert.equal(sent.connection, 'connection-1');
    assert.deepEqual(Object.keys(sent.entries).filter(key => key.startsWith('voltra.snapshot.v1.')).sort(), ['voltra.snapshot.v1.catalog.account-a', 'voltra.snapshot.v1.navigation.account-a', 'voltra.snapshot.v1.overview.account-a'], 'the usable copies of this account joined the store; those of another did not');
    assert.equal(JSON.parse(sent.entries['voltra.snapshot.v1.navigation.account-a']).value[0].name, 'From the panel', 'what the page saved in the meantime is the newer copy');
    assert.deepEqual(JSON.parse(sent.entries['voltra.snapshot.v1.overview.account-a']).value, [{uuid: 'u2'}], 'a copy too old to use is not brought back');
    assert.equal(sent.entries['voltra.snapshot-owner'], 'account-a');
    assert.notEqual(sent.entries['voltra.snapshot-session'], 'an-earlier-launch', 'the store keeps the revision the account was identified under');
    assert.deepEqual(c.readAccountSnapshot('catalog'), {games: ['kept']}, 'a page not opened yet still gets its head start');
    const asked = requests.length;
    write(c, 'overview', [{uuid: 'u3'}]);
    await pass();
    assert.equal(requests.length, asked + 1, 'after the hand-over a change is one save and no further asking');
    assert.equal(requests.at(-1).method, 'POST');
    c.clearAccountSnapshots();
    await pass();

    // A hand-over that arrives while nobody is identified brings nothing in
    // and gives nothing to save under.
    requests.length = 0;
    accepted = false;
    await c.loadDesktopSnapshots(host, 500);
    accepted = true;
    c.clearAccountSnapshots();
    await pass();
    assert.deepEqual(posts(), [], 'a store that names no one is not saved over what the host holds');
    assert.equal(c.readAccountSnapshot('catalog'), undefined);
    // Once the account is known, the next change completes it.
    c.setSnapshotAccount('account-a');
    await pass();
    assert.equal(posts().length, 1);
    assert.ok(JSON.parse(posts()[0].body).entries['voltra.snapshot.v1.catalog.account-a']);
    assert.deepEqual(kept(storage), [], 'nothing was written to the WebView storage');
    c.clearAccountSnapshots();
    await pass();

    // A host that could not be asked at first, or fails when asked again, is
    // asked again with the next change: only its answer settles the hand-over.
    requests.length = 0;
    accepted = true;
    const answers = ['dropped', 'pending', 500, 'garbled'];
    const flaky = async (path, options = {}) => {
      if (options.method === 'POST') return host(path, options);
      const answer = answers.shift();
      if (answer === undefined) return host(path, options);
      requests.push({method: 'GET', body: undefined});
      if (answer === 'dropped') throw new Error('connection reset');
      if (answer === 'pending') return new Response('{"pending":true,"entries":{}}');
      if (answer === 'garbled') return new Response('{"connection":');
      return new Response('{"error":"Could not read."}', {status: answer});
    };
    await c.loadDesktopSnapshots(flaky, 500);
    c.setSnapshotAccount('account-a');
    for (const name of ['one', 'two', 'three']) {
      write(c, 'overview', [{uuid: name}]);
      await pass();
      assert.deepEqual(posts(), [], `nothing is saved while the hand-over is owed (${name})`);
    }
    write(c, 'overview', [{uuid: 'four'}]);
    await pass();
    assert.equal(posts().length, 1, 'the hand-over completes once the host answers');
    assert.ok(JSON.parse(posts()[0].body).entries['voltra.snapshot.v1.catalog.account-a'], 'with the pages it kept');
    c.clearAccountSnapshots();
    await pass();

    // A copy the page threw away while the hand-over was owed is not replaced
    // by the older one the host kept: here a sidebar that outgrew the limit.
    requests.length = 0;
    accepted = false;
    await c.loadDesktopSnapshots(host, 500);
    c.setSnapshotAccount('account-a');
    write(c, 'navigation', [{uuid: 'u9', identifier: 's9', name: 'x'.repeat(600 * 1024)}]);
    accepted = true;
    write(c, 'overview', [{uuid: 'u9'}]);
    await pass();
    assert.equal(posts().length, 1);
    const afterDiscard = JSON.parse(posts()[0].body).entries;
    assert.equal(afterDiscard['voltra.snapshot.v1.navigation.account-a'], undefined, 'the sidebar that was too large to keep did not come back as the older one');
    assert.ok(afterDiscard['voltra.snapshot.v1.catalog.account-a'], 'the rest was handed over');
    assert.equal(c.savedNavigation(), undefined);
  } finally {
    c.clearAccountSnapshots();
    c.setSnapshotStore(null);
    t.mock.timers.reset();
    restore();
  }
});

test('the desktop app keeps its saved pages with the host, not in the WebView', async t => {
  const storage = memory();
  const restore = useStorage(storage);
  t.mock.timers.enable({apis: ['setTimeout']});
  const requests = [];
  const host = async (path, options = {}) => {
    requests.push({path, method: options.method || 'GET', body: options.body});
    if (options.method === 'POST') return new Response('{"saved":true}');
    return new Response(JSON.stringify({connection: 'connection-1', entries: {'voltra.snapshot-owner': 'account-a', 'voltra.snapshot-session': 'kept-by-the-host', 'voltra.snapshot.v1.navigation.account-a': JSON.stringify({at: Date.now(), value: [{uuid: 'u1', identifier: 's1', name: 'Saved'}]}), ignored: {not: 'text'}}}));
  };
  try {
    await c.loadDesktopSnapshots(host, 500);
    c.setSnapshotAccount('account-a');
    assert.deepEqual(c.savedNavigation(), [{uuid: 'u1', identifier: 's1', name: 'Saved'}], 'the first paint uses what the host kept');
    write(c, 'navigation', [{uuid: 'u2', identifier: 's2', name: 'Next'}]);
    write(c, 'overview', [{uuid: 'u2'}]);
    assert.equal(requests.length, 1, 'changes are gathered');
    t.mock.timers.tick(500);
    await settle();
    assert.equal(requests.length, 2);
    assert.equal(requests[1].method, 'POST');
    const sent = JSON.parse(requests[1].body);
    assert.equal(sent.connection, 'connection-1', 'a save names the connection the copies were read for');
    assert.deepEqual(Object.keys(sent.entries).sort(), ['voltra.snapshot-owner', 'voltra.snapshot-session', 'voltra.snapshot.v1.navigation.account-a', 'voltra.snapshot.v1.overview.account-a']);
    assert.ok(Object.values(sent.entries).every(value => typeof value === 'string'), 'the host stores text entries');
    c.clearAccountSnapshots();
    t.mock.timers.tick(500);
    await settle();
    assert.deepEqual(Object.keys(JSON.parse(requests.at(-1).body).entries), [revision], 'signing out empties the host copy too');
    assert.deepEqual(kept(storage), [], 'nothing was written to the WebView storage');

    // A host that refuses the new copy must not be left holding an older one.
    const refusing = [];
    await c.loadDesktopSnapshots(async (path, options = {}) => {
      if (options.method !== 'POST') return new Response('{"connection":"connection-2","entries":{}}');
      refusing.push(JSON.parse(options.body));
      return Object.keys(refusing.at(-1).entries).length ? new Response('{"error":"Invalid saved pages."}', {status: 422}) : new Response('{"saved":true}');
    }, 500);
    c.setSnapshotAccount('account-a');
    write(c, 'navigation', [{uuid: 'u1', identifier: 's1', name: 'Too much'}]);
    t.mock.timers.tick(500);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(refusing.at(-1), {connection: 'connection-2', entries: {}}, 'the refused save is followed by an empty one');
    c.clearAccountSnapshots();
    t.mock.timers.tick(500);
    await new Promise(resolve => setImmediate(resolve));

    // An older save answered late must not undo a newer one. The first save is
    // refused only after a second, smaller one is already waiting.
    const ordered = [];
    let answerFirst;
    await c.loadDesktopSnapshots(async (path, options = {}) => {
      if (options.method !== 'POST') return new Response('{"connection":"connection-4","entries":{}}');
      ordered.push(JSON.parse(options.body).entries);
      if (ordered.length === 1) return new Promise(resolve => { answerFirst = () => resolve(new Response('{"error":"Invalid saved pages."}', {status: 422})); });
      return new Response('{"saved":true}');
    }, 500);
    c.setSnapshotAccount('account-a');
    write(c, 'navigation', [{uuid: 'u1', identifier: 's1', name: 'First, refused'}]);
    t.mock.timers.tick(500);
    await settle();
    write(c, 'navigation', [{uuid: 'u1', identifier: 's1', name: 'Second, current'}]);
    t.mock.timers.tick(500);
    await settle();
    assert.equal(ordered.length, 1, 'the second save waits for the first to be answered');
    answerFirst();
    await settle();
    await settle();
    assert.equal(ordered.length, 2);
    assert.match(ordered[1]['voltra.snapshot.v1.navigation.account-a'], /Second, current/);
    assert.ok(ordered.every(entries => Object.keys(entries).length > 0), 'the refusal of the older save did not empty the host after the newer one');
    c.clearAccountSnapshots();
    t.mock.timers.tick(500);
    await settle();
    await settle();

    // A save the host could not make is tried again, so a passing fault does
    // not leave the host empty until the list next changes.
    const flaky = [];
    await c.loadDesktopSnapshots(async (path, options = {}) => {
      if (options.method !== 'POST') return new Response('{"connection":"connection-5","entries":{}}');
      flaky.push(Object.keys(JSON.parse(options.body).entries).length);
      return flaky.length === 1 ? new Response('{"error":"Could not save pages on this device."}', {status: 500}) : new Response('{"saved":true}');
    }, 500, 5000);
    c.setSnapshotAccount('account-a');
    write(c, 'navigation', [{uuid: 'u1', identifier: 's1', name: 'Kept through a fault'}]);
    t.mock.timers.tick(500);
    await settle();
    assert.equal(flaky.length, 1);
    t.mock.timers.tick(5000);
    await settle();
    assert.equal(flaky.length, 2, 'the same contents are sent again');
    assert.ok(flaky[1] > 0 && flaky[1] === flaky[0], 'and the host is not emptied in between');
    c.clearAccountSnapshots();
    t.mock.timers.tick(500);
    await settle();
    await settle();

    // A host that keeps failing is not left holding an older copy.
    const failing = [];
    await c.loadDesktopSnapshots(async (path, options = {}) => {
      if (options.method !== 'POST') return new Response('{"connection":"connection-6","entries":{}}');
      failing.push(Object.keys(JSON.parse(options.body).entries).length);
      return failing.at(-1) ? new Response('{"error":"Could not save pages on this device."}', {status: 500}) : new Response('{"saved":true}');
    }, 500, 5000);
    c.setSnapshotAccount('account-a');
    write(c, 'navigation', [{uuid: 'u1', identifier: 's1', name: 'Cannot be saved'}]);
    t.mock.timers.tick(500);
    for (const wait of [5000, 10000, 15000]) { await settle(); t.mock.timers.tick(wait); }
    await settle();
    await settle();
    assert.equal(failing.length, 5, 'one save, three more tries, then an empty copy');
    assert.equal(failing.at(-1), 0);
    c.clearAccountSnapshots();
    t.mock.timers.tick(500);
    await settle();
    await settle();

    // The app was relinked while this page was still open: its copies are no one's now.
    const stale = [];
    await c.loadDesktopSnapshots(async (path, options = {}) => {
      if (options.method !== 'POST') return new Response('{"connection":"connection-3","entries":{}}');
      stale.push(options.body);
      return new Response('{"error":"The saved connection changed. Reload the app."}', {status: 409});
    }, 500);
    c.setSnapshotAccount('account-a');
    write(c, 'navigation', [{uuid: 'u1', identifier: 's1', name: 'Previous connection'}]);
    t.mock.timers.tick(500);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stale.length, 1);
    write(c, 'navigation', [{uuid: 'u2', identifier: 's2', name: 'Later'}]);
    c.clearAccountSnapshots();
    t.mock.timers.tick(500);
    await settle();
    await settle();
    assert.equal(stale.length, 1, 'after the host says the connection changed, nothing more is sent');

    // A host that does not name a connection cannot be saved to at all.
    const unnamed = [];
    await c.loadDesktopSnapshots(async (path, options = {}) => { unnamed.push(options.method || 'GET'); return new Response('{"entries":{}}'); }, 500);
    c.setSnapshotAccount('account-a');
    write(c, 'navigation', [{uuid: 'u1', identifier: 's1', name: 'Unsaved'}]);
    t.mock.timers.tick(500);
    assert.deepEqual(unnamed, ['GET']);
    c.clearAccountSnapshots();

    // An unreachable host only loses the head start, and still keeps the WebView storage untouched.
    await c.loadDesktopSnapshots(async () => { throw new Error('offline'); }, 500);
    c.setSnapshotAccount('account-a');
    write(c, 'navigation', [{uuid: 'u1', identifier: 's1', name: 'Kept in memory'}]);
    assert.equal(c.savedNavigation()[0].name, 'Kept in memory');
    t.mock.timers.tick(500);
    assert.deepEqual(kept(storage), []);
  } finally {
    c.clearAccountSnapshots();
    c.setSnapshotStore(null);
    t.mock.timers.reset();
    restore();
  }
});
