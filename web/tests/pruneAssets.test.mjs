import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readdir, rm, utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'vite';
import {compressedAssets} from '../build/compressedAssets.ts';
import {assetRetentionMs, expiredAssets, pruneAssets} from '../build/pruneAssets.ts';

const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 19);

test('a file is kept for the window after the build that replaced it, not after it was written', () => {
  const files = [
    // Build A, 40 days ago; its Admin chunk was replaced by build B 30 days ago.
    {name: 'Admin-aaaaaaaa.js', mtimeMs: now - 40 * day},
    // Build B, 30 days ago; replaced by build C yesterday. A tab opened two
    // days ago may still load this chunk, so it must stay.
    {name: 'Admin-bbbbbbbb.js', mtimeMs: now - 30 * day},
    {name: 'Admin-bbbbbbbb.js.gz', mtimeMs: now - 30 * day + 2000},
    // Build C, yesterday; replaced by the current build.
    {name: 'Admin-cccccccc.js', mtimeMs: now - day},
    // Current build, written seconds ago.
    {name: 'Client-dddddddd.js', mtimeMs: now - 5000},
    {name: 'Admin-dddddddd.js', mtimeMs: now - 4000},
  ];
  const current = new Set(['Client-dddddddd.js', 'Admin-dddddddd.js']);
  assert.deepEqual(expiredAssets(files, current, now), ['Admin-aaaaaaaa.js']);
  // Eight days later build B has been out of use for more than a week.
  assert.deepEqual(expiredAssets(files, current, now + 8 * day).sort(), [
    'Admin-aaaaaaaa.js',
    'Admin-bbbbbbbb.js',
    'Admin-bbbbbbbb.js.gz',
    'Admin-cccccccc.js',
  ]);
});

test('files of the current build are never removed, even with old times', () => {
  const files = [
    {name: 'Client-old00000.js', mtimeMs: now - 90 * day},
    {name: 'Other-11111111.js', mtimeMs: now - 80 * day},
    {name: 'Middle-33333333.js', mtimeMs: now - 60 * day},
    {name: 'Admin-22222222.js', mtimeMs: now - 1000},
  ];
  assert.deepEqual(expiredAssets(files, new Set(['Client-old00000.js', 'Admin-22222222.js']), now), [
    'Other-11111111.js',
  ]);
  assert.deepEqual(expiredAssets([], new Set(), now), []);
});

test('a build prunes only replaced files inside dist/assets and keeps its own and recent ones', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voltra-prune-'));
  try {
    await writeFile(join(root, 'index.html'), '<script type="module" src="/entry.js"></script>');
    await writeFile(join(root, 'entry.js'), 'document.body.onclick=()=>import("./page.js");');
    await writeFile(join(root, 'page.js'), 'export const page=1;');
    const assets = join(root, 'dist', 'assets');
    await mkdir(assets, {recursive: true});
    const old = new Date(Date.now() - 60 * day),
      replaced = new Date(Date.now() - 30 * day),
      recent = new Date(Date.now() - 2 * day);
    const seed = async (name, time) => {
      await writeFile(join(assets, name), 'x');
      await utimes(join(assets, name), time, time);
    };
    await seed('Gone-aaaaaaaa.js', old);
    await seed('Gone-aaaaaaaa.js.br', old);
    // Replaced 30 days ago by the build below, which itself was current until now.
    await seed('Kept-bbbbbbbb.js', replaced);
    await seed('Previous-cccccccc.js', recent);
    await mkdir(join(assets, 'nested'));
    await utimes(join(assets, 'nested'), old, old);
    // Outside assets nothing is touched.
    await writeFile(join(root, 'dist', 'old.txt'), 'x');
    await utimes(join(root, 'dist', 'old.txt'), old, old);
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      build: {emptyOutDir: false},
      plugins: [compressedAssets(), pruneAssets()],
    });
    const names = await readdir(assets);
    assert.ok(
      !names.includes('Gone-aaaaaaaa.js') && !names.includes('Gone-aaaaaaaa.js.br'),
      'files replaced 30+ days ago are removed'
    );
    assert.ok(names.includes('Previous-cccccccc.js'), 'the previous build stays for open tabs');
    assert.ok(names.includes('nested'), 'directories are left alone');
    assert.ok(
      names.some(name => /^index-.*\.js$/.test(name)),
      'the current entry stays'
    );
    assert.ok(
      names.some(name => /^index-.*\.js\.br$/.test(name)),
      'its compressed copies stay'
    );
    assert.ok((await readdir(join(root, 'dist'))).includes('old.txt'));
    // Kept-bbbbbbbb was replaced by the build written two days ago, so it stays.
    assert.ok(names.includes('Kept-bbbbbbbb.js'));
    assert.equal(assetRetentionMs, 7 * day);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
