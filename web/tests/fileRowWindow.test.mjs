import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rowWindow,
  fullWindow,
  sameWindow,
  ROW_WINDOW_THRESHOLD,
  ROW_WINDOW_OVERSCAN,
} from '../src/features/files/fileRowWindow.ts';
import {folderSizeRequests, folderSizeResults, FOLDER_SIZE_BATCH} from '../src/features/files/fileListing.ts';

const fixed = height => () => height;
const indices = win => win.rows.map(row => row.index);
const total = (win, height) => win.rows.reduce((sum, row) => sum + row.gap + height, 0) + win.tail;

test('windows long lists around the viewport with overscan and keeps the full height', () => {
  const win = rowWindow({count: 1000, heightOf: fixed(34), viewTop: 3400, viewBottom: 3400 + 680, overscan: 20});
  // Rows 100..119 are visible; 20 more on each side.
  assert.equal(indices(win)[0], 80);
  assert.equal(indices(win).at(-1), 139);
  assert.equal(win.rows.length, 60);
  assert.equal(win.rows[0].gap, 80 * 34);
  assert.ok(win.rows.slice(1).every(row => row.gap === 0));
  assert.equal(total(win, 34), 1000 * 34);
});

test('top, bottom and empty lists stay within bounds', () => {
  const top = rowWindow({count: 500, heightOf: fixed(34), viewTop: -200, viewBottom: 400});
  assert.equal(indices(top)[0], 0);
  assert.equal(top.rows[0].gap, 0);
  assert.equal(total(top, 34), 500 * 34);
  const bottom = rowWindow({count: 500, heightOf: fixed(34), viewTop: 500 * 34 - 300, viewBottom: 500 * 34 + 300});
  assert.equal(indices(bottom).at(-1), 499);
  assert.equal(bottom.tail, 0);
  assert.deepEqual(rowWindow({count: 0, heightOf: fixed(34), viewTop: 0, viewBottom: 500}), {rows: [], tail: 0});
});

test('pinned rows (expanded folders, focus, open file) render outside the window with exact gaps', () => {
  const win = rowWindow({
    count: 600,
    heightOf: fixed(34),
    viewTop: 0,
    viewBottom: 340,
    overscan: 5,
    pinned: [400, 2, 599, -1, 9999],
  });
  assert.deepEqual(indices(win), [...Array.from({length: 15}, (_, i) => i), 400, 599]);
  assert.equal(win.rows.find(row => row.index === 400).gap, (400 - 15) * 34);
  assert.equal(win.rows.find(row => row.index === 599).gap, (599 - 401) * 34);
  assert.equal(total(win, 34), 600 * 34);
});

test('measured heights of expanded folders shift the window and the spacers', () => {
  // Row 3 is an expanded folder 1000px tall.
  const heightOf = index => (index === 3 ? 1000 : 34);
  const win = rowWindow({count: 300, heightOf, viewTop: 1200, viewBottom: 1400, overscan: 0});
  // Rows 0..2 = 102px, row 3 ends at 1102, each later row adds 34.
  assert.equal(indices(win)[0], 6);
  assert.equal(win.rows[0].gap, 3 * 34 + 1000 + 2 * 34);
  assert.equal(win.rows.reduce((sum, row) => sum + row.gap + heightOf(row.index), 0) + win.tail, 299 * 34 + 1000);
});

test('full windows and comparison', () => {
  assert.deepEqual(indices(fullWindow(3)), [0, 1, 2]);
  assert.equal(fullWindow(3).tail, 0);
  const a = rowWindow({count: 300, heightOf: fixed(34), viewTop: 0, viewBottom: 600}),
    b = rowWindow({count: 300, heightOf: fixed(34), viewTop: 0, viewBottom: 600});
  assert.ok(sameWindow(a, b));
  assert.ok(!sameWindow(a, fullWindow(300)));
  assert.equal(ROW_WINDOW_THRESHOLD, 200);
  assert.ok(ROW_WINDOW_OVERSCAN >= 10);
});

test('folder sizes are requested in stable batches and parsed per folder', () => {
  const folders = Array.from({length: 120}, (_, i) => `/mods/f${String(i).padStart(3, '0')}`);
  const requests = folderSizeRequests('/api/client/servers/a', [...folders].reverse().concat(folders[0]));
  assert.equal(requests.length, Math.ceil(120 / FOLDER_SIZE_BATCH));
  assert.deepEqual(
    requests.flatMap(r => r.directories),
    folders
  );
  assert.equal(
    requests[0].url,
    `/api/client/servers/a/files/folder-size?batch=1&${folders
      .slice(0, FOLDER_SIZE_BATCH)
      .map(f => `directory=${encodeURIComponent(f)}`)
      .join('&')}`
  );
  assert.match(folderSizeRequests('/s', ['/a b/ü#?'])[0].url, /directory=%2Fa%20b%2F%C3%BC%23%3F$/);
  assert.deepEqual(folderSizeRequests('/s', []), []);
  assert.deepEqual(
    folderSizeResults({
      data: [
        {attributes: {directory: '/a', size: 5}},
        {attributes: {directory: '/b', error: 'x'}},
        {attributes: {directory: '/c', size: -1}},
        {attributes: {size: 3}},
      ],
    }),
    {sizes: {'/a': 5}, failed: ['/b', '/c']}
  );
  assert.deepEqual(folderSizeResults(null), {sizes: {}, failed: []});
});
