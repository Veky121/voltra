import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { campaign as h, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

export const registration = {
  soldat: {
    recipe: 'soldat/egg-soldat.json', ports: 11,
    environment: { ADMIN_PASSWD: '', SRV_PWD: '', SRV_NAME: 'Validator Soldat', MAX_PLAYERS: '10', SRCDS_APPID: '638500', PUBLIC_SERVER: '0', AUTO_UPDATE: '0' },
  },
};
const config = '/soldat.ini';
const credential = '/.voltra/soldat/admin-password';
const markerFile = '/validator-soldat-persistence.txt';
const scope = 'N/A: round-based arena; config/maps/private admin identity retention only; no gameplay, player-client or WAN claim';
function supported(ctx) {
  if (ctx.game.family !== 'soldat' || ctx.game.recipe !== registration.soldat.recipe) throw Error('Soldat family/recipe mismatch');
}
export function retentionPaths(ctx) {
  supported(ctx);
  return [markerFile, config, '/mapslist.txt', '/maps', credential];
}
export function restoreContext(ctx, saved) {
  supported(ctx);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(saved?.marker ?? '')) throw Error('Missing owned Soldat marker');
  ctx.soldat = { marker: saved.marker };
}
export async function prerequisites(ctx) {
  supported(ctx);
  const ports = ctx.fixture?.ports;
  if (!ports || ports.length !== 11 || ports.some((p, i) => !Number.isInteger(p) || p < 1 || p > 65535 || p !== ports[0] + i)) throw Error('Soldat requires consecutive primary through primary+10 allocations');
  return { required: false, adminPort: ports[0], filePort: ports[10], protocol: 'Publisher TCP admin REFRESHX, dedicated 2.8.2 layout' };
}
export async function ready(ctx, c) {
  supported(ctx);
  const container = await native(ctx);
  if (!container?.state.Running) {
    if (container && Date.parse(container.state.StartedAt) >= ctx.startRequestedAt && container.state.ExitCode !== 0) throw Error('Native Soldat startup exited ' + container.state.ExitCode);
    return false;
  }
  if (!(Date.parse(container.state.StartedAt) >= ctx.startRequestedAt)) return false;
  const text = await logs(ctx);
  if (!/Connection for file server started\. Port\b/.test(text)) return false;
  await c.state();
  return { startedAt: container.state.StartedAt, nativeReady: 'Connection for file server started. Port', query: await query(ctx, c) };
}
// Copied publisher wire layout from soldat-wave10-protocol.mjs and the
// wave225-soldat-query.mjs driver, not a text/status approximation.
function decode(packet) {
  if (packet.length !== 1992 || packet[1944] > 16 || packet[1975] > 16) throw Error('Invalid Soldat REFRESHX length/map bounds');
  const map = packet.subarray(1945, 1945 + packet[1944]).toString('utf8');
  const nextMap = packet.subarray(1976, 1976 + packet[1975]).toString('utf8');
  if (!map || /[\x00-\x1f\x7f]/.test(map) || packet[1971] > 6 || packet[1972] < 1 || packet[1972] > 32 || packet[1974] > 1) throw Error('Invalid Soldat REFRESHX values');
  return { packet_bytes: packet.length, map, next_map: nextMap, mode: packet[1971], max_players: packet[1972], max_spectators: packet[1973], privateJoin: packet[1974] === 1, players: [...packet.subarray(1504, 1536)].filter(Boolean).length, time_limit_ticks: packet.readUInt32LE(1961), time_left_ticks: packet.readUInt32LE(1965), score_limit: packet.readUInt16LE(1969) };
}
function network(text) {
  let section = ''; const values = {};
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^\s*\[([^\]]+)\]/);
    if (heading) section = heading[1].toLowerCase();
    else if (section === 'network' && !/^\s*[;#]/.test(line)) {
      const match = line.match(/^\s*([^=]+)=(.*)$/);
      if (match) values[match[1].trim().toLowerCase()] = match[2].trim();
    }
  }
  return values;
}
async function query(ctx, c) {
  ctx.signal.throwIfAborted();
  // Files reads stay local to this call. Never return or artifact credentials,
  // config contents, raw TCP bytes or publisher banners.
  const secret = (await c.read(credential)).trim();
  const values = network(await c.read(config));
  if (!secret || secret.length > 20 || /[\r\n\0]/.test(secret) || values.admin_password !== secret) throw Error('Soldat private admin identity missing or inconsistent');
  if (values.port !== String(ctx.fixture.ports[0])) throw Error('Soldat NETWORK/Port allocation mismatch');
  const header = Buffer.from('REFRESHX\r\n');
  return new Promise((resolve, reject) => {
    let raw = Buffer.alloc(0), finished = false, sendTimer;
    const socket = net.createConnection({ host: '127.0.0.1', port: ctx.fixture.ports[0] });
    const finish = (error, result) => {
      if (finished) return;
      finished = true; clearTimeout(timer); clearTimeout(sendTimer);
      ctx.signal.removeEventListener('abort', abort); socket.destroy();
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(Error('Soldat admin query aborted'));
    const timer = setTimeout(() => finish(Error('Soldat admin REFRESHX timed out')), 8000);
    ctx.signal.addEventListener('abort', abort, { once: true });
    socket.on('connect', () => {
      socket.write(secret + '\r\n');
      sendTimer = setTimeout(() => { if (!finished) socket.write('REFRESHX\r\n'); }, 300);
    });
    socket.on('data', data => {
      raw = Buffer.concat([raw, data]);
      if (raw.length > 16384) return finish(Error('Oversize Soldat admin response'));
      const at = raw.indexOf(header);
      if (at < 0 || raw.length < at + header.length + 1992) return;
      try {
        if (!raw.subarray(0, at).toString('utf8').includes('Soldat Admin Connection Established.')) throw Error('Soldat admin authentication not acknowledged');
        finish(null, { authenticated: true, ...decode(raw.subarray(at + header.length, at + header.length + 1992)) });
      } catch (error) { finish(error); }
    });
    socket.on('error', () => finish(Error('Soldat admin TCP connection failed')));
    socket.on('close', () => finish(Error('Soldat admin closed before REFRESHX')));
    if (ctx.signal.aborted) abort();
  });
}
async function readback(ctx, c) {
  const values = network(await c.read(config));
  if (values.max_players !== '6' || values.port !== String(ctx.fixture.ports[0])) throw Error('Soldat native config capacity/port mismatch');
  const info = await query(ctx, c);
  if (info.max_players !== 6) throw Error('Soldat REFRESHX capacity mismatch');
  return { query: info, configuredPort: ctx.fixture.ports[0], configuredMaxPlayers: 6 };
}
async function cleanStop(ctx, c) {
  const state = (await native(ctx))?.state;
  if (await c.state() !== 'offline' || !state || state.Running || state.ExitCode !== 0 || state.OOMKilled || state.Dead || !(Date.parse(state.StartedAt) >= ctx.startRequestedAt)) throw Error('Native Soldat stop not clean');
  return state;
}
export async function settings(ctx, c) {
  supported(ctx);
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'Soldat settings stop');
  await cleanStop(ctx, c);
  const url = '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent(config);
  const before = (await h.api(url)).attributes;
  if (before.file !== config || !before.fields?.some(f => f.key === 'NETWORK/Max_Players' && !f.readonly && f.type !== 'readonly')) throw Error('Soldat typed capacity setting missing');
  await h.api(url, 'PUT', { revision: before.revision, settings: { 'NETWORK/Max_Players': '6' } });
  ctx.soldat = { marker: randomUUID() }; await c.write(markerFile, ctx.soldat.marker);
  ctx.startRequestedAt = Date.now(); await c.power('start');
  await wait(ctx, () => ready(ctx, c), 'Soldat settings readiness');
  return { file: config, settings: { 'NETWORK/Max_Players': '6' }, native: await readback(ctx, c), worldSave: scope };
}
async function checksums(ctx) {
  const uuid = ctx.fixture.server.uuid;
  if (!/^[a-f0-9-]{36}$/.test(uuid)) throw Error('Invalid Soldat fixture UUID');
  // Existing campaign monitor is read-only. Hash map binaries without decoding
  // them through the text Files endpoint. No native container is started here.
  const script = 'set -eu; cd /data/volumes/' + uuid + '; test -s soldat.ini; test -s mapslist.txt; test -s .voltra/soldat/admin-password; test -d maps; find validator-soldat-persistence.txt soldat.ini mapslist.txt maps .voltra/soldat/admin-password -type f -exec sha256sum {} \\;';
  const text = await docker(['exec', 'voltra-validator-monitor', 'sh', '-c', script], ctx.signal);
  const records = text.trim().split('\n').map(line => {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match) throw Error('Invalid Soldat checksum record');
    return { file: '/' + match[2], sha256: match[1] };
  }).sort((a, b) => a.file.localeCompare(b.file));
  for (const file of [markerFile, config, '/mapslist.txt', credential]) if (!records.some(r => r.file === file)) throw Error('Missing Soldat retained checksum');
  if (!records.some(r => /^\/maps\/.+\.pms$/i.test(r.file))) throw Error('Missing Soldat native map checksums');
  return records;
}
export async function saved(ctx, c) {
  supported(ctx);
  const state = await cleanStop(ctx, c);
  if (!ctx.soldat?.marker || await c.read(markerFile) !== ctx.soldat.marker) throw Error('Owned Soldat marker missing');
  if (network(await c.read(config)).max_players !== '6') throw Error('Stopped Soldat capacity missing');
  // Array records keep the private file digest out of password-named keys that
  // the report sanitizer would redact. Only paths and digests are returned.
  return { marker: ctx.soldat.marker, hashes: await checksums(ctx), exitCode: state.ExitCode, worldSave: scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  if (!Array.isArray(saved.hashes) || JSON.stringify(await checksums(ctx)) !== JSON.stringify(saved.hashes)) throw Error('Retained Soldat config/maps/admin identity changed');
  if (await c.read(markerFile) !== saved.marker) throw Error('Retained Soldat marker mismatch');
  return { native: await readback(ctx, c), markerRetained: true, configRetained: true, mapsRetained: true, privateIdentityRetained: true, worldSave: scope };
}
