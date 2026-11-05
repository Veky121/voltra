import { campaign as h, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

export const registration = {
  valheim: { recipe: 'valheim/valheim_vanilla/egg-valheim.json', ports: 2,
    peakMiB: 4096, installPeakMiB: 4096, diskMiB: 6144,
    environment: { SERVER_NAME: 'Validator Valheim', WORLD: 'validator_world', PUBLIC_SERVER: '0',
      ENABLE_CROSSPLAY: '0', BACKUP_INTERVAL: '60', AUTO_UPDATE: '0' } },
};
// Reservations above are admission estimates, never container hard limits.
// Root must register lifecycle/retention dispatch and invoke retentionBaseline()
// immediately before its offline canonical-installer snapshot. Old lifecycle
// hashes are invalid baselines after a native reload has written another save.
const root = '/.config/unity3d/IronGate/Valheim';
const world = 'validator_world';
const controls = { SERVER_NAME: 'Validator Valheim edited', WORLD: world, PUBLIC_SERVER: '0', BACKUP_INTERVAL: '60', ENABLE_CROSSPLAY: '0' };
const notes = { scope: 'Idle native operator checks; no players, gameplay or WAN acceptance',
  query: { verified: false, reason: 'Private UDP query may time out; no query pass inferred from readiness' },
  console: { logs: true, power: true, interactiveStdin: false },
  uiGate: 'Outstanding: canonical catalog setup UI and startup controls must be exercised by root',
  reinstall: 'Outstanding until root runs the canonical installer with fresh stopped byte/mode/owner snapshots' };
const attrs = x => x?.attributes ?? x;
function owned(ctx) {
  const s = ctx.fixture?.server;
  if (!s || !/^[a-f0-9-]{36}$/.test(s.uuid) || s.uuid !== ctx.game.serverUUID || s.name !== 'validator-' + ctx.game.id ||
      ctx.game.family !== 'valheim' || ctx.fixture.recipe !== registration.valheim.recipe || ctx.game.recipe !== registration.valheim.recipe)
    throw Error('Exact owned vanilla Valheim fixture required');
  return s;
}
export function retentionPaths(ctx) {
  owned(ctx);
  return [root, '/.voltra/valheim_runtime.py', '/BepInEx', '/doorstop_libs', '/plugins', '/mods'];
}
export const retentionRequiredPath = root + '/worlds_local/' + world;
function validIdentity(x) {
  return x?.name === world && typeof x.seed === 'string' && x.seed.length > 0 && /^-?\d+$/.test(x.uid ?? '') &&
    Number.isSafeInteger(x.generation) && x.generation >= 0 && x.files?.length === 2 &&
    x.files.every(f => f.file.startsWith(root + '/worlds_local/') && !f.file.split('/').includes('..') && /^[a-f0-9]{64}$/.test(f.sha256) && f.bytes > 0);
}
export function restoreContext(ctx, saved) {
  owned(ctx);
  if (saved?.fixture !== ctx.fixture.server.uuid || !validIdentity(saved.identity) || saved.exitCode !== 0 || !saved.fiveStageSave ||
      Object.entries(controls).some(([k, v]) => saved.controls?.[k] !== v)) throw Error('Missing genuine retained Valheim identity/settings/save evidence');
  ctx.valheim = { controls: saved.controls, identity: saved.identity };
}
async function clean(ctx, c) {
  owned(ctx);
  const state = (await native(ctx))?.state;
  if (await c.state() !== 'offline' || !state || state.Running || state.OOMKilled || state.ExitCode !== 0) throw Error('Valheim stop must exit 0 without OOM');
  return state;
}
async function stop(ctx, c) {
  await c.power('stop');
  await wait(ctx, async () => await c.state() === 'offline', 'Valheim graceful save stop');
  return clean(ctx, c);
}
async function start(ctx, c) {
  ctx.startRequestedAt = Date.now(); await c.power('start');
  return wait(ctx, () => ready(ctx, c), 'Valheim native readiness');
}
async function startup(ctx, c, expected) {
  const rows = (await c.api('GET', '/api/client/servers/' + owned(ctx).uuid + '/startup')).data.map(attrs);
  const coverage = {};
  for (const [key, value] of Object.entries(expected)) {
    const matches = rows.filter(v => v.env_variable === key);
    if (matches.length !== 1 || String(matches[0].server_value) !== value) throw Error('Valheim startup readback differs: ' + key);
    coverage[key] = { value, exposed: true, editable: matches[0].is_editable ?? matches[0].user_editable ?? null, rules: matches[0].rules };
  }
  return coverage;
}
export async function prerequisites(ctx, c) {
  owned(ctx);
  if (await c.state() !== 'offline' || (await native(ctx))?.state.Running) throw Error('Valheim prerequisites require stopped fixture');
  const p = ctx.fixture.ports;
  if (p?.length !== 2 || !p.every(x => Number.isInteger(x) && x > 0 && x < 65536) || p[1] !== p[0] + 1) throw Error('Valheim requires two consecutive ports');
  const expected = registration.valheim.environment;
  const coverage = await startup(ctx, c, expected);
  ctx.valheim = { controls: { ...expected } };
  return { ports: p, startupCoverage: coverage, notes };
}
async function consumed(ctx) {
  // Inspect actual native argv. Return only non-secret controls, never password.
  const code = `import pathlib,json
rows=[]
for p in pathlib.Path('/proc').iterdir():
 if p.name.isdigit():
  try:
   a=(p/'cmdline').read_bytes().decode().split('\\0')
   if pathlib.Path(a[0]).name=='valheim_server.x86_64':
    r={k:a[a.index('-'+f)+1] for k,f in [('SERVER_NAME','name'),('WORLD','world'),('PUBLIC_SERVER','public'),('BACKUP_INTERVAL','saveinterval')]}
    assert '-crossplay' not in a,'Private Steam-only fixture required'
    rows.append(r)
  except (FileNotFoundError,PermissionError,IndexError): pass
assert len(rows)==1,'Native Valheim process is not unique'
print(json.dumps(rows[0]))`;
  const result = JSON.parse(await docker(['exec', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', owned(ctx).uuid, '/home/container/.voltra/python/bin/python3', '-B', '-c', code], ctx.signal));
  for (const key of ['SERVER_NAME', 'WORLD', 'PUBLIC_SERVER', 'BACKUP_INTERVAL'])
    if (result[key] !== ctx.valheim.controls[key]) throw Error('Native Valheim argv differs: ' + key);
  return result;
}
export async function ready(ctx, c) {
  owned(ctx);
  const n = await native(ctx);
  if (!Number.isFinite(ctx.startRequestedAt)) throw Error('Fresh Valheim start boundary required');
  if (!n || Date.parse(n.state.StartedAt) < ctx.startRequestedAt) return false;
  const text = await logs(ctx, n.state.StartedAt);
  if (!n.state.Running) { await ctx.artifact('valheim-start-failure.log', text); throw Error('Valheim exited before readiness: ' + n.state.ExitCode); }
  if (!text.includes('VOLTRA_VALHEIM_READY') || !text.includes('Game server connected') || await c.state() !== 'running') return false;
  const argv = await consumed(ctx);
  await ctx.artifact('valheim-startup.log', text);
  return { startedAt: n.state.StartedAt, nativeArguments: argv, notes };
}
export async function settings(ctx, c) {
  owned(ctx); await stop(ctx, c);
  for (const [key, value] of Object.entries(controls))
    await h.api('/api/client/servers/' + ctx.fixture.server.uuid + '/startup/variable', 'PUT', { key, value });
  const coverage = await startup(ctx, c, controls);
  ctx.valheim.controls = { ...controls };
  await start(ctx, c);
  return { source: 'startup variable API', startupCoverage: coverage, nativeArguments: await consumed(ctx), nativeDocumentEditor: 'not claimed', notes };
}
async function snapshot(ctx, c) {
  const uuid = owned(ctx).uuid, directory = root + '/worlds_local/' + world;
  const list = async path => (await c.api('GET', '/api/client/servers/' + uuid + '/files/list?directory=' + encodeURIComponent(path))).data.map(attrs);
  const rows = await list(directory);
  const generations = rows.filter(x => x.is_file && /^_main\.\d+\.fwl2$/.test(x.name)).map(x => Number(x.name.split('.')[1]));
  let generation = 0, fwl, db;
  if (generations.length) { generation = Math.max(...generations); fwl = directory + '/_main.' + generation + '.fwl2'; db = directory + '/_main.' + generation + '.db2'; }
  else throw Error('Native generation-paired Valheim FWL2/DB2 save required; no fabricated legacy identity');
  const files = [], buffers = [];
  for (const file of [fwl, db]) {
    const path = '/data/volumes/' + uuid + file;
    const sha256 = (await docker(['exec', 'voltra-validator-monitor', 'sha256sum', path], ctx.signal)).trim().slice(0, 64);
    const bytes = Number((await docker(['exec', 'voltra-validator-monitor', 'stat', '-c', '%s', path], ctx.signal)).trim());
    if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(bytes) || bytes < (file === db ? 32 : 16)) throw Error('Missing meaningful Valheim save pair');
    files.push({ file, sha256, bytes });
    if (file === fwl) buffers.push(Buffer.from(await docker(['exec', 'voltra-validator-monitor', 'base64', path], ctx.signal), 'base64'));
  }
  const data = buffers[0]; let offset = 8;
  function string() {
    let length = 0, shift = 0, complete = false;
    for (let i = 0; i < 5; i++) { const byte = data.readUInt8(offset++); length += (byte & 127) * 2 ** shift; shift += 7; if (!(byte & 128)) { complete = true; break; } }
    if (!complete || length > 1024 || offset + length > data.length) throw Error('Invalid native FWL string');
    const value = data.subarray(offset, offset + length).toString('utf8'); offset += length; return value;
  }
  const name = string(), seed = string(), seedValue = data.readInt32LE(offset), uid = data.readBigInt64LE(offset + 4).toString();
  const result = { name, seed, seedValue, uid, generation, files };
  if (!validIdentity(result)) throw Error('Invalid native Valheim world identity');
  return result;
}
function same(a, b) {
  if (a.name !== b.name || a.uid !== b.uid || a.seed !== b.seed || a.seedValue !== b.seedValue) throw Error('Valheim native world UID/seed changed');
}
export async function saved(ctx, c) {
  const state = await clean(ctx, c), n = await native(ctx), text = await logs(ctx, n.state.StartedAt);
  const shutdown = text.lastIndexOf('Shutting down');
  const tail = shutdown < 0 ? '' : text.slice(shutdown);
  const stages = [...tail.matchAll(/World save \(([1-5])\/5\)[^\n]*/g)].map(m => Number(m[1]));
  if (stages.slice(-5).join(',') !== '1,2,3,4,5' || !/World save \(5\/5\) done\./.test(tail)) throw Error('Missing native five-stage completed shutdown save');
  const identity = await snapshot(ctx, c);
  if (ctx.valheim?.identity) same(ctx.valheim.identity, identity);
  await startup(ctx, c, controls);
  await ctx.artifact('valheim-stop-save.log', text);
  const result = { fixture: owned(ctx).uuid, identity, controls: { ...controls }, exitCode: state.ExitCode, fiveStageSave: true, startedAt: n.state.StartedAt, stoppedAt: state.FinishedAt, notes };
  restoreContext(ctx, result); return result;
}
export async function retentionBaseline(ctx, c) {
  const result = await saved(ctx, c);
  await ctx.artifact('valheim-retention-current-stopped-save.json', result);
  return result;
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  const n = await native(ctx);
  if (!n?.state.Running || n.state.StartedAt === saved.startedAt || !await ready(ctx, c)) throw Error('Fresh Valheim reload readiness required');
  const before = await snapshot(ctx, c); same(saved.identity, before);
  const text = await logs(ctx, n.state.StartedAt);
  if (!text.includes('ZNet.LoadWorld: ' + world + ' (' + world + '), save number ' + before.generation) || /Failed to load world|world load failed/i.test(text)) throw Error('Native Valheim did not load selected saved generation');
  const argv = await consumed(ctx);
  await stop(ctx, c);
  const after = await retentionBaseline(ctx, c); same(saved.identity, after.identity);
  await ctx.artifact('valheim-reload-identity.json', { before, after: after.identity });
  return { sameWorldUID: before.uid, sameSeed: before.seed, before, after: after.identity, nativeArguments: argv, exitCode: after.exitCode, notes };
}
