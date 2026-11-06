import assert from 'node:assert/strict';
import test from 'node:test';
import { nextFileSort, scanFolder, searchFileTree, sortFiles } from '../src/client/fileListing.ts';

const entry = (name, is_file = true, size = 0, extra = {}) => ({ name, is_file, size, modified_at: '2026-11-01T12:00:00Z', ...extra });
const signal = () => new AbortController().signal;
const tree = {
  '/mods': [entry('empty', false), entry('nested', false), entry('a.txt', true, 10), entry('link', false, 0, { is_symlink: true })],
  '/mods/empty': [],
  '/mods/nested': [entry('deep', false), entry('b.txt', true, 20)],
  '/mods/nested/deep': [entry('Target.jar', true, 30)],
};
const list = async path => {
  assert.ok(Object.hasOwn(tree, path), `Unexpected traversal: ${path}`);
  return tree[path];
};

test('folder size includes deeply nested files and empty folders, excluding links', async () => {
  assert.deepEqual(await scanFolder('/mods', list, signal()), { size: 60, matched: false, skippedLinks: true });
});

test('search keeps a folder for a nested filename match, not a folder-name match', async () => {
  assert.equal((await scanFolder('/mods', list, signal(), { query: 'target.jar' })).matched, true);
  assert.equal((await scanFolder('/mods', list, signal(), { query: 'nested' })).matched, false);
  assert.equal((await scanFolder('/mods/empty', list, signal(), { query: 'target' })).matched, false);
});

test('tree search retains all ancestors and cached rows, but hides empty or name-only folders', async () => {
  const result = await searchFileTree('/mods', 'target.jar', list, signal());
  assert.deepEqual([...result.folders].sort(), ['/mods', '/mods/nested', '/mods/nested/deep']);
  assert.equal(result.entries.get('/mods/nested/deep')[0].name, 'Target.jar');
  assert.deepEqual(result.errors, []);
  const failed = await searchFileTree('/mods', 'target', async path => {
    if (path === '/mods/empty') throw new Error('denied');
    return list(path);
  }, signal());
  assert.equal(failed.folders.has('/mods/nested'), true);
  assert.match(failed.errors[0], /Could not search/);
});

test('failed listing and exhausted budget cannot produce a successful size', async () => {
  await assert.rejects(scanFolder('/mods', async () => { throw new Error('Permission denied'); }, signal()), /Permission denied/);
  await assert.rejects(scanFolder('/mods', list, signal(), { budget: { remaining: 1 } }), /directory limit/);
});

test('aborted scans stop and invalid child names cannot escape the folder', async () => {
  const controller = new AbortController();
  controller.abort();
  let requests = 0;
  await assert.rejects(scanFolder('/mods', async () => { requests++; return []; }, controller.signal), { name: 'AbortError' });
  assert.equal(requests, 0);
  await assert.rejects(scanFolder('/mods', async () => [entry('../outside', false)], signal()), /invalid file name/);
});

test('each header cycles through two directions and default', () => {
  for (const key of ['name', 'size', 'modified_at']) {
    const first = nextFileSort(null, key);
    assert.equal(first.direction, key === 'modified_at' ? 'desc' : 'asc');
    const second = nextFileSort(first, key);
    assert.notEqual(first.direction, second.direction);
    assert.equal(nextFileSort(second, key), null);
  }
  assert.deepEqual(nextFileSort({ key: 'size', direction: 'desc' }, 'modified_at'), { key: 'modified_at', direction: 'desc' });
});

test('default is folders first; dates sort newest/oldest; unknown sizes remain last', () => {
  const entries = [entry('old.txt', true, 10), entry('unknown', false), entry('new.txt', true, 20, { modified_at: '2026-11-06T12:00:00Z' }), entry('folder', false)];
  const names = result => result.map(f => f.name);
  assert.deepEqual(names(sortFiles(entries, null, {})), ['folder', 'unknown', 'new.txt', 'old.txt']);
  assert.equal(sortFiles(entries, { key: 'modified_at', direction: 'desc' }, {})[0].name, 'new.txt');
  assert.equal(sortFiles(entries, { key: 'modified_at', direction: 'asc' }, {}).at(-1).name, 'new.txt');
  assert.deepEqual(names(sortFiles(entries, { key: 'size', direction: 'asc' }, { folder: 30 })), ['old.txt', 'new.txt', 'folder', 'unknown']);
  assert.deepEqual(names(sortFiles(entries, { key: 'size', direction: 'desc' }, { folder: 30 })), ['folder', 'new.txt', 'old.txt', 'unknown']);
  assert.equal(entries[0].name, 'old.txt');
});
