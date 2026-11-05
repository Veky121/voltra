import { mkdir, readFile, writeFile, rename, open, unlink, readdir, appendFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

export class Blocked extends Error {
  constructor(code, action) { super(action); this.code = code; this.action = action; }
}
export const hash = value => createHash('sha256').update(value).digest('hex');
const pause = ms => new Promise(r => setTimeout(r, ms));
const json = async path => JSON.parse(await readFile(path, 'utf8'));
async function save(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path + '.tmp', JSON.stringify(data, null, 2) + '\n');
  await rename(path + '.tmp', path);
}
export function redact(value, secrets = []) {
  let text = String(value);
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(secret).join('[REDACTED]');
  return text.replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:token|password|api_key|secret)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]');
}

export function sanitize(value, secrets = []) {
  if (typeof value === 'string') return redact(value, secrets);
  if (Array.isArray(value)) return value.map(v => sanitize(v, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, /(?:token|password|api_key|secret)$/i.test(key) ? '[REDACTED]' : sanitize(val, secrets)]));
  return value;
}

// Reservations cover additional startup demand only. Already consumed memory is
// reflected in the fresh free-memory sample; do not subtract it a second time.
export function canAdmit(sample, active, game, policy) {
  const pending = active.reduce((sum, x) => sum + Math.max(0, (x.targetMiB ?? x.game.peakMiB) - x.usedMiB), 0);
  return sample.freeMiB - pending - game.peakMiB >= policy.reserveMiB
    && sample.freeDiskMiB - active.reduce((s, x) => s + x.game.diskMiB, 0) - game.diskMiB >= policy.reserveDiskMiB
    && sample.cpuBusy <= policy.maxCpuBusy;
}

const configHash = config => hash(JSON.stringify(config));

// Submit only to this exact live owner. A durable receipt, not publication, is acceptance.
export async function enqueue(config, ids, options = {}) {
  if (config.allowEnqueue !== true || !ids.length || new Set(ids).size !== ids.length
    || ids.some(id => !config.games?.some(game => game.id === id))) throw Error('Enqueue requires enabled config and unique configured --retry IDs');
  const out = resolve(options.root ?? process.cwd(), config.output ?? '.local/validator');
  const owner = await json(resolve(out, 'queue.lock'));
  if (!owner.allowEnqueue || owner.build !== config.build || owner.configHash !== configHash(config)) throw Error('Queue owner/config does not match');
  process.kill(owner.pid, 0);
  const id = randomUUID(), inbox = resolve(out, 'inbox');
  const request = { id, owner, games: ids, retry: true };
  await save(resolve(inbox, id + '.json'), request);
  const deadline = Date.now() + (options.timeoutMs ?? 10000);
  do {
    try {
      const receipt = await json(resolve(inbox, id + '.receipt'));
      if (receipt.status !== 'QUEUED') throw Error('Enqueue rejected: ' + receipt.reason);
      return receipt;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let current;
    try { current = await json(resolve(out, 'queue.lock')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current?.run !== owner.run) throw Error('Queue closed before acceptance; request retained for audit: ' + id);
    await pause(10);
  } while (Date.now() < deadline);
  throw Error('Acceptance unconfirmed; inspect inbox receipt before resubmitting: ' + id);
}

export async function runQueue(config, options = {}) {
  config = structuredClone(config);
  const root = resolve(options.root ?? process.cwd());
  const out = resolve(root, config.output ?? '.local/validator');
  const policy = { maxParallel: 10, reserveMiB: 8192, reserveDiskMiB: 16384, maxCpuBusy: 0.9, admissionWaitMs: 60000, pollMs: 1000, ...config.policy };
  if (!Number.isInteger(policy.maxParallel) || policy.maxParallel < 1 || policy.maxParallel > 16
    || policy.reserveMiB <= 0 || policy.reserveDiskMiB <= 0 || policy.pollMs < 1 || policy.admissionWaitMs < 1
    || !(policy.maxCpuBusy > 0 && policy.maxCpuBusy <= 1)) throw Error('Invalid queue policy');
  if (!config.build || !config.games?.length) throw Error('A served build identity and games are required');
  const ids = new Set();
  for (const g of config.games) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(g.id) || ids.has(g.id) || !(g.peakMiB > 0) || !(g.diskMiB > 0) || typeof g.adapter !== 'string' || !g.adapter) throw Error('Invalid/duplicate game or missing resource estimate');
    ids.add(g.id);
  }
  await mkdir(out, { recursive: true });
  const lock = await open(resolve(out, 'queue.lock'), 'wx');
  const owner = { pid: process.pid, at: new Date().toISOString(), run: randomUUID(), build: config.build, configHash: configHash(config), allowEnqueue: config.allowEnqueue === true };
  await lock.writeFile(JSON.stringify(owner));
  const results = [], active = [], pending = [...config.games];
  const retries = new Set(options.retry ?? []);
  const record = report => { const i = results.findIndex(r => r.game === report.game); if (i < 0) results.push(report); else results[i] = report; };
  async function inbox(closing = false) {
    if (!owner.allowEnqueue) return;
    const folder = resolve(out, 'inbox');
    await mkdir(folder, { recursive: true });
    for (const name of (await readdir(folder)).filter(n => /^[a-f0-9-]+\.json$/.test(n)).sort()) {
      const file = resolve(folder, name), receipt = resolve(folder, name.replace(/\.json$/, '.receipt'));
      try { await readFile(receipt); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      let reason, request;
      try {
        request = await json(file);
        if (closing || unsafe) throw Error('Queue closed or unsafe');
        if (request.id + '.json' !== name || JSON.stringify(request.owner) !== JSON.stringify(owner)) throw Error('Wrong queue owner/build/config');
        if (request.retry !== true || !Array.isArray(request.games) || !request.games.length || new Set(request.games).size !== request.games.length) throw Error('Explicit unique retry IDs required');
        if (request.games.some(id => !ids.has(id) || pending.some(g => g.id === id) || active.some(x => x.game.id === id))) throw Error('Unknown, active or pending game');
      } catch (error) { reason = error.message; }
      if (!reason) for (const id of request.games) { retries.add(id); pending.push(config.games.find(g => g.id === id)); }
      await save(receipt, { id: request?.id ?? name, status: reason ? 'REJECTED' : 'QUEUED', reason, games: request?.games, at: new Date().toISOString() });
    }
  }
  let session;
  let latestSample;
  let unsafe = false, waitingSince = Date.now();
  const secrets = [...(config.secretEnv ?? []), ...config.games.map(g => g.tokenEnv)].filter(Boolean).map(name => process.env[name]);
  const safe = value => sanitize(value, secrets);
  async function execute(game) {
    const path = resolve(out, game.id + '.json');
    const adapterPath = resolve(root, game.adapter);
    const inputs = await Promise.all([new URL(import.meta.url), adapterPath, ...(game.checksModule ? [resolve(root, game.checksModule)] : []), ...(game.inputs ?? []).map(p => resolve(root, p))].map(p => readFile(p)));
    const fingerprint = hash(JSON.stringify({ build: config.build, game }) + inputs.map(hash).join(''));
    const sourceHashes = inputs.map(hash);
    await mkdir(resolve(out, 'source'), { recursive: true });
    for (let i = 0; i < inputs.length; i++) {
      try { await writeFile(resolve(out, 'source', sourceHashes[i] + '.txt'), inputs[i], { flag: 'wx' }); }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    let previous;
    try { previous = await json(path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (previous?.status === 'PASS' && previous.fingerprint === fingerprint && !retries.has(game.id)) return { ...previous, reused: true };
    if (previous && !retries.has(game.id)) return { ...previous, status: previous.status === 'RUNNING' ? 'INTERRUPTED' : previous.fingerprint !== fingerprint ? 'STALE' : previous.status, deferred: true, note: 'Use --retry after reviewing the preserved fixture and current inputs.' };
    if (previous) await save(resolve(out, 'history', `${game.id}-${Date.now()}-${randomUUID()}.json`), previous);
    const adapter = options.adapters?.[game.id] ?? await import(pathToFileURL(adapterPath).href + '?v=' + fingerprint);
    if (typeof adapter.run !== 'function' || typeof adapter.park !== 'function' || typeof adapter.verify !== 'function') throw Error('Adapter requires verify, run, park');
    const report = { game: game.id, build: config.build, fingerprint, sourceHashes, scope: game.scope ?? 'Named adapter checks only; not full catalog parity', status: 'RUNNING', attempt: (previous?.attempt ?? 0) + 1, started: new Date().toISOString(), checks: [], fixture: previous?.fixture ?? null };
    await save(path, report);
    const controller = new AbortController();
    const activeItem = active.find(x => x.game.id === game.id);
    if (activeItem) activeItem.controller = controller;
    const timer = setTimeout(() => controller.abort(new Error('Game deadline exceeded')), game.timeoutMs ?? 900000);
    const ctx = {
      game: structuredClone(game), build: config.build, previous, signal: controller.signal, output: out,
      fixture: report.fixture,
      async own(fixture) { ctx.fixture = report.fixture = safe(fixture); await save(path, report); },
      async check(name, fn) {
        controller.signal.throwIfAborted();
        const start = Date.now();
        try {
          const evidence = await fn();
          controller.signal.throwIfAborted();
          if (!evidence || typeof evidence !== 'object') throw Error('Check requires evidence');
          report.checks.push({ name, status: 'PASS', ms: Date.now() - start, evidence: safe(evidence) });
          await save(path, report);
          return evidence;
        } catch (error) {
          report.checks.push({ name, status: 'FAIL', error: redact(error.message, secrets) });
          await save(path, report); throw error;
        }
      },
      usage(mib) { const item = active.find(x => x.game.id === game.id); if (item) item.usedMiB = Math.max(0, Number(mib) || 0); report.peakObservedMiB = Math.max(report.peakObservedMiB ?? 0, Number(mib) || 0); },
      async reserve(mib) {
        if (!(mib >= 0) || !Number.isFinite(mib)) throw Error('Invalid phase reservation');
        const item = active.find(x => x.game.id === game.id);
        while (item && latestSample) {
          controller.signal.throwIfAborted();
          if (canAdmit(latestSample, active.filter(x => x !== item), { peakMiB: Math.max(0, mib - item.usedMiB), diskMiB: 0 }, policy)) {
            item.targetMiB = mib; return;
          }
          await pause(policy.pollMs);
        }
      },
      async artifact(name, value) {
        if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw Error('Invalid artifact name');
        const file = resolve(out, game.id, name);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, typeof value === 'string' ? redact(value, secrets) : JSON.stringify(safe(value), null, 2));
        return file;
      },
    };
    let verified = false;
    try {
      await adapter.verify(ctx); verified = true;
      await adapter.run(ctx);
      controller.signal.throwIfAborted();
      if (!report.checks.length) throw Error('Adapter returned no checks');
      report.status = 'PASS';
    } catch (error) {
      report.status = error instanceof Blocked ? 'WAITING_FOR_USER' : 'FAIL';
      report.code = error.code ?? 'CHECK_FAILED';
      report.action = redact(error.action ?? error.message, secrets);
    } finally {
      clearTimeout(timer);
      // Never mutate a fixture whose identity verification failed.
      if (verified) {
        try {
          const evidence = await adapter.park({ ...ctx, signal: AbortSignal.timeout(60000) });
          if (evidence?.offline !== true) throw Error('Park did not prove offline');
          report.park = safe(evidence);
        } catch (error) {
          report.priorStatus = report.status; report.status = 'UNSAFE'; unsafe = true;
          report.park = { error: redact(error.message, secrets) };
        }
      } else report.park = { untouched: true, reason: 'Identity not verified' };
      report.finished = new Date().toISOString();
      await save(path, report);
    }
    return report;
  }
  try {
    if (config.session) {
      session = await import(pathToFileURL(resolve(root, config.session)).href);
      await session.open(config, { root, out });
    }
    // A monitor must measure the actual execution host/VM, not the agent machine.
    const monitor = options.monitor ?? (await import(pathToFileURL(resolve(root, config.monitor)).href)).sample;
    while (pending.length || active.length) {
      const sample = await monitor(config);
      latestSample = sample;
      await appendFile(resolve(out, 'telemetry.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...sample, active: active.map(x => ({ game: x.game.id, usedMiB: x.usedMiB })) }) + '\n');
      if (![sample.freeMiB, sample.freeDiskMiB, sample.cpuBusy].every(Number.isFinite)) throw Error('Invalid host monitor sample');
      if (sample.freeMiB < policy.reserveMiB / 2 || sample.freeDiskMiB < policy.reserveDiskMiB / 2) {
        unsafe = true;
        for (const item of active) item.controller?.abort(new Error('Host pressure: park owned fixture; retry after headroom recovers'));
      }
      if (unsafe) for (const item of active) item.controller?.abort(new Error('Queue safety stop: park current work'));
      await inbox();
      let admitted = false;
      for (let i = 0; !unsafe && i < pending.length && active.length < policy.maxParallel;) {
        const game = pending[i];
        if (!canAdmit(sample, active, { ...game, peakMiB: game.admissionMiB ?? game.peakMiB }, policy)) { i++; continue; }
        pending.splice(i, 1); admitted = true;
        const item = { game, usedMiB: 0, targetMiB: game.admissionMiB ?? game.peakMiB };
        active.push(item);
        item.promise = execute(game).then(record).catch(error => {
          unsafe = true; record({ game: game.id, status: 'UNSAFE', action: redact(error.message, secrets) });
        }).finally(() => active.splice(active.indexOf(item), 1));
      }
      if (admitted || active.length) waitingSince = Date.now();
      if (unsafe || (!active.length && Date.now() - waitingSince >= policy.admissionWaitMs)) {
        results.push(...pending.splice(0).map(g => ({ game: g.id, status: 'BLOCKED', code: unsafe ? 'QUEUE_SAFETY_STOP' : 'HOST_HEADROOM', action: 'Retry when execution-host headroom and ownership are verified.' })));
      }
      await save(resolve(out, 'summary.json'), { at: new Date().toISOString(), results, active: active.map(x => x.game.id), pending: pending.map(x => x.id) });
      if (active.length || pending.length) await pause(policy.pollMs);
    }
  } catch (error) {
    for (const item of active) item.controller?.abort(error);
    throw error;
  } finally {
    await Promise.allSettled(active.map(x => x.promise));
    await inbox(true);
    await save(resolve(out, 'summary.json'), { at: new Date().toISOString(), results });
    await save(resolve(out, 'actions.json'), results.filter(r => r.status !== 'PASS'));
    await save(resolve(out, 'repairs.json'), Object.values(results.filter(r => r.status === 'FAIL').reduce((groups, r) => {
      const key = r.code + ':' + (r.checks?.find(c => c.status === 'FAIL')?.name ?? 'setup');
      (groups[key] ??= { key, games: [], action: r.action, model: 'gpt-6.1-sol', reasoning: 'low', maxAttempts: 1 }).games.push(r.game);
      return groups;
    }, {})));
    if (session) await session.close();
    const all = new Map(results.map(r => [r.game, r]));
    for (const name of await readdir(out)) if (name.endsWith('.json')) {
      const r = await json(resolve(out, name));
      if (r.game && r.status && !all.has(r.game)) all.set(r.game, r);
    }
    await save(resolve(out, 'all-games.json'), [...all.values()].map(({ game, status, build, scope, action, fixture, finished, peakObservedMiB }) => ({ game, status, build, scope, action, server: fixture?.server ?? fixture, finished, peakObservedMiB })));
    await save(resolve(out, 'actions.json'), [...all.values()].filter(r => r.status !== 'PASS').map(({ game, status, code, action, fixture }) => ({ game, status, code, action, server: fixture?.server ?? fixture })));
    await lock.close(); await unlink(resolve(out, 'queue.lock'));
  }
  return results;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  // Finish this module's evaluation before adapters import its shared helpers.
  // Awaiting the queue at module scope deadlocks that circular import.
  void (async () => {
  const argv = process.argv.slice(2);
  const enqueueOnly = argv[0] === '--enqueue';
  if (enqueueOnly) argv.shift();
  const [manifest, ...args] = argv;
  if (!manifest) { console.error('Usage: node runner.mjs [--enqueue] manifest.json [--retry game-id]'); process.exitCode = 2; }
  else {
    const retry = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] !== '--retry' || !args[i + 1]) throw Error('Expected --retry game-id');
      retry.push(args[++i]);
    }
    if (enqueueOnly) { console.log(JSON.stringify(await enqueue(await json(manifest), retry))); return; }
    const results = await runQueue(await json(manifest), { retry });
    console.log(JSON.stringify(results.map(({ game, status, code, reused }) => ({ game, status, code, reused }))));
    process.exitCode = results.some(r => r.status !== 'PASS') ? 1 : 0;
  }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
