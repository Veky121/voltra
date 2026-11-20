import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gameCatalogPath,
  loadAndSaveGameCatalog,
  loadGameCatalog,
  readGameCatalogSnapshot,
  writeGameCatalogSnapshot,
} from '../src/features/game-library/gameLibraryCatalog.ts';
import {clearAccountSnapshots, setSnapshotAccount, setSnapshotLocks, snapshotOwner} from '../src/accountSnapshots.ts';

const recipe = {
  id: 'rust/egg-rust.json',
  name: 'Rust',
  category: 'rust',
  source: 'https://example.invalid/rust',
  description: 'Survival',
  available: true,
  verification: 'runtime_verified',
  detail: '',
  setup_steps: ['large'],
  port_rules: [{}],
};
const guided = {id: 'valheim', name: 'Valheim', description: 'Vikings', ports: 2, password: {enabled: true}};
function memory() {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

// What the grid is given for each record, whichever endpoint it came from.
const card = {
  id: recipe.id,
  name: 'Rust',
  category: 'rust',
  source: recipe.source,
  description: 'Survival',
  available: true,
  verification: 'runtime_verified',
  detail: '',
};
const guidedCard = {id: 'valheim', name: 'Valheim', description: 'Vikings'};

test('the combined catalog is one request, handed on as the fields the grid reads', async () => {
  const calls = [];
  const response = {
    object: 'game_catalog',
    attributes: {revision: 'r1', templates: [recipe], steam: [guided], can_install: true},
  };
  const result = await loadGameCatalog(async path => {
    calls.push(path);
    return response;
  }, gameCatalogPath);
  assert.deepEqual(result, {
    object: 'game_catalog',
    attributes: {templates: [card], steam: [guidedCard], can_install: true},
  });
  assert.deepEqual(calls, [gameCatalogPath]);
});

test('a combined answer with a record the grid cannot draw is read the older way instead', async () => {
  for (const [name, attributes] of Object.entries({
    'an empty slot': {templates: [recipe], steam: [null], can_install: true},
    'a record without an id': {templates: [{name: 'Nameless'}], steam: [guided], can_install: true},
    'text for a record': {templates: ['rust'], steam: [guided], can_install: true},
    'a list that is not one': {templates: {0: recipe}, steam: [guided], can_install: true},
  })) {
    const calls = [];
    const result = await loadGameCatalog(async path => {
      calls.push(path);
      if (path === gameCatalogPath) return {object: 'game_catalog', attributes};
      return path.endsWith('/templates')
        ? {attributes: {games: [recipe], can_install: false}}
        : {attributes: {games: [guided]}};
    }, gameCatalogPath);
    assert.equal(calls.length, 3, name);
    assert.deepEqual(result.attributes, {templates: [card], steam: [guidedCard], can_install: false}, name);
  }
  // Records of the wrong kind inside a present record are drawn as empty text, never as a crash.
  const odd = await loadGameCatalog(
    async () => ({
      attributes: {
        templates: [{id: 'x', name: 7, category: null, available: 'yes'}],
        steam: [{id: 'y', name: {}}],
        can_install: false,
      },
    }),
    gameCatalogPath
  );
  assert.deepEqual(odd.attributes.templates, [
    {id: 'x', name: '', category: '', source: '', description: '', available: false, verification: '', detail: ''},
  ]);
  assert.deepEqual(odd.attributes.steam, [{id: 'y', name: '', description: ''}]);
});

test('a panel without the combined endpoint is read as one settled value', async () => {
  for (const missing of [
    () => {
      throw Object.assign(new Error('missing'), {status: 404});
    },
    () => '<!doctype html>',
  ]) {
    const calls = [];
    const result = await loadGameCatalog(async path => {
      calls.push(path);
      if (path === gameCatalogPath) return missing();
      return path.endsWith('/templates')
        ? {attributes: {games: [recipe], can_install: false}}
        : {attributes: {games: [guided]}};
    }, gameCatalogPath);
    assert.deepEqual(calls, [gameCatalogPath, '/api/client/game-library/templates', '/api/client/game-library/steam']);
    assert.deepEqual(result.attributes, {templates: [card], steam: [guidedCard], can_install: false});
  }
});

test('a combined answer that does not say who may install is not taken as permission', async () => {
  const calls = [];
  const result = await loadGameCatalog(async path => {
    calls.push(path);
    if (path === gameCatalogPath) return {object: 'game_catalog', attributes: {templates: [recipe], steam: [guided]}};
    return path.endsWith('/templates')
      ? {attributes: {games: [recipe], can_install: false}}
      : {attributes: {games: [guided]}};
  }, gameCatalogPath);
  assert.deepEqual(
    calls,
    [gameCatalogPath, '/api/client/game-library/templates', '/api/client/game-library/steam'],
    'the older lists are asked instead'
  );
  assert.equal(result.attributes.can_install, false);
});

test('an older panel that answers with half a catalog is an error, not an empty library', async () => {
  const good = {templates: {attributes: {games: [recipe], can_install: true}}, steam: {attributes: {games: [guided]}}};
  const broken = {
    'recipes as a page': {...good, templates: '<!doctype html>'},
    'recipes without a list': {...good, templates: {attributes: {can_install: true}}},
    'recipes without the install flag': {...good, templates: {attributes: {games: [recipe]}}},
    'guided games as a page': {...good, steam: '<!doctype html>'},
    'guided games without a list': {...good, steam: {attributes: {}}},
    'a guided game the grid cannot draw': {...good, steam: {attributes: {games: [null]}}},
    'a recipe without an id': {...good, templates: {attributes: {games: [{name: 'Nameless'}], can_install: true}}},
  };
  for (const [name, answers] of Object.entries(broken)) {
    await assert.rejects(
      loadGameCatalog(async path => {
        if (path === gameCatalogPath) throw Object.assign(new Error('missing'), {status: 404});
        return path.endsWith('/templates') ? answers.templates : answers.steam;
      }, gameCatalogPath),
      /incomplete game list/,
      name
    );
  }
});

test('a combined answer that is not JSON at all is read the older way', async () => {
  const calls = [];
  const result = await loadGameCatalog(async path => {
    calls.push(path);
    // What the request helper throws for a 200 whose body does not parse.
    if (path === gameCatalogPath)
      throw Object.assign(new Error('The panel returned an invalid JSON response.'), {
        status: 200,
        code: 'invalid_json',
      });
    return path.endsWith('/templates')
      ? {attributes: {games: [recipe], can_install: true}}
      : {attributes: {games: [guided]}};
  }, gameCatalogPath);
  assert.equal(calls.length, 3);
  assert.deepEqual(result.attributes, {templates: [card], steam: [guidedCard], can_install: true});
});

test('a refusal or outage whose body does not parse is still a refusal or an outage', async () => {
  for (const status of [401, 500, 502, 503]) {
    const calls = [];
    await assert.rejects(
      loadGameCatalog(async path => {
        calls.push(path);
        throw Object.assign(new Error('The panel returned an invalid JSON response.'), {status, code: 'invalid_json'});
      }, gameCatalogPath),
      /invalid JSON/,
      String(status)
    );
    assert.deepEqual(calls, [gameCatalogPath], String(status));
  }
});

test('other failures are not hidden behind the older lists', async () => {
  const calls = [];
  await assert.rejects(
    loadGameCatalog(async path => {
      calls.push(path);
      throw Object.assign(new Error('down'), {status: 502});
    }, gameCatalogPath),
    /down/
  );
  assert.deepEqual(calls, [gameCatalogPath]);
});

// The saved catalog lives with the account's other saved pages.
const week = 7 * 24 * 60 * 60 * 1000;
function shared() {
  const values = new Map();
  return {
    values,
    get length() {
      return values.size;
    },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}
setSnapshotLocks({
  request: (name, change) => {
    change();
    return Promise.resolve();
  },
});

test('the saved catalog keeps grid fields, belongs to the account that asked, and expires', () => {
  const storage = shared();
  setSnapshotAccount('account-a', storage, 1000);
  writeGameCatalogSnapshot({templates: [recipe], steam: [guided], canInstall: false}, snapshotOwner(), storage, 1000);
  assert.deepEqual(readGameCatalogSnapshot(storage, 2000), {templates: [card], steam: [guidedCard], canInstall: false});
  assert.equal(readGameCatalogSnapshot(storage, 1000 + week), undefined, 'an old copy is not used');

  // Asked for by one account, answered after another was identified: an
  // administrator's "may install" must not become a member's.
  writeGameCatalogSnapshot({templates: [recipe], steam: [guided], canInstall: true}, snapshotOwner(), storage, 3000);
  const askedAsA = snapshotOwner();
  setSnapshotAccount('account-b', storage, 3000);
  assert.equal(readGameCatalogSnapshot(storage, 3000), undefined, 'another account does not read it');
  writeGameCatalogSnapshot({templates: [recipe], steam: [guided], canInstall: true}, askedAsA, storage, 3000);
  writeGameCatalogSnapshot({templates: [recipe], steam: [guided], canInstall: true}, undefined, storage, 3000);
  assert.equal(readGameCatalogSnapshot(storage, 3000), undefined, 'and a late or ownerless answer is not saved for it');
  clearAccountSnapshots(storage);
});

test('a damaged saved catalog only loses the head start', () => {
  const storage = shared();
  setSnapshotAccount('account-a', storage, 1000);
  const key = 'voltra.snapshot.v1.game-library.account-a';
  for (const value of [{templates: [{name: 'no id'}], steam: []}, {templates: [recipe]}, 'text', null, [recipe]]) {
    storage.setItem(key, JSON.stringify({at: 1000, value}));
    assert.equal(readGameCatalogSnapshot(storage, 1000), undefined, JSON.stringify(value));
  }
  storage.setItem(key, JSON.stringify({at: 1000, value: {templates: [recipe], steam: [guided], canInstall: 'yes'}}));
  assert.equal(readGameCatalogSnapshot(storage, 1000).canInstall, false, 'installing is offered only for a plain yes');
  clearAccountSnapshots(storage);
});

test('the catalog is saved by the request that fetched it, for the account that made it', async () => {
  const storage = shared();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true, writable: true});
  try {
    setSnapshotAccount('account-a');
    let answer;
    const pending = loadAndSaveGameCatalog(
      () =>
        new Promise(resolve => {
          answer = resolve;
        }),
      gameCatalogPath
    );
    // Another account is identified while the catalog is on its way.
    setSnapshotAccount('account-b');
    answer({attributes: {templates: [recipe], steam: [guided], can_install: true}});
    assert.equal((await pending).attributes.can_install, true, 'the page still gets its answer');
    assert.equal(readGameCatalogSnapshot(), undefined, 'but it is not saved for the account that did not ask');

    await loadAndSaveGameCatalog(
      async () => ({attributes: {templates: [recipe], steam: [guided], can_install: false}}),
      gameCatalogPath
    );
    assert.deepEqual(readGameCatalogSnapshot(), {templates: [card], steam: [guidedCard], canInstall: false});
  } finally {
    clearAccountSnapshots();
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
