import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verify, run, park, hooks } from './api-adapter.mjs';

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'validator-api-'));
  const checksModule = join(root, 'checks.mjs');
  await writeFile(checksModule, `
    export const verifyBuild = async () => ({build:'served-a'});
    export const ready = async (ctx,c) => await c.state() === 'running' && {native:'mock-readiness'};
    export const settings = async () => ({consumed:'mock-setting'});
    export const saved = async () => ({world:'mock-world'});
    export const loaded = async (ctx,c,saved) => ({world:saved.world});
  `);
  const state = { power: 'offline', requests: [], files: new Map(), wrongIdentity: false, unauthorized: false };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body = ''; for await (const chunk of req) body += chunk;
    state.requests.push([req.method, url.pathname]);
    res.setHeader('Content-Type', 'application/json');
    if (state.unauthorized) { res.writeHead(403); res.end('{}'); return; }
    let result = {};
    if (url.pathname === '/api/application/servers/1') result = { attributes: { uuid: state.wrongIdentity ? 'foreign' : 'owned', name: 'validator-test', node: 2, status: null, container: { installed: true } } };
    else if (url.pathname.endsWith('/resources')) result = { attributes: { current_state: state.power, resources: { memory_bytes: 1048576 } } };
    else if (url.pathname.endsWith('/power')) state.power = JSON.parse(body).signal === 'start' ? 'running' : 'offline';
    else if (url.pathname.endsWith('/files/write')) state.files.set(url.searchParams.get('file'), body);
    else if (url.pathname.endsWith('/files/contents')) { res.end(state.files.get(url.searchParams.get('file'))); return; }
    else if (url.pathname.endsWith('/files/delete')) for (const file of JSON.parse(body).files) state.files.delete('/' + file);
    else { res.writeHead(404); }
    res.end(JSON.stringify(result));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true }); });
  const evidence = [];
  const ctx = { game: { checksModule, base: `http://127.0.0.1:${server.address().port}`, serverId: 1, serverUUID: 'owned', nodeId: 2, expectedName: 'validator-test' }, build: 'served-a', signal: AbortSignal.timeout(5000), usage() {}, async own(f) { this.fixture = f; }, async check(name, fn) { const value = await fn(); evidence.push({ name, value }); return value; } };
  return { ctx, state, evidence };
}

test('API adapter exercises file/power flow and parks with data retained', async t => {
  const { ctx, state, evidence } = await setup(t);
  state.files.set('/existing-save', 'preserve');
  await verify(ctx); await run(ctx);
  assert.equal(state.power, 'running');
  assert.equal((await park(ctx)).offline, true);
  assert.deepEqual([...state.files], [['/existing-save', 'preserve']]);
  assert.deepEqual(evidence.map(x => x.name), ['baseline-offline', 'install', 'start-ready', 'file-api', 'settings', 'stop', 'saved', 'reload']);
  assert.equal(state.requests.filter(([method]) => method === 'POST').length, 6);
});

test('wrong fixture identity prevents power and file requests', async t => {
  const { ctx, state } = await setup(t); state.wrongIdentity = true;
  await assert.rejects(verify(ctx), /identity mismatch/);
  assert.equal(state.requests.length, 1);
});

test('API authorization error becomes a user-action blocker', async t => {
  const { ctx, state } = await setup(t); state.unauthorized = true;
  await assert.rejects(verify(ctx), error => error.code === 'API_ACCESS');
});

async function hookFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'validator-hook-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checksModule = join(root, 'checks.mjs');
  return { checksModule, context: () => ({ game: { checksModule } }) };
}

test('attempt query versions execute updated hooks at the same path', async t => {
  const { checksModule, context } = await hookFixture(t);
  const first = await import(new URL('./api-adapter.mjs?v=attempt-first', import.meta.url));
  await writeFile(checksModule, "export const ready = () => 'first';");
  const oldContext = context();
  const oldHooks = await first.hooks(oldContext);
  assert.equal(oldHooks.ready(), 'first');
  await writeFile(checksModule, "export const ready = () => 'second';");
  const second = await import(new URL('./api-adapter.mjs?v=attempt-second', import.meta.url));
  const newHooks = await second.hooks(context());
  assert.equal(newHooks.ready(), 'second');
  assert.equal((await first.hooks(oldContext)).ready(), 'first');
  assert.notEqual(oldHooks, newHooks);
  // Retention's explicit module URL follows the same attempt query.
  assert.equal((await second.hooks({}, pathToFileURL(checksModule))).ready(), 'second');
});

test('plain imports hash current hooks and pin them for each context', async t => {
  const { checksModule, context } = await hookFixture(t);
  await writeFile(checksModule, "export const ready = () => 'before';");
  const oldContext = context();
  assert.equal((await hooks(oldContext)).ready(), 'before');
  await writeFile(checksModule, "export const ready = () => 'after';");
  assert.equal((await hooks(context())).ready(), 'after');
  assert.equal((await hooks(oldContext)).ready(), 'before');
});

test('plain imports honor an explicit context version', async t => {
  const { checksModule, context } = await hookFixture(t);
  await writeFile(checksModule, "export const ready = () => 'explicit-first';");
  assert.equal((await hooks({ ...context(), sourceVersion: 'first' })).ready(), 'explicit-first');
  await writeFile(checksModule, "export const ready = () => 'explicit-second';");
  assert.equal((await hooks({ ...context(), sourceVersion: 'second' })).ready(), 'explicit-second');
});
