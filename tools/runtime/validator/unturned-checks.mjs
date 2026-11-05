import { createHash, randomUUID } from 'node:crypto';
import { campaign as h, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

export const registration = {
  unturned: { recipe: 'unturned/egg-unturned.json', ports: 2, environment: {
    SRV_ID: 'ValidatorUnturned', SRV_NAME: 'Validator Unturned retained', GAME_MAP: 'PEI',
    MAX_PLAYERS: '6', PUBLIC_SERVER: '0', OFFLINE_ONLY: '0', AUTO_UPDATE: '0',
    VOLTRA_STEAM_AUTO_UPDATE: '0', AUTOSAVE_SECONDS: '0', GSLT: '', SRV_PW: '',
    DIFFICULTY: 'Normal', PERSPECTIVE: 'Both', PVP: '1',
  } },
};
const markerFile = '/validator-unturned-persistence.txt';
const values = { Cheats: true, Chatrate: '1.5' };
// Frozen wave485 authority hashes. Never replace helpers to make the editor accept them.
const helpers = {
  '/.voltra/unturned-entry.sh': '64e62401d4f012cc9a264638857af0a3d91304054d694c4e93b2466038d9d9a9',
  '/.voltra/unturned_runtime.py': '0970cf7c583b28f6c986d05459de2c1167c85e61db263063f72f3d6c8a16b473',
};
const worldFiles = ['Barricades.dat', 'Groups.dat', 'Lighting.dat', 'Objects.dat', 'Structures.dat', 'Vehicles.dat'];
const stableFiles = ['Barricades.dat', 'Groups.dat', 'Objects.dat', 'Structures.dat'];
const notes = [
  'Idle native operator evidence only; no players, gameplay or WAN acceptance.',
  'Cached installation is not canonical reinstall proof; that gate remains with root integration.',
  'Lighting and vehicles can change during native simulation. Preserve all hashes, compare stable world data on reload, and capture a fresh stopped saved() baseline before canonical reinstall. Never rewrite the historical receipt or synthesize world identity.',
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = text => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*(?:\x07)/g, '').replace(/\r/g, '');
function owned(ctx) {
  const s = ctx.fixture?.server;
  if (!s || !/^[a-f0-9-]{36}$/.test(s.uuid) || s.uuid !== ctx.game.serverUUID || s.name !== 'validator-' + ctx.game.id || ctx.game.family !== 'unturned' || ctx.game.recipe !== registration.unturned.recipe || ctx.fixture.recipe !== ctx.game.recipe) throw Error('Exact owned Unturned fixture required');
  for (const [key, value] of Object.entries(registration.unturned.environment)) {
    if (ctx.game.environment?.[key] !== value) throw Error('Pinned Unturned environment required: ' + key);
  }
  return s;
}
function paths(ctx) {
  owned(ctx);
  const root = '/Servers/' + ctx.game.environment.SRV_ID;
  return { config: root + '/Server/Commands.dat', world: root + '/Level/PEI' };
}
export function retentionPaths(ctx) {
  const p = paths(ctx);
  return [markerFile, p.config, p.world];
}
function identity(ctx) {
  owned(ctx);
  const b = ctx.unturned;
  if (b?.fixture !== ctx.fixture.server.uuid || !/^[a-f0-9-]{36}$/.test(b.marker ?? '')) throw Error('Missing owned Unturned identity');
  return b;
}
export function restoreContext(ctx, saved) {
  const p = paths(ctx);
  if (saved?.fixture !== ctx.fixture.server.uuid || saved.serverID !== ctx.game.environment.SRV_ID || saved.map !== 'PEI' || !/^[a-f0-9-]{36}$/.test(saved.marker ?? '')) throw Error('Invalid retained Unturned identity');
  for (const file of [markerFile, p.config, ...worldFiles.map(name => p.world + '/' + name)]) {
    const entries = saved.hashes?.filter(x => x.file === file);
    if (entries?.length !== 1 || !/^[a-f0-9]{64}$/.test(entries[0].sha256) || !Number.isSafeInteger(entries[0].bytes) || entries[0].bytes <= 0) throw Error('Missing retained Unturned bytes: ' + file);
  }
  ctx.unturned = { fixture: saved.fixture, marker: saved.marker };
}
async function guard(ctx, c) {
  owned(ctx);
  for (const [file, expected] of Object.entries(helpers)) if (sha(await c.read(file)) !== expected) throw Error('Frozen Unturned helper hash mismatch: ' + file);
}
async function clean(ctx, c) {
  owned(ctx);
  const state = (await native(ctx))?.state;
  if (await c.state() !== 'offline' || !state || state.Running || state.OOMKilled || state.ExitCode !== 0) throw Error('Unturned native shutdown was not clean');
  return state;
}
async function stop(ctx, c) {
  await c.power('stop');
  await wait(ctx, async () => await c.state() === 'offline' && !(await native(ctx))?.state.Running, 'Unturned Shutdown');
  return clean(ctx, c);
}
async function exchange(ctx, input, pattern, label) {
  const since = new Date().toISOString();
  await h.api('/api/client/servers/' + owned(ctx).uuid + '/command', 'POST', { command: input });
  return wait(ctx, async () => {
    const raw = await logs(ctx, since), text = plain(raw);
    await ctx.artifact('unturned-' + label + '.log', raw);
    if (/Unknown command|Failed to execute|Exception|Invalid command/i.test(text)) throw Error('Unturned console rejected ' + label);
    return pattern.test(text) ? { command: input, since, reply: text } : false;
  }, 'Unturned ' + label, 60000);
}
export async function prerequisites(ctx, c) {
  owned(ctx);
  const ports = ctx.fixture.ports;
  if (!Array.isArray(ports) || ports.length !== 2 || !ports.every(p => Number.isInteger(p) && p > 0 && p < 65536) || ports[1] !== ports[0] + 1) throw Error('Two consecutive ports required: query first, gameplay next');
  if (await c.state() !== 'offline' || (await native(ctx))?.state.Running) throw Error('Unturned prerequisites require offline fixture');
  await guard(ctx, c);
  ctx.unturned = { fixture: ctx.fixture.server.uuid, marker: randomUUID() };
  await c.write(markerFile, ctx.unturned.marker);
  if (await c.read(markerFile) !== ctx.unturned.marker) throw Error('Unturned marker readback failed');
  return { queryPort: ports[0], gameplayPort: ports[1], helpers, notes };
}
export async function ready(ctx, c) {
  owned(ctx);
  if (!Number.isFinite(ctx.startRequestedAt)) throw Error('Missing fresh Unturned start boundary');
  const container = await native(ctx), began = Date.parse(container?.state.StartedAt);
  if (!container || !Number.isFinite(began) || began < ctx.startRequestedAt) return false;
  const raw = await logs(ctx, container.state.StartedAt), text = plain(raw);
  if (!container.state.Running) {
    await ctx.artifact('unturned-startup-failure.log', raw);
    throw Error('Unturned exited before readiness: ' + container.state.ExitCode);
  }
  if (!/Loading level: 100%/.test(text) || await c.state() !== 'running') return false;
  const query = await exchange(ctx, 'players', /(?:^|\n)\s*Failed to find any players\.(?:\n|$)/, 'idle-query');
  await ctx.artifact('unturned-startup.log', raw);
  return { startedAt: container.state.StartedAt, loadingLevel: '100%', query, notes };
}
async function config(ctx, c) {
  const file = paths(ctx).config, text = await c.read(file);
  const lines = plain(text).split('\n').map(x => x.trim()).filter(x => x && !x.startsWith('//'));
  for (const [key, expected] of Object.entries({ name: 'Validator Unturned retained', port: String(ctx.fixture.ports[0]), map: 'PEI', maxplayers: '6', cheats: '', chatrate: '1.5' })) {
    const rows = lines.filter(x => x.split(/\s+/, 1)[0].toLowerCase() === key);
    if (rows.length !== 1 || rows[0].slice(key.length).trim() !== expected) throw Error('Unturned Commands.dat mismatch: ' + key);
  }
  return { file, sha256: sha(text), bytes: Buffer.byteLength(text) };
}
async function consumed(ctx, c) {
  await guard(ctx, c);
  const container = await native(ctx);
  if (!container?.state.Running || Date.parse(container.state.StartedAt) < ctx.startRequestedAt) throw Error('No current native Unturned instance');
  const text = plain(await logs(ctx, container.state.StartedAt));
  for (const expected of ['Successfully enabled cheats.', 'Successfully set chatrate to 1.5!', 'Successfully set map to PEI!', 'Successfully set max players to 6!', 'Successfully set name to Validator Unturned retained!']) if (!text.includes(expected)) throw Error('Missing native settings acknowledgement: ' + expected);
  return { config: await config(ctx, c), cheats: true, chatrate: '1.5', map: 'PEI', maxPlayers: 6 };
}
export async function settings(ctx, c) {
  identity(ctx);
  await stop(ctx, c);
  await guard(ctx, c);
  const file = paths(ctx).config, url = '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings';
  const before = (await h.api(url + '?file=' + encodeURIComponent(file))).attributes;
  await h.api(url, 'PUT', { file, revision: before.revision, settings: values });
  await config(ctx, c);
  ctx.startRequestedAt = Date.now(); await c.power('start');
  await wait(ctx, () => ready(ctx, c), 'Unturned edited readiness');
  const nativeSettings = await consumed(ctx, c);
  const save = await exchange(ctx, 'Save', /Successfully saved the game[.!]?/, 'save');
  ctx.unturned.save = save;
  return { settings: values, nativeSettings, save, notes };
}
async function disk(ctx) {
  const p = paths(ctx), result = [];
  for (const file of [markerFile, p.config, ...worldFiles.map(name => p.world + '/' + name)]) {
    const path = '/data/volumes/' + owned(ctx).uuid + file;
    // Fixed confined paths only; refuse symlinked parents as well as leaves.
    const components = path.split('/').filter(Boolean);
    const checks = components.map((_, i) => 'test ! -L /' + components.slice(0, i + 1).join('/')).join('; ');
    const raw = await docker(['exec', 'voltra-validator-monitor', 'sh', '-c', 'set -eu; ' + checks + '; test -f ' + path + '; sha256sum ' + path + '; stat -c %s ' + path], ctx.signal);
    const lines = raw.trim().split('\n'), sha256 = lines[0].slice(0, 64), bytes = Number(lines[1]);
    if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(bytes) || bytes <= 0) throw Error('Missing native Unturned save bytes: ' + file);
    result.push({ file, sha256, bytes });
  }
  return result;
}
export async function saved(ctx, c) {
  const b = identity(ctx), state = await clean(ctx, c);
  await guard(ctx, c);
  if (await c.read(markerFile) !== b.marker) throw Error('Unturned marker changed');
  const raw = await logs(ctx, state.StartedAt);
  if (!/Successfully saved the game[.!]?/.test(plain(raw))) throw Error('No native Save/Shutdown save acknowledgement in this run');
  await ctx.artifact('unturned-stopped-save.log', raw);
  await config(ctx, c);
  return { fixture: b.fixture, marker: b.marker, serverID: ctx.game.environment.SRV_ID, map: 'PEI', hashes: await disk(ctx), exitCode: state.ExitCode, notes };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  if (await c.read(markerFile) !== saved.marker) throw Error('Retained Unturned marker changed');
  const nativeSettings = await consumed(ctx, c), current = await disk(ctx), p = paths(ctx);
  for (const file of [markerFile, ...stableFiles.map(name => p.world + '/' + name)]) {
    const prior = saved.hashes.find(x => x.file === file), actual = current.find(x => x.file === file);
    if (prior.sha256 !== actual.sha256 || prior.bytes !== actual.bytes) throw Error('Retained Unturned world identity changed: ' + file);
  }
  const query = await exchange(ctx, 'players', /(?:^|\n)\s*Failed to find any players\.(?:\n|$)/, 'reload-idle');
  const save = await exchange(ctx, 'Save', /Successfully saved the game[.!]?/, 'reload-save');
  await stop(ctx, c);
  const stopped = await disk(ctx);
  return { serverID: saved.serverID, map: saved.map, stableWorldHashesRetained: true, nativeSettings, query, save, before: saved.hashes, after: current, stoppedHashes: stopped, notes };
}
