import dgram from 'node:dgram';
import { createHash, randomUUID, randomInt } from 'node:crypto';
import { campaign as h } from './campaign-session.mjs';
import { native, logs, command, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Registration uses the frozen root-activation overrides, never a startup override.
export const registration = {
  etlegacy: { recipe: 'wolfenstein_enemy_territory/etlegacy/egg-e-t-legacy.json', ports: 1, environment: { ET_VERSION: '64', MAP: 'oasis', OMNIBOT: '0', PUBLIC_SERVER: '0', MAX_PLAYERS: '12', SERVER_NAME: 'Validator ET Legacy' } },
  assaultcube: { recipe: 'cubeengine/assaultcube/egg-assault-cube.json', ports: 2, environment: { PUBLIC_SERVER: '0', ASSAULT_SERVER_DESCRIPTION: 'Validator AssaultCube', ASSAULT_SERVER_MAXPLAYERS: '6' } },
};
const markerFile = '/validator-legacy-persistence.txt';
const archive = '/etlegacy/userdata/legacy/validator-retained.cfg';
const specs = {
  etlegacy: { ready: /VOLTRA_QUAKE_NATIVE_READY/, file: '/etlegacy/userdata/legacy/voltra-native.cfg', settings: { g_friendlyfire: false, g_dowarmup: true, g_warmup: '25' } },
  assaultcube: { ready: /VOLTRA_CUBE_NATIVE_READY/, file: '/assaultcube/config/voltra-options.txt', settings: { 'log-game-status': false, 'afk-limit': '90', 'ban-duration': '15' } },
};
const spec = ctx => { const s = specs[ctx.game.family]; if (!s) throw Error('Unsupported legacy family'); return s; };
const hash = value => createHash('sha256').update(value).digest('hex');
export function retentionPaths(ctx) {
  spec(ctx);
  return ctx.game.family === 'etlegacy'
    ? [markerFile, specs.etlegacy.file, archive]
    : [markerFile, specs.assaultcube.file, '/.voltra/assaultcube/admin-password'];
}
export function restoreContext(ctx, saved) {
  if (!/^[a-f0-9-]{36}$/.test(saved?.marker ?? '')) throw Error('Missing owned legacy marker');
  ctx.legacy = { marker: saved.marker };
}
export async function prerequisites(ctx) {
  spec(ctx);
  if (ctx.game.recipe !== registration[ctx.game.family].recipe) throw Error('Legacy recipe mismatch');
  const ports = ctx.fixture?.ports;
  if (!ports || ports.length < registration[ctx.game.family].ports || !ports.every(p => Number.isInteger(p) && p > 0 && p < 65536)) throw Error('Missing native query allocations');
  if (ctx.game.family === 'assaultcube' && ports[1] !== ports[0] + 1) throw Error('AssaultCube info UDP requires game port + 1');
  return { required: false, queryPort: ports[0] + (ctx.game.family === 'assaultcube' ? 1 : 0) };
}
export async function ready(ctx, c) {
  const container = await native(ctx);
  if (!container?.state.Running) {
    if (container && Date.parse(container.state.StartedAt) >= ctx.startRequestedAt && container.state.ExitCode !== 0) {
      await ctx.artifact('startup-failure.log', await logs(ctx));
      throw Error('Native legacy startup exited ' + container.state.ExitCode);
    }
    return false;
  }
  if (Date.parse(container.state.StartedAt) < ctx.startRequestedAt) return false;
  const text = await logs(ctx), pattern = spec(ctx).ready;
  if (!pattern.test(text)) return false;
  await c.state(); await ctx.artifact('startup.log', text);
  return { startedAt: container.state.StartedAt, nativeReady: text.split('\n').filter(x => pattern.test(x)), query: await query(ctx) };
}
async function exchange(ctx, request, port) {
  const socket = dgram.createSocket('udp4');
  return new Promise((resolve, reject) => {
    const finish = (error, data) => { clearTimeout(timer); ctx.signal.removeEventListener('abort', abort); socket.close(); error ? reject(error) : resolve(data); };
    const abort = () => finish(ctx.signal.reason ?? Error('Aborted'));
    const timer = setTimeout(() => finish(Error('Legacy UDP query timed out')), 3000);
    socket.once('error', error => finish(error));
    socket.on('message', (data, peer) => { if (peer.address === '127.0.0.1' && peer.port === port) finish(null, data); });
    ctx.signal.throwIfAborted(); ctx.signal.addEventListener('abort', abort, { once: true });
    socket.send(request, port, '127.0.0.1', error => { if (error) finish(error); });
  });
}
async function query(ctx) {
  if (ctx.game.family === 'etlegacy') {
    const nonce = randomUUID().replaceAll('-', '');
    const data = await exchange(ctx, Buffer.concat([Buffer.from([255, 255, 255, 255]), Buffer.from('getinfo ' + nonce + '\n')]), ctx.fixture.ports[0]);
    if (!data.subarray(0, 4).equals(Buffer.from([255, 255, 255, 255])) || !data.subarray(4).toString().startsWith('infoResponse\n')) throw Error('Invalid ET info response');
    const fields = data.subarray(4).toString().split('\n')[1].split('\\').slice(1), info = {};
    for (let i = 0; i + 1 < fields.length; i += 2) info[fields[i]] = fields[i + 1];
    if (info.challenge !== nonce || !info.mapname || info.protocol !== '84') throw Error('Wrong ET protocol or challenge');
    return { map: info.mapname, protocol: info.protocol, challengeVerified: true };
  }
  // Cube variable-integer protocol, matching the reference cube-query.py.
  const nonce = randomInt(1, 0x3fffffff), request = Buffer.alloc(6);
  request[0] = 129; request.writeInt32LE(nonce, 1); request[5] = 0;
  const data = await exchange(ctx, request, ctx.fixture.ports[0] + 1);
  let offset = 0;
  const integer = () => {
    if (offset >= data.length) throw Error('Truncated Cube integer');
    const first = data[offset++], size = first === 128 ? 2 : first === 129 ? 4 : 0;
    if (!size) return first < 128 ? first : first - 256;
    if (offset + size > data.length) throw Error('Truncated Cube integer');
    const value = data.readIntLE(offset, size); offset += size; return value;
  };
  const string = () => { const bytes = []; for (let i = 0; i < 4096; i++) { const v = integer(); if (!v) return Buffer.from(bytes).toString('utf8'); if (v < -128 || v > 255) throw Error('Invalid Cube string'); bytes.push(v & 255); } throw Error('Oversize Cube string'); };
  if (integer() !== nonce || integer() !== 0) throw Error('Cube nonce or extension mismatch');
  const protocol = integer(), mode = integer(), players = integer(), remaining = integer(), map = string(), name = string(), maxplayers = integer(), flags = integer();
  if (protocol !== 1300 || players < 0 || players > 256 || maxplayers < 1 || maxplayers > 256) throw Error('Invalid AssaultCube info');
  return { protocol, mode, players, remaining, map, name, maxplayers, flags, nonceVerified: true };
}
async function readback(ctx) {
  const info = await query(ctx);
  if (ctx.game.family === 'etlegacy') {
    const values = {};
    for (const [key, value] of Object.entries({ g_friendlyFire: '0', g_doWarmup: '1', g_warmup: '25' })) values[key] = await command(ctx, key, cvarPattern(key, value));
    return { query: info, values };
  }
  if (info.name !== 'Validator AssaultCube' || info.maxplayers !== 6) throw Error('AssaultCube native name/capacity mismatch');
  if (!(await logs(ctx)).includes("reading commandline parameters from file 'config/voltra-options.txt'")) throw Error('Native options load missing');
  return { query: info, optionsFileLoaded: true, stdin: 'noninteractive; no command execution claim', limit: 'AFK/ban effects require connected players' };
}
export async function settings(ctx, c) {
  const s = spec(ctx);
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'legacy settings stop');
  const url = '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent(s.file);
  const before = (await h.api(url)).attributes;
  await h.api(url, 'PUT', { revision: before.revision, settings: s.settings });
  ctx.legacy = { marker: randomUUID() };
  await c.write(markerFile, ctx.legacy.marker);
  ctx.startRequestedAt = Date.now(); await c.power('start'); await wait(ctx, () => ready(ctx, c), 'legacy settings readiness');
  const result = await readback(ctx);
  if (ctx.game.family === 'etlegacy') {
    await command(ctx, 'seta validator_retained_marker "' + ctx.legacy.marker + '"; validator_retained_marker', cvarPattern('validator_retained_marker', ctx.legacy.marker));
    await command(ctx, 'writeconfig validator-retained.cfg', /Writing validator-retained\.cfg\./);
  } else {
    const config = await c.read(s.file);
    if (!/-kA\s*90\b/.test(config) || !/-kB\s*15\b/.test(config)) throw Error('AssaultCube typed option bytes missing');
  }
  return { file: s.file, settings: s.settings, native: result };
}
export async function saved(ctx, c) {
  const state = (await native(ctx))?.state;
  if (!state || state.Running || state.ExitCode !== 0 || state.OOMKilled) throw Error('Native legacy stop not clean');
  if (!ctx.legacy?.marker || await c.read(markerFile) !== ctx.legacy.marker) throw Error('Owned marker missing');
  const hashes = [];
  for (const path of retentionPaths(ctx)) { const text = await c.read(path); if (!text.trim()) throw Error('Empty retained file: ' + path); hashes.push({ file: path, sha256: hash(text) }); }
  if (ctx.game.family === 'etlegacy' && !(await c.read(archive)).includes('seta validator_retained_marker "' + ctx.legacy.marker + '"')) throw Error('Native archived marker missing');
  return { marker: ctx.legacy.marker, hashes, exitCode: state.ExitCode, worldSave: 'N/A: session arena; config and owned marker persistence only' };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  for (const path of retentionPaths(ctx)) if (!saved.hashes?.find(x => x.file === path) || hash(await c.read(path)) !== saved.hashes.find(x => x.file === path).sha256) throw Error('Retained legacy file changed: ' + path);
  let archiveReadback;
  if (ctx.game.family === 'etlegacy') {
    await command(ctx, 'exec validator-retained.cfg', /execing validator-retained\.cfg/i);
    archiveReadback = await command(ctx, 'validator_retained_marker', cvarPattern('validator_retained_marker', saved.marker));
  }
  return { native: await readback(ctx), archiveReadback, markerRetained: true, configRetained: true, worldSave: saved.worldSave };
}
function cvarPattern(key, value) {
  // Publisher color resets can occur between the value and closing quote.
  return new RegExp('"' + key + '" is: "' + value + '(?:\\x1b\\[[0-9;]*m)*"');
}
