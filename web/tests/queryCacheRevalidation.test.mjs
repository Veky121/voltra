import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle = await build({
  entryPoints: [new URL('../src/hooks/queryCache.ts', import.meta.url).pathname.replace(/^\/(.:)/, '$1')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const c = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const tick = () => new Promise(r => setImmediate(r));
const path = '/api/client/servers/one';
function network() {
  const calls = [];
  return {
    calls,
    request: (path, options) => new Promise((resolve, reject) => calls.push({path, options, resolve, reject})),
  };
}

test('eligible reads keep their last answer, paint it at once and always revalidate', async () => {
  c.purgeQueryCache();
  const n = network();
  const backups = path + '/backups?page=1&per_page=20';
  assert.equal(c.queryTTL(backups), 0);
  assert.equal(c.queryCacheable(backups), true);
  const a = c.observeQuery(backups, n.request, () => {});
  await tick();
  n.calls[0].resolve({data: ['one']});
  await tick();
  a.unsubscribe();
  assert.deepEqual(c.readQuerySnapshot(backups, n.request).data, {data: ['one']});
  const seen = [];
  const b = c.observeQuery(backups, n.request, s => seen.push(s));
  await tick();
  assert.deepEqual(seen[0].data, {data: ['one']});
  assert.equal(seen.at(-1).loading, true);
  assert.deepEqual(seen.at(-1).data, {data: ['one']});
  assert.equal(n.calls.length, 2);
  n.calls[1].resolve({data: ['two']});
  await tick();
  assert.deepEqual(seen.at(-1).data, {data: ['two']});
  assert(c.queryAnsweredAt(backups, n.request) > 0);
  b.unsubscribe();
});

test('secrets, tokens, live telemetry, editing forms and the session are never painted stale', () => {
  for (const p of [
    path + '/databases/4?include=password',
    path + '/websocket',
    path + '/files/contents?file=%2Fa',
    path + '/files/download?file=a',
    path + '/resources',
    path + '/console-history',
    path + '/startup',
    path + '/settings',
    path + '/game-settings',
    '/api/client/account/api-keys',
    '/api/client/account/ssh-keys',
    '/api/client/account/desktop/devices',
    '/api/client/account/sftp-password',
    '/api/auth/session',
    '/api/setup/status',
    '/api/admin/settings',
    '/api/admin/integrations',
    '/api/admin/integrations/defaults/3',
    '/api/application/nodes/3/configuration',
    '/api/application/servers/5?include=allocations',
    '/api/admin/eggs/4',
    '/api/admin/servers/3/fs25/licences',
    path + '/backups?token=abc',
    'https://elsewhere.test/api/client',
  ])
    assert.equal(c.queryCacheable(p), false, p);
  for (const p of [
    path,
    path + '/backups',
    path + '/files/list?directory=%2F',
    '/api/client?summary=overview&per_page=100',
    '/api/client/account',
    '/api/client/account/activity',
    '/api/application/servers?per_page=100',
    '/api/admin/eggs/4/variables',
    '/locales/locale.json?locale=en&namespace=client',
  ])
    assert.equal(c.queryCacheable(p), true, p);
});

test('mutations refresh only their route family, and unknown writes refresh everything', () => {
  const S = '/api/client/servers/one',
    O = '/api/client/servers/two';
  const hits = (mutation, key) => {
    const target = c.mutationTargets(mutation);
    return !!target && target(key);
  };
  // Files: listings and folder sizes of that server only.
  assert(hits(S + '/files/write', S + '/files/list'));
  assert(hits(S + '/files/delete', S + '/files/folder-size'));
  assert(hits(S + '/files/write', S + '/activity'));
  for (const key of [
    S,
    S + '/backups',
    S + '/schedules',
    S + '/users',
    '/api/client',
    '/api/client/account',
    O + '/files/list',
  ])
    assert(!hits(S + '/files/write', key), key);
  assert(hits('http://localhost' + S + '/files/uploads/x/complete', S + '/files/list'));
  // A backup restore replaces files and changes the server's state.
  assert(hits(S + '/backups/b/restore', S + '/files/list'));
  assert(hits(S + '/backups', S));
  assert(!hits(S + '/backups', S + '/schedules'));
  assert(hits(S + '/schedules/1', S + '/schedules'));
  assert(!hits(S + '/schedules/1', S));
  assert(hits(S + '/network/allocations', S));
  assert(hits(S + '/network/allocations', '/api/client'));
  assert(hits(S + '/subdomain', S + '/network'));
  assert(hits(S + '/users/u', S + '/users'));
  assert(!hits(S + '/users/u', S + '/files/list'));
  assert(hits(S + '/databases', S + '/databases'));
  assert(hits(S + '/steam', S + '/steam'));
  // Power, settings and anything unrecognised: every read of that server, not of others.
  for (const m of [
    S + '/power',
    S + '/settings/rename',
    S + '/settings/reinstall',
    S + '/startup/variable',
    S + '/something-new',
  ]) {
    assert(hits(m, S + '/files/list'), m);
    assert(hits(m, '/api/client'), m);
    assert(!hits(m, O), m);
  }
  assert.equal(c.mutationTargets(S + '/command'), null);
  assert.equal(c.mutationTargets(S + '/navigation'), null);
  assert.equal(c.mutationTargets('https://node.test/upload'), null);
  assert(hits('/api/client/account/api-keys', '/api/client/account'));
  assert(!hits('/api/client/account/api-keys', S));
  assert(hits('/api/application/servers/5/build', S));
  assert(hits('/api/admin/servers/5', '/api/application/servers'));
  assert(!hits('/api/application/servers/5/build', '/api/application/users'));
  assert(hits('/api/application/nodes/2', '/api/admin/servers'));
  assert(hits('/api/admin/users/2', '/api/client/account'));
  assert(hits('/api/admin/eggs/3', '/api/client/game-library/catalog'));
  assert(hits('/api/client/game-library/templates/x/install', '/api/client'));
  for (const m of ['/api/admin/settings', '/api/admin/mounts/1', '/api/client/whatever'])
    for (const key of [S, '/api/client/account', '/api/admin/nodes']) assert(hits(m, key), m + ' ' + key);
});

test('a file write refreshes cached listings but leaves other cached reads of the server alone', async () => {
  c.purgeQueryCache();
  const n = network();
  const list = path + '/files/list?directory=%2F',
    backups = path + '/backups';
  const a = c.observeQuery(list, n.request, () => {}),
    b = c.observeQuery(backups, n.request, () => {}),
    d = c.observeQuery(path, n.request, () => {});
  await tick();
  n.calls.forEach(call => call.resolve({}));
  await tick();
  assert.equal(n.calls.length, 3);
  c.invalidateQueryCache(path + '/files/write?file=%2Fa');
  await tick();
  assert.deepEqual(
    n.calls.slice(3).map(call => call.path),
    [list]
  );
  a.unsubscribe();
  b.unsubscribe();
  d.unsubscribe();
});

test('an account change purges every kept answer before it can be painted', async () => {
  c.purgeQueryCache();
  const n = network();
  const backups = path + '/backups';
  const a = c.observeQuery(backups, n.request, () => {});
  await tick();
  n.calls[0].resolve({owner: 'A'});
  await tick();
  a.unsubscribe();
  c.setQueryCacheScope('account-A');
  c.setQueryCacheScope('account-B');
  assert.equal(c.readQuerySnapshot(backups, n.request), undefined);
  const seen = [];
  const b = c.observeQuery(backups, n.request, s => seen.push(s));
  await tick();
  assert(seen.every(s => s.data === null));
  b.unsubscribe();
});
