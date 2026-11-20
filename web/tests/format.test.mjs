import test from 'node:test';
import assert from 'node:assert/strict';
import {formatByteRate, formatBytes, formatBytesGB, formatDateTime, formatMiBGB, parseDateTime} from '../src/format.ts';
import {formatBytesGB as unitGB} from '../src/resourceUnits.ts';

const utc = {locale: 'en-GB', timeZone: 'UTC'};
const at = '2026-11-19T14:05:09Z';

test('dates read the same way in every style', () => {
  assert.equal(formatDateTime(at, utc), '19 Nov 2026, 14:05');
  assert.equal(formatDateTime(at, {...utc, style: 'date'}), '19 Nov 2026');
  assert.equal(formatDateTime(at, {...utc, style: 'time'}), '14:05');
  assert.equal(formatDateTime(at, {...utc, style: 'precise'}), '19 Nov 2026, 14:05:09');
  assert.equal(formatDateTime(Date.parse(at), utc), '19 Nov 2026, 14:05');
  assert.equal(formatDateTime(new Date(at), utc), '19 Nov 2026, 14:05');
});

test('missing dates, Go zero time and bad values stay distinct', () => {
  for (const value of [null, undefined, '', '0001-01-01T00:00:00Z']) assert.equal(formatDateTime(value, utc), 'Never');
  assert.equal(formatDateTime(null, {...utc, empty: 'Not yet'}), 'Not yet');
  assert.equal(formatDateTime('not a date', utc), 'Unknown');
  assert.equal(formatDateTime({}, utc), 'Unknown');
  assert.equal(parseDateTime(''), null);
  assert.equal(parseDateTime('soon'), undefined);
  assert.equal(parseDateTime(at)?.toISOString(), '2026-11-19T14:05:09.000Z');
});

test('file and transfer sizes scale on the same 1024 base as GB limits', () => {
  const size = value => formatBytes(value, {locale: 'en'});
  assert.equal(size(0), '0 B');
  assert.equal(size(512), '512 B');
  assert.equal(size(1023), '1023 B');
  assert.equal(size(1024), '1 KB');
  assert.equal(size(1536), '1.5 KB');
  assert.equal(size(12.34 * 1024 ** 2), '12.3 MB');
  assert.equal(size(120 * 1024 ** 2), '120 MB');
  assert.equal(size(2 * 1024 ** 3), '2 GB');
  assert.equal(size(3 * 1024 ** 4), '3 TB');
  // Rounding never shows "1024 KB".
  assert.equal(size(1024 * 1024 - 20), '1 MB');
  assert.equal(size('2048'), '2 KB');
});

test('absent and impossible sizes are not shown as zero', () => {
  for (const value of [null, undefined, '', NaN, Infinity, -1, 'big']) assert.equal(formatBytes(value), 'Unavailable');
  assert.equal(formatBytes(null, {empty: '—'}), '—');
});

test('network rates use the same units per second', () => {
  assert.equal(formatByteRate(0, {locale: 'en'}), '0 B/s');
  assert.equal(formatByteRate(1.25 * 1024 ** 2, {locale: 'en'}), '1.3 MB/s');
  assert.equal(formatByteRate(undefined), 'Unavailable');
});

test('memory, storage and capacity keep using the shared GB helpers', () => {
  assert.equal(formatBytesGB, unitGB);
  assert.equal(formatMiBGB(1536), formatBytesGB(1536 * 1024 ** 2));
  assert.match(formatMiBGB(8192), /^8 GB$/);
});
