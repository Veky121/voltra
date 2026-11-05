import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runQueue, Blocked, canAdmit, redact, enqueue } from './runner.mjs';

test('CLI adapters can import runner helpers without an evaluation deadlock', async t => {
  const f = await fixture(t);
  const runner = new URL('./runner.mjs', import.meta.url);
  await writeFile(join(f.root, 'adapter.mjs'), `import { hash } from ${JSON.stringify(runner.href)};
export async function verify() {}
export async function run(ctx) { await ctx.check('adapter-import', async () => ({ hash: hash('module-loaded') })); }
export async function park() { return { offline: true }; }
`);
  await writeFile(join(f.root, 'monitor.mjs'), 'export async function sample() { return { freeMiB: 1000, freeDiskMiB: 1000, cpuBusy: 0 }; }');
  f.config.monitor = 'monitor.mjs';
  await writeFile(join(f.root, 'manifest.json'), JSON.stringify(f.config));
  const result = await promisify(execFile)(process.execPath, [fileURLToPath(runner), 'manifest.json'], { cwd: f.root, windowsHide: true, timeout: 5000 });
  assert.equal(JSON.parse(result.stdout)[0].status, 'PASS');
});

async function fixture(t, names = ['one']) {
  const root = await mkdtemp(join(tmpdir(), 'validator-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'adapter.mjs'), '// injected adapter');
  const config = { build: 'build-a', output: 'results', policy: { pollMs: 2, admissionWaitMs: 10, reserveMiB: 10, reserveDiskMiB: 10, maxParallel: 2 }, games: names.map(id => ({ id, adapter: 'adapter.mjs', peakMiB: 20, diskMiB: 20 })) };
  const monitor = async () => ({ freeMiB: 1000, freeDiskMiB: 1000, cpuBusy: 0.1 });
  const adapters = Object.fromEntries(names.map(id => [id, {
    verify: async ctx => ctx.own({ uuid: id }),
    run: async ctx => ctx.check('native', async () => ({ observed: true })),
    park: async () => ({ offline: true, preserved: true }),
  }]));
  return { root, config, options: { root, monitor, adapters }, adapters };
}

test('blocked game parks and queue continues; no automatic blocked retry', async t => {
  const f = await fixture(t, ['one', 'two']); let parks = 0, attempts = 0;
  f.adapters.one.run = async () => { attempts++; throw new Blocked('LICENSE', 'Provide license'); };
  f.adapters.one.park = async () => { parks++; return { offline: true }; };
  const results = await runQueue(f.config, f.options);
  assert.deepEqual(results.map(r => r.status).sort(), ['PASS', 'WAITING_FOR_USER']);
  assert.equal(parks, 1);
  const again = await runQueue(f.config, f.options);
  assert.equal(attempts, 1);
  assert.equal(again.find(r => r.game === 'two').reused, true);
  const actions = JSON.parse(await readFile(join(f.root, 'results/actions.json')));
  assert.equal(actions[0].server.uuid, 'one');
});

test('explicit retry archives prior attempt; changed build cannot reuse PASS', async t => {
  const f = await fixture(t); let runs = 0;
  f.adapters.one.run = async ctx => { runs++; await ctx.check('proof', async () => ({ run: runs })); };
  await runQueue(f.config, f.options);
  f.config.build = 'build-b';
  assert.equal((await runQueue(f.config, f.options))[0].status, 'STALE');
  assert.equal(runs, 1);
  const result = await runQueue(f.config, { ...f.options, retry: ['one'] });
  assert.equal(result[0].build, 'build-b'); assert.equal(runs, 2);
});

test('failed identity never parks or runs an unverified fixture', async t => {
  const f = await fixture(t); let mutations = 0;
  f.adapters.one.verify = async () => { throw Error('wrong UUID'); };
  f.adapters.one.run = f.adapters.one.park = async () => { mutations++; };
  assert.equal((await runQueue(f.config, f.options))[0].status, 'FAIL');
  assert.equal(mutations, 0);
});

test('park failure stops further admission', async t => {
  const f = await fixture(t, ['one', 'two']); f.config.policy.maxParallel = 1;
  f.adapters.one.park = async () => { throw Error('still running'); };
  const r = await runQueue(f.config, f.options);
  assert.equal(r.find(x => x.game === 'one').status, 'UNSAFE'); assert.equal(r.find(x => x.game === 'two').code, 'QUEUE_SAFETY_STOP');
});

test('headroom blocks instead of starting; reservations avoid double counting usage', async t => {
  const f = await fixture(t);
  f.options.monitor = async () => ({ freeMiB: 20, freeDiskMiB: 100, cpuBusy: 0 });
  assert.equal((await runQueue(f.config, f.options))[0].code, 'HOST_HEADROOM');
  assert.equal(canAdmit({ freeMiB: 40, freeDiskMiB: 100, cpuBusy: 0 }, [{ game: { peakMiB: 20, diskMiB: 20 }, usedMiB: 20 }], { peakMiB: 20, diskMiB: 20 }, { reserveMiB: 10, reserveDiskMiB: 10, maxCpuBusy: 0.9 }), true);
});

test('concurrent workers obey ceiling and queue lock rejects a second writer', async t => {
  const f = await fixture(t, ['one', 'two', 'three']); let running = 0, peak = 0;
  for (const a of Object.values(f.adapters)) a.run = async ctx => {
    running++; peak = Math.max(peak, running);
    await ctx.check('work', async () => { await new Promise(r => setTimeout(r, 30)); return { actual: true }; }); running--;
  };
  const first = runQueue(f.config, f.options);
  await new Promise(r => setTimeout(r, 10));
  await assert.rejects(runQueue(f.config, f.options), { code: 'EEXIST' });
  await first; assert.equal(peak, 2);
});

test('deadline abort parks the fixture and never passes', async t => {
  const f = await fixture(t); f.config.games[0].timeoutMs = 10;
  f.adapters.one.run = async ctx => ctx.check('wait', async () => {
    await new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true }));
  });
  const [r] = await runQueue(f.config, f.options);
  assert.equal(r.status, 'FAIL'); assert.equal(r.park.offline, true);
});

test('configured secrets and common credentials are redacted', () => {
  assert.equal(redact('value abc123 Bearer xyz password=hunter2', ['abc123']), 'value [REDACTED] Bearer [REDACTED] password=[REDACTED]');
});

test('severe host pressure aborts active work and parks it', async t => {
  const f = await fixture(t); let started = false;
  f.adapters.one.run = async ctx => {
    started = true;
    await ctx.check('native', async () => new Promise((_, reject) => {
      ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
    }));
  };
  f.options.monitor = async () => ({ freeMiB: started ? 1 : 1000, freeDiskMiB: 1000, cpuBusy: 0 });
  const [result] = await runQueue(f.config, f.options);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.park.offline, true);
  assert.match(result.action, /Host pressure/);
});

test('phase reservations admit queued jobs without reserving all startup peaks', async t => {
  const f = await fixture(t, ['one', 'two']);
  f.options.monitor = async () => ({ freeMiB: 100, freeDiskMiB: 1000, cpuBusy: 0 });
  for (const g of f.config.games) { g.admissionMiB = 1; g.peakMiB = 80; }
  let running = 0, peak = 0;
  for (const adapter of Object.values(f.adapters)) adapter.run = async ctx => {
    await ctx.reserve(80); running++; peak = Math.max(peak, running);
    await ctx.check('phase', async () => { await new Promise(r => setTimeout(r, 20)); return { peakReserved: 80 }; });
    running--;
  };
  const results = await runQueue(f.config, f.options);
  assert.equal(results.filter(r => r.status === 'PASS').length, 2);
  assert.equal(peak, 1);
});

test('structured redaction keeps booleans valid and file checksum records usable', async () => {
  const { sanitize } = await import('./runner.mjs');
  const value = sanitize({ password: false, files: [{ file: '/admin-password', sha256: 'abc123' }] });
  assert.equal(value.password, '[REDACTED]');
  assert.equal(JSON.parse(JSON.stringify(value)).files[0].sha256, 'abc123');
});

async function waitFor(fn) {
  const deadline = Date.now() + 3000;
  while (!await fn()) {
    if (Date.now() > deadline) throw Error('Timed out waiting for queue');
    await new Promise(r => setTimeout(r, 5));
  }
}

test('reviewed inbox retries failed job during other work and preserves prior attempt', async t => {
  const f = await fixture(t, ['one', 'two']); f.config.allowEnqueue = true;
  let attempts = 0, longStarts = 0, release;
  const held = new Promise(r => { release = r; });
  f.adapters.one.run = async ctx => {
    attempts++;
    if (attempts === 1) throw new Blocked('REVIEW', 'Review fixture');
    await ctx.check('repaired', async () => ({ observed: true }));
  };
  f.adapters.two.run = async ctx => { longStarts++; await held; await ctx.check('long', async () => ({ observed: true })); };
  const running = runQueue(f.config, f.options);
  try {
    let first;
    await waitFor(async () => { try { first = JSON.parse(await readFile(join(f.root, 'results/one.json'))); return first.finished; } catch { return false; } });
    // A finished verification/write failure is not the intended blocked attempt.
    // Report that original failure instead of retrying it and timing out later.
    assert.equal(first.status, 'WAITING_FOR_USER', JSON.stringify(first));
    assert.equal(first.code, 'REVIEW', JSON.stringify(first));
    assert.equal(attempts, 1, JSON.stringify(first));
    const receipt = await enqueue(f.config, ['one'], { root: f.root });
    assert.equal(receipt.status, 'QUEUED');
    await waitFor(() => attempts === 2);
  } catch (error) {
    const summary = await readFile(join(f.root, 'results/summary.json'), 'utf8').catch(() => 'No summary');
    error.message += ': ' + summary;
    throw error;
  } finally { release(); await running; }
  const results = await running;
  assert.equal(results.filter(r => r.game === 'one').length, 1);
  assert.equal(results.find(r => r.game === 'one').attempt, 2);
  assert.equal(longStarts, 1);
  const history = await readdir(join(f.root, 'results/history'));
  assert.equal(JSON.parse(await readFile(join(f.root, 'results/history', history[0]))).status, 'WAITING_FOR_USER');
});

test('inbox rejects active jobs and changed config without restarting work', async t => {
  const f = await fixture(t); f.config.allowEnqueue = true;
  let started = false, release;
  const held = new Promise(r => { release = r; });
  f.adapters.one.run = async ctx => { started = true; await held; await ctx.check('work', async () => ({ observed: true })); };
  const running = runQueue(f.config, f.options);
  try {
    await waitFor(() => started);
    await assert.rejects(enqueue(f.config, ['one'], { root: f.root }), /active or pending/);
    await assert.rejects(enqueue({ ...f.config, build: 'other' }, ['one'], { root: f.root }), /does not match/);
    const receipts = (await readdir(join(f.root, 'results/inbox'))).filter(n => n.endsWith('.receipt'));
    assert.equal(receipts.length, 1);
    assert.equal(JSON.parse(await readFile(join(f.root, 'results/inbox', receipts[0]))).status, 'REJECTED');
  } finally { release(); }
  await running;
  await assert.rejects(enqueue(f.config, ['one'], { root: f.root }), { code: 'ENOENT' });
});

test('inbox is opt-in and cannot create a second queue session', async t => {
  const f = await fixture(t);
  await assert.rejects(enqueue(f.config, ['one'], { root: f.root }), /enabled config/);
  await assert.rejects(enqueue({ ...f.config, allowEnqueue: true }, ['unknown'], { root: f.root }), /configured/);
});
