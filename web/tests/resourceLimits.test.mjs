import test from 'node:test';
import assert from 'node:assert/strict';
import { limitsToGB, limitsToMiB } from '../src/admin/resourceLimits.ts';

test('existing build limits display in GB and save unchanged', () => {
  const stored = { memory: 8192, disk: 102400, swap: -1, cpu: 100, io: 500 };
  assert.deepEqual(limitsToGB(stored), { ...stored, memory: 8, disk: 100 });
  assert.deepEqual(limitsToMiB(limitsToGB(stored)), stored);
  for (const size of [0, 1, 512, 1536, 8193, 102401]) {
    const limits = { memory: size, disk: size };
    assert.deepEqual(limitsToMiB(limitsToGB(limits)), limits);
  }
});

test('decimal GB input converts to whole MiB while preserving other limits', () => {
  assert.deepEqual(limitsToMiB({ memory: '1.5', disk: 10.25, swap: 512 }), {
    memory: 1536, disk: 10496, swap: 512,
  });
  assert.deepEqual(limitsToMiB({ memory: 0.1, disk: 0 }), { memory: 102, disk: 0 });
});

test('blank or invalid GB cannot accidentally remove a resource limit', () => {
  for (const value of ['', ' ', null, undefined, NaN, Infinity, -1, 0.00001, Number.MAX_VALUE]) {
    assert.throws(() => limitsToMiB({ memory: value, disk: 10 }), /memory limit/);
    assert.throws(() => limitsToMiB({ memory: 1, disk: value }), /disk limit/);
  }
});
