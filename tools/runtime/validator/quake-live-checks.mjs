import dgram from 'node:dgram';
import { createHash, randomUUID } from 'node:crypto';
import { campaign as h } from './campaign-session.mjs';
import { native, logs, command, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Preserve the frozen launcher's writable HOME; do not replace its startup.
export const registration = {
  quakelive: {
    recipe: 'quake_live/egg-quake-live.json', ports: 1,
    environment: { AUTO_UPDATE: '0', SERVER_TYPE: '1', MAP: 'campgrounds', FACTORY: 'ffa', MAX_PLAYERS: '8', FPS: '40', RCON_ENABLE: '0', SERVER_NAME: 'Validator Quake Live' },
  },
};
const config = '/baseq3/server.cfg';
const archive = '/quake-live-user/baseq3/validator-retained.cfg';
const markerFile = '/validator-quake-live-persistence.txt';
const scope = 'N/A: session arena; configuration and owned marker retention only; no gameplay, player authentication or WAN claim';
const hash = value => createHash('sha256').update(value).digest('hex');
function supported(ctx) {
  if (ctx.game.family !== 'quakelive' || ctx.game.recipe !== registration.quakelive.recipe) throw Error('Quake Live family/recipe mismatch');
}
export function retentionPaths(ctx) {
  supported(ctx);
  return [markerFile, config, '/quake-live-user/baseq3/voltra-managed.cfg', archive];
}
export function restoreContext(ctx, saved) {
  supported(ctx);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(saved?.marker ?? '')) throw Error('Missing owned Quake Live marker');
  ctx.quakeLive = { marker: saved.marker };
}
export async function prerequisites(ctx) {
  supported(ctx);
  const port = ctx.fixture?.ports?.[0];
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Missing Quake Live primary UDP allocation');
  return { required: false, queryPort: port, protocol: 'Valve A2S_INFO', home: 'Preserved frozen launcher writable HOME' };
}
export async function ready(ctx, c) {
  supported(ctx);
  const container = await native(ctx);
  if (!container?.state.Running) {
    if (container && Date.parse(container.state.StartedAt) >= ctx.startRequestedAt && container.state.ExitCode !== 0) {
      await ctx.artifact('startup-failure.log', await logs(ctx));
      throw Error('Native Quake Live startup exited ' + container.state.ExitCode);
    }
    return false;
  }
  if (!(Date.parse(container.state.StartedAt) >= ctx.startRequestedAt)) return false;
  const text = await logs(ctx);
  if (!/^VOLTRA_QSS_NATIVE_READY\r?$/m.test(text)) return false;
  const info = await query(ctx);
  assertInfo(info);
  await c.state();
  await ctx.artifact('startup.log', text);
  return { startedAt: container.state.StartedAt, nativeReady: 'VOLTRA_QSS_NATIVE_READY', query: info };
}
async function query(ctx) {
  const port = ctx.fixture.ports[0], host = '127.0.0.1';
  const request = Buffer.from('\xff\xff\xff\xffTSource Engine Query\0', 'latin1');
  ctx.signal.throwIfAborted();
  const socket = dgram.createSocket('udp4');
  return new Promise((resolve, reject) => {
    let finished = false, challenged = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer); ctx.signal.removeEventListener('abort', abort);
      socket.close(); error ? reject(error) : resolve(value);
    };
    const abort = () => finish(ctx.signal.reason ?? Error('Aborted'));
    const timer = setTimeout(() => finish(Error('Quake Live A2S query timed out')), 3000);
    const send = bytes => socket.send(bytes, port, host, error => { if (error) finish(error); });
    socket.once('error', error => finish(error));
    socket.on('message', (data, peer) => {
      if (finished || peer.address !== host || peer.port !== port) return;
      try {
        if (data.length === 9 && data.readInt32LE(0) === -1 && data[4] === 0x41 && !challenged) {
          challenged = true; send(Buffer.concat([request, data.subarray(5)])); return;
        }
        finish(null, parseInfo(data));
      } catch (error) { finish(error); }
    });
    ctx.signal.addEventListener('abort', abort, { once: true });
    send(request);
    if (ctx.signal.aborted) abort();
  });
}
function parseInfo(data) {
  if (data.length < 6 || data.length > 16384 || data.readInt32LE(0) !== -1 || data[4] !== 0x49) throw Error('Invalid Quake Live A2S_INFO framing');
  let offset = 6;
  const string = () => {
    const end = data.indexOf(0, offset);
    if (end < 0) throw Error('Truncated A2S string');
    const value = data.subarray(offset, end).toString('utf8'); offset = end + 1; return value;
  };
  const name = string(), map = string(), folder = string(), game = string();
  if (offset + 9 > data.length) throw Error('Truncated A2S fields');
  const appId = data.readUInt16LE(offset), players = data[offset + 2], maxplayers = data[offset + 3], bots = data[offset + 4];
  const serverType = String.fromCharCode(data[offset + 5]), environment = String.fromCharCode(data[offset + 6]);
  const visibility = data[offset + 7], vac = data[offset + 8]; offset += 9;
  const version = string();
  if (data[5] !== 17 || players > maxplayers || bots > players || maxplayers < 1 || visibility > 1 || vac > 1 || serverType !== 'd' || environment !== 'l') throw Error('Invalid Quake Live A2S values');
  return { protocol: data[5], name, map, folder, game, appId, players, maxplayers, bots, serverType, environment, password: !!visibility, vac: !!vac, version };
}
function assertInfo(info) {
  if (info.name !== registration.quakelive.environment.SERVER_NAME || info.map !== 'campgrounds' || info.maxplayers !== 8) throw Error('Quake Live native name/map/capacity mismatch');
}
function cvarPattern(key, value) {
  return new RegExp('"' + key + '" is:\\s*"' + value + '(?:\\^[0-9]|\\x1b\\[[0-9;]*m)*"', 'i');
}
async function readback(ctx) {
  const info = await query(ctx); assertInfo(info);
  const values = {};
  for (const [key, value] of Object.entries({ g_allowVote: '0', sv_fps: '40', zmq_rcon_enable: '0' })) values[key] = await command(ctx, key, cvarPattern(key, value));
  return { query: info, values };
}
async function cleanStop(ctx, c) {
  const state = (await native(ctx))?.state;
  if (await c.state() !== 'offline' || !state || state.Running || state.ExitCode !== 0 || state.OOMKilled || state.Dead || !(Date.parse(state.StartedAt) >= ctx.startRequestedAt)) throw Error('Native Quake Live stop not clean');
  const text = await logs(ctx);
  await ctx.artifact('stop.log', text);
  if (!/^VOLTRA_QSS_EXIT 0\r?$/m.test(text)) throw Error('Native Quake Live Stop0 marker missing');
  return state;
}
export async function settings(ctx, c) {
  supported(ctx);
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'Quake Live settings stop');
  await cleanStop(ctx, c);
  const url = '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent('/baseq3/server.cfg');
  const before = (await h.api(url)).attributes;
  if (before.file !== '/baseq3/server.cfg' || !before.fields?.some(f => f.key === 'g_allowvote' && f.type === 'boolean' && !f.readonly)) throw Error('Quake Live typed settings authority missing');
  await h.api(url, 'PUT', { revision: before.revision, settings: { g_allowvote: false } });
  ctx.quakeLive = { marker: randomUUID() };
  await c.write(markerFile, ctx.quakeLive.marker);
  ctx.startRequestedAt = Date.now(); await c.power('start');
  await wait(ctx, () => ready(ctx, c), 'Quake Live settings readiness');
  const result = await readback(ctx);
  await command(ctx, 'seta validator_retained_marker "' + ctx.quakeLive.marker + '"; validator_retained_marker', cvarPattern('validator_retained_marker', ctx.quakeLive.marker));
  await command(ctx, 'writeconfig validator-retained.cfg', /Writing validator-retained\.cfg\./i);
  if (!(await c.read(archive)).includes('seta validator_retained_marker "' + ctx.quakeLive.marker + '"')) throw Error('Quake Live archived marker missing');
  return { file: config, settings: { g_allowvote: false }, native: result, worldSave: scope };
}
export async function saved(ctx, c) {
  supported(ctx);
  const state = await cleanStop(ctx, c);
  if (!ctx.quakeLive?.marker || await c.read(markerFile) !== ctx.quakeLive.marker) throw Error('Owned Quake Live marker missing');
  const hashes = {};
  for (const path of retentionPaths(ctx)) {
    const text = await c.read(path);
    if (!text.trim()) throw Error('Empty retained Quake Live file: ' + path);
    hashes[path] = hash(text);
  }
  if (!(await c.read(archive)).includes('seta validator_retained_marker "' + ctx.quakeLive.marker + '"')) throw Error('Native archived marker missing');
  return { marker: ctx.quakeLive.marker, hashes, exitCode: state.ExitCode, nativeExit: 'VOLTRA_QSS_EXIT 0', worldSave: scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  for (const path of retentionPaths(ctx)) if (!saved.hashes?.[path] || hash(await c.read(path)) !== saved.hashes[path]) throw Error('Retained Quake Live file changed: ' + path);
  if (await c.read(markerFile) !== saved.marker) throw Error('Retained Quake Live marker mismatch');
  await command(ctx, 'exec validator-retained.cfg', /execing validator-retained\.cfg/i);
  const archiveReadback = await command(ctx, 'validator_retained_marker', cvarPattern('validator_retained_marker', saved.marker));
  return { native: await readback(ctx), archiveReadback, markerRetained: true, configRetained: true, worldSave: scope };
}
