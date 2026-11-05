import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Blocked } from './runner.mjs';

const attrs = x => x?.attributes ?? x;
export function client(ctx) {
  const { game, signal } = ctx;
  const base = new URL(game.base);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw Error('Invalid API base');
  const token = process.env[game.tokenEnv];
  async function api(method, path, body, raw = false) {
    signal.throwIfAborted();
    const response = await fetch(new URL(path, base), {
      method, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), redirect: 'error',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': raw ? 'text/plain' : 'application/json' },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    if ([401, 403].includes(response.status)) throw new Blocked('API_ACCESS', 'Provide an authorized API credential, then retry this fixture.');
    if (!response.ok) throw Error(`${method} ${path.split('?')[0]} returned HTTP ${response.status}`);
    if (response.status === 204) return null;
    return raw ? response.text() : response.json();
  }
  const route = suffix => `/api/client/servers/${encodeURIComponent(game.serverUUID)}${suffix}`;
  return {
    api,
    state: async () => {
      const state = attrs(await api('GET', route('/resources')));
      ctx.usage(Number(state.resources?.memory_bytes ?? 0) / 1048576);
      return state.current_state;
    },
    power: signal => api('POST', route('/power'), { signal }),
    read: file => api('GET', route('/files/contents?file=' + encodeURIComponent(file)), undefined, true),
    write: (file, value) => api('POST', route('/files/write?file=' + encodeURIComponent(file)), value, true),
    remove: file => api('POST', route('/files/delete'), { root: '/', files: [file.replace(/^\//, '')] }),
  };
}
async function until(ctx, fn, label) {
  const deadline = Date.now() + (ctx.game.phaseTimeoutMs ?? 180000);
  while (Date.now() < deadline) {
    ctx.signal.throwIfAborted();
    const evidence = await fn();
    if (evidence) return evidence;
    await new Promise((done, reject) => {
      const abort = () => { clearTimeout(timer); reject(ctx.signal.reason); };
      const timer = setTimeout(() => { ctx.signal.removeEventListener('abort', abort); done(); }, 500);
      ctx.signal.addEventListener('abort', abort, { once: true });
    });
  }
  throw Error('Timed out: ' + label);
}
const sourceVersion = new URL(import.meta.url).searchParams.get('v');
const hookImports = new WeakMap();
// Pin a context to its first hook version for the entire attempt. Plain imports
// have no runner fingerprint, so derive one from the current hook bytes.
export async function hooks(ctx, moduleURL = pathToFileURL(resolve(ctx.game.checksModule))) {
  const url = new URL(moduleURL);
  let imports = hookImports.get(ctx);
  if (!imports) { imports = new Map(); hookImports.set(ctx, imports); }
  const key = url.href;
  if (!imports.has(key)) imports.set(key, (async () => {
    const version = sourceVersion ?? ctx.sourceVersion ?? createHash('sha256').update(await readFile(url)).digest('hex');
    url.searchParams.set('v', version);
    return import(url.href);
  })());
  return imports.get(key);
}
export async function verify(ctx) {
  const g = ctx.game;
  if (!g.serverUUID || !g.serverId || !g.nodeId || !g.expectedName?.startsWith('validator-')) throw Error('Exact isolated fixture identity is required');
  const h = await hooks(ctx);
  for (const name of ['verifyBuild', 'ready', 'settings', 'saved', 'loaded']) if (typeof h[name] !== 'function') throw Error('Missing game hook: ' + name);
  const c = client(ctx);
  const server = attrs(await c.api('GET', `/api/application/servers/${g.serverId}`));
  if (server.uuid !== g.serverUUID || server.name !== g.expectedName || Number(server.node) !== Number(g.nodeId)) throw Error('Fixture identity mismatch; untouched');
  if (ctx.fixture && ctx.fixture.uuid !== g.serverUUID) throw Error('Preserved fixture identity differs');
  if ((await h.verifyBuild(ctx, c))?.build !== ctx.build) throw Error('Served build identity mismatch');
  await ctx.own({ id: g.serverId, uuid: g.serverUUID, node: g.nodeId, name: g.expectedName });
}
export async function run(ctx) {
  const c = client(ctx), h = await hooks(ctx);
  // Stop a recovered fixture before beginning a fresh lifecycle. No destructive
  // cleanup or server deletion is part of this adapter.
  await ctx.check('baseline-offline', async () => {
    if (await c.state() !== 'offline') await c.power('stop');
    return until(ctx, async () => await c.state() === 'offline' && { offline: true }, 'baseline stop');
  });
  if (h.prerequisites) await ctx.check('prerequisites', () => h.prerequisites(ctx, c, Blocked));
  await ctx.check('install', async () => {
    const server = attrs(await c.api('GET', `/api/application/servers/${ctx.game.serverId}`));
    if (server.status === 'install_failed') throw Error('Installer failed; inspect retained installer evidence');
    if (server.status != null || !server.container?.installed) throw Error('Installation has not completed');
    // This proves installed state only, not a successful cold install.
    return { installed: true, scope: 'existing fixture; cold install not tested' };
  });
  await ctx.check('start-ready', async () => {
    ctx.startRequestedAt = Date.now();
    await c.power('start');
    return until(ctx, () => h.ready(ctx, c), 'native readiness');
  });
  await ctx.check('file-api', async () => {
    const file = '/validator-probe-' + randomUUID() + '.txt', value = randomUUID();
    await c.write(file, value);
    try { if (await c.read(file) !== value) throw Error('File API roundtrip mismatch'); }
    finally { await c.remove(file); }
    return { writeReadDelete: true };
  });
  await ctx.check('settings', () => h.settings(ctx, c));
  await ctx.check('stop', async () => {
    await c.power('stop');
    return until(ctx, async () => await c.state() === 'offline' && { offline: true }, 'clean stop');
  });
  const saved = await ctx.check('saved', () => h.saved(ctx, c));
  await ctx.check('reload', async () => {
    ctx.startRequestedAt = Date.now();
    await c.power('start');
    await until(ctx, () => h.ready(ctx, c), 'restart readiness');
    return until(ctx, () => h.loaded(ctx, c, saved), 'same save loaded');
  });
}
export async function park(ctx) {
  const c = client(ctx);
  if (await c.state() !== 'offline') await c.power('stop');
  return until(ctx, async () => await c.state() === 'offline' && { offline: true, preserved: true, fixture: ctx.fixture }, 'park');
}
