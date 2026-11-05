import dgram from 'node:dgram';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { campaign as h, docker } from './campaign-session.mjs';
import { native, logs, command, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Frozen DDRace recipe only. No startup override or public registration.
export const registration = {
  ddnet: { recipe: 'ddracenetwork/egg-d-d-race-network.json', ports: 1, environment: {
    SERVER_NAME: 'Validator DDRace', SERVER_MAP: 'Tutorial', MAX_PLAYERS: '16',
    SERVER_REGISTER: '0', SIXUP: '0', TEST_COMMANDS: '0', AUTO_UPDATE: '0',
  } },
};
const config = '/ddnet/autoexec_server.cfg';
const database = '/ddnet/ddnet-server.sqlite';
const markerFile = '/validator-ddnet-persistence.txt';
const values = { sv_name: 'Validator retained DDRace', sv_max_clients: '12' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const limits = {
  worldSave: 'N/A: idle arena map service; no continuing world mutation',
  playerGameplay: 'Not exercised: players explicitly excluded',
  scoreWrites: 'Unverified: no player finish and no synthetic database score mutation',
  wan: 'Unverified: loopback UDP only',
};
export function retentionPaths() { return [markerFile, config, database]; }
export function restoreContext(ctx, saved) {
  if (!/^[a-f0-9-]{36}$/.test(saved?.marker ?? '')) throw Error('Missing owned DDRace marker');
  for (const file of retentionPaths()) {
    if (!saved.hashes?.some(x => x.file === file && /^[a-f0-9]{64}$/.test(x.sha256))) throw Error('Missing retained checksum: ' + file);
  }
  ctx.ddnet = { marker: saved.marker };
}
export async function prerequisites(ctx) {
  if (ctx.game.recipe !== registration.ddnet.recipe) throw Error('DDRace frozen recipe mismatch');
  const port = ctx.fixture?.ports?.[0];
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Missing native UDP allocation');
  return { required: false, queryPort: port, ...limits };
}
async function query(ctx) {
  ctx.signal.throwIfAborted();
  const token = randomInt(1, 256), port = ctx.fixture.ports[0];
  const prefix = Buffer.concat([Buffer.alloc(10, 255), Buffer.from('inf3')]);
  const socket = dgram.createSocket('udp4');
  const data = await new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, reply) => {
      if (finished) return;
      finished = true; clearTimeout(timer); ctx.signal.removeEventListener('abort', abort);
      socket.close(); error ? reject(error) : resolve(reply);
    };
    const abort = () => finish(ctx.signal.reason ?? Error('Aborted'));
    const timer = setTimeout(() => finish(Error('DDRace UDP query timed out')), 3000);
    ctx.signal.addEventListener('abort', abort, { once: true });
    socket.once('error', finish);
    socket.on('message', (reply, peer) => {
      if (peer.address !== '127.0.0.1' || peer.port !== port) return;
      if (!reply.subarray(0, 14).equals(prefix)) return;
      if (reply.subarray(14).toString('utf8').split('\0')[0] !== String(token)) return;
      finish(null, reply);
    });
    // Historical wave227/wave365 Teeworlds 0.6 connectionless query.
    socket.send(Buffer.concat([Buffer.alloc(10, 255), Buffer.from('gie3'), Buffer.from([token])]), port, '127.0.0.1', error => { if (error) finish(error); });
  });
  const fields = data.subarray(14).toString('utf8').split('\0');
  if (fields.length < 11 || fields[4] !== 'DDraceNetwork' || !fields[1] || !fields[2] || !fields[3]) throw Error('Invalid DDRace inf3 identity');
  const numbers = fields.slice(5, 10).map(x => /^\d+$/.test(x) ? Number(x) : NaN);
  const [flags, players, maxPlayers, clients, maxClients] = numbers;
  if (numbers.some(x => !Number.isSafeInteger(x)) || players > maxPlayers || clients > maxClients || maxClients < 1 || maxClients > 128) throw Error('Invalid DDRace inf3 counts');
  return { version: fields[1], name: fields[2], map: fields[3], game: fields[4], flags, players, maxPlayers, clients, maxClients, tokenVerified: true };
}
export async function ready(ctx, c) {
  const container = await native(ctx);
  if (!container?.state.Running) {
    if (container && Date.parse(container.state.StartedAt) >= ctx.startRequestedAt && container.state.ExitCode !== 0) {
      await ctx.artifact('startup-failure.log', await logs(ctx));
      throw Error('Native DDRace startup exited ' + container.state.ExitCode);
    }
    return false;
  }
  if (!Number.isFinite(ctx.startRequestedAt) || Date.parse(container.state.StartedAt) < ctx.startRequestedAt) return false;
  const text = await logs(ctx);
  if (!text.includes('Voltra DDRace native initialized') || !text.includes('server name is ')) return false;
  const info = await query(ctx);
  await c.state(); await ctx.artifact('startup.log', text);
  return { startedAt: container.state.StartedAt, nativeReady: text.split('\n').filter(x => /Voltra DDRace native initialized|server name is /.test(x)), query: info };
}
async function readback(ctx) {
  const info = await query(ctx);
  if (info.name !== values.sv_name || info.maxClients !== Number(values.sv_max_clients) || info.map !== 'Tutorial') throw Error('DDRace native name/capacity/map mismatch');
  const marker = 'VOLTRA_DDRACE_' + randomUUID().replaceAll('-', '');
  const echo = await command(ctx, 'echo ' + marker, new RegExp('(?:^|\\n)[^\\n]*(?:I console:|\\[console\\]:) ' + marker + '(?:\\r?\\n|$)'));
  return { query: info, echo, ...limits };
}
export async function settings(ctx, c) {
  await c.power('stop');
  await wait(ctx, async () => await c.state() === 'offline' && !(await native(ctx))?.state.Running, 'DDRace settings stop');
  const url = '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent(config);
  const before = (await h.api(url)).attributes;
  await h.api(url, 'PUT', { revision: before.revision, settings: values });
  ctx.ddnet = { marker: randomUUID() };
  await c.write(markerFile, ctx.ddnet.marker);
  ctx.startRequestedAt = Date.now(); await c.power('start');
  await wait(ctx, () => ready(ctx, c), 'DDRace settings readiness');
  return { file: config, settings: values, native: await readback(ctx) };
}
async function diskDatabase(ctx) {
  const uuid = ctx.fixture.server.uuid;
  if (!/^[a-f0-9-]{36}$/.test(uuid)) throw Error('Invalid owned fixture UUID');
  // Read actual binary bytes through the existing read-only campaign monitor.
  // Text file APIs would corrupt a SQLite checksum. Never install a helper.
  const path = '/data/volumes/' + uuid + database;
  const encoded = await docker(['exec', 'voltra-validator-monitor', 'sh', '-c', 'set -eu; test -f ' + path + '; test ! -L ' + path + '; base64 ' + path], ctx.signal);
  const bytes = Buffer.from(encoded.replace(/\s/g, ''), 'base64');
  if (bytes.length < 100 || !bytes.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) throw Error('Missing or invalid native SQLite database');
  const rawPageSize = bytes.readUInt16BE(16), pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
  if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) || bytes.length % pageSize) throw Error('Invalid SQLite page layout');
  const integrity = (await docker(['exec', 'voltra-validator-monitor', 'sh', '-c', 'if command -v sqlite3 >/dev/null 2>&1; then sqlite3 -readonly ' + path + ' "PRAGMA integrity_check;"; else printf "UNAVAILABLE: sqlite3 absent in read-only monitor"; fi'], ctx.signal)).trim();
  if (integrity !== 'ok' && integrity !== 'UNAVAILABLE: sqlite3 absent in read-only monitor') throw Error('SQLite integrity check failed');
  return { file: database, sha256: hash(bytes), bytes: bytes.length, pageSize, integrity, scope: 'Native idle SQLite bytes; no score-write claim' };
}
export async function saved(ctx, c) {
  const state = (await native(ctx))?.state;
  if (!state || state.Running || state.ExitCode !== 0 || state.OOMKilled) throw Error('Native DDRace stop not clean');
  if (!ctx.ddnet?.marker || await c.read(markerFile) !== ctx.ddnet.marker) throw Error('Owned DDRace marker changed');
  const hashes = [];
  for (const file of [markerFile, config]) {
    const text = await c.read(file);
    if (!text.trim()) throw Error('Empty retained file: ' + file);
    hashes.push({ file, sha256: hash(text) });
  }
  const db = await diskDatabase(ctx); hashes.push({ file: db.file, sha256: db.sha256 });
  return { marker: ctx.ddnet.marker, hashes, database: db, exitCode: state.ExitCode, ...limits };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  for (const file of [markerFile, config]) {
    if (hash(await c.read(file)) !== saved.hashes.find(x => x.file === file).sha256) throw Error('DDRace retained file changed: ' + file);
  }
  const db = await diskDatabase(ctx);
  if (db.sha256 !== saved.hashes.find(x => x.file === database).sha256) throw Error('Idle DDRace database changed across reload');
  return { native: await readback(ctx), markerRetained: true, configRetained: true, databaseRetained: true, database: db, ...limits };
}
