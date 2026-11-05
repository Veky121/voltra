import dgram from 'node:dgram';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { campaign as h, docker, receipt } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Frozen candidate5 / wave58 recipe. Historical fof-live-acceptance.json SHA256 24df72e10c8c7bc60096cffef31b603bfcb2decef86cbc46a9bc353a68ecf17c is context only. Registration/integration is a separate coordinator edit.
export const registration = { fof: {
  recipe: 'fof/egg-fof.json', ports: 3,
  environment: { SRCDS_APPID: '295230', SRCDS_GAME: 'fof', AUTO_UPDATE: '0', VOLTRA_STEAM_AUTO_UPDATE: '0', VALIDATE: '0', HOSTNAME: 'Validator FoF', SRCDS_MAP: 'fof_revenge', MAX_PLAYERS: '8', SERVER_PASSWORD: '', STEAM_GSLT: '', PUBLIC_SERVER: '0', TV_ENABLE: '0', SRCDS_CPORT: '0', SRCDS_STV: '0', RCON_PASSWORD: 'validator-fof-local-only' },
} };
const archive = '/validator-fof-retained.cfg';
const markerFile = '/validator-fof-persistence.txt';
const scope = 'N/A: session arena; retained gameplay configuration and archived comment marker only, no survival world, player, gameplay, VScript execution or WAN proof';
const hash = text => createHash('sha256').update(text).digest('hex');
const stopProofs = new WeakMap();
const reviewedHelpers = {
  "/.voltra/steam_template.py": "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
  "/.voltra/source_install.py": "a1f63dd97984ed20dba5b5af6fddfaff5efdd15f7666231b32728da0c5f54a13",
  "/.voltra/bundle_debian_python.py": "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",
  "/.voltra/native_console.py": "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",
  "/.voltra/source_runtime.py": "f04a64a44b49a03ad45af79d61698b413b27c0ee999081696024085944633752",
  "/.voltra/source_variant_runtime.py": "6a22ec1d61167233f22be3332d409369bc3f0119e0308f6a89482cbeb6c200b3",
  "/.voltra/source_pair_preflight.py": "017d25ca65651161301bb11e56684786c79cebfe678344d9e669ad26f188083b",
  "/.voltra/source_variants_wave58.py": "e93e35cfb31eecace31054e937fa705d53b9ff8a142fc1e61db7218c3ba1fd03"
};
const chainPaths = [...Object.keys(reviewedHelpers), '/srcds_run'];
async function chainHashes(c) {
  const hashes = {};
  for (const path of chainPaths) {
    hashes[path] = hash(await c.read(path));
    if (reviewedHelpers[path] && hashes[path] !== reviewedHelpers[path]) throw Error('FoF candidate5 helper authority mismatch: ' + path);
  }
  return hashes;
}
async function engineProof(ctx, c, container) {
  // Only sanitized identities leave the container. Never emit argv or proc errors:
  // Source launch arguments can contain the fixture's RCON credential.
  const script = String.raw`
import os, json, hashlib
from pathlib import Path
root = Path('/home/container')
paths = ['.voltra/steam_template.py', '.voltra/source_install.py', '.voltra/bundle_debian_python.py', '.voltra/native_console.py', '.voltra/source_runtime.py', '.voltra/source_variant_runtime.py', '.voltra/source_pair_preflight.py', '.voltra/source_variants_wave58.py', 'srcds_run']
def argv(pid):
    return Path('/proc', str(pid), 'cmdline').read_bytes().split(b'\0')[:-1]
def ppid(pid):
    return int(next(x.split()[1] for x in Path('/proc', str(pid), 'status').read_text().splitlines() if x.startswith('PPid:')))
try:
    sources = {p: (root / p).read_bytes() for p in paths}
    found = []
    for entry in list(Path('/proc').iterdir())[:65536]:
        if not entry.name.isdigit(): continue
        try:
            pid = int(entry.name)
            exe = os.readlink(entry / 'exe')
            if exe not in ['/home/container/srcds_linux', '/home/container/srcds_linux64']: continue
            parent = ppid(pid)
            args, supervisor = argv(pid), argv(parent)
            direct = any(x == b'/home/container/.voltra/source_variants_wave58.py' or x == b'.voltra/source_variants_wave58.py' for x in supervisor[1:2]) and os.readlink(Path('/proc', str(parent), 'exe')) == str((root / '.voltra/python/bin/python3').resolve()) and supervisor[2:] == [b'295230']
            shell = ppid(parent)
            shellArgs = argv(shell)
            tini = os.readlink('/proc/1/exe') == '/usr/bin/tini' and argv(1) == [b'/usr/bin/tini', b'-g', b'--', b'/entrypoint.sh']
            outer = tini and (shell == 1 or (ppid(shell) == 1 and os.path.basename(os.readlink(Path('/proc', str(shell), 'exe'))) == 'bash' and b'/entrypoint.sh' in shellArgs))
            entryHash = hashlib.sha256(Path('/entrypoint.sh').read_bytes()).hexdigest()
            direct = direct and outer and entryHash == '32ae2a4f09300d31db2e10379a935614fc95f743da134eefbef61019dd4da4c4'
            norestart = b'-norestart' in args
            noDebug = not any(x.lower() in [b'-debug', b'-debugger'] for x in args)
            # Re-read identity to reject a disappearing/reparented process.
            if os.readlink(entry / 'exe') != exe or ppid(pid) != parent: raise ValueError()
            found.append(dict(pid=pid, ppid=parent, shellPid=shell, outerChain=outer, entrypointSHA256=entryHash, executable=exe, directSupervisor=direct, norestart=norestart, noDebug=noDebug))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    print(json.dumps(dict(ok=True, engines=found, hashes={'/' + p: hashlib.sha256(v).hexdigest() for p,v in sources.items()})))
except Exception:
    print(json.dumps(dict(ok=False)))
`;
  let proof;
  try {
    proof = JSON.parse(await docker(['exec', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', container.id, '/home/container/.voltra/python/bin/python3', '-c', script], ctx.signal, 10000));
  } catch { throw Error('FoF direct engine identity probe failed'); }
  await ctx.artifact('engine-identity-probe.json', JSON.stringify(proof, null, 2));
  const engine = proof.engines?.[0];
  if (!proof.ok || proof.engines?.length !== 1 || !engine?.directSupervisor || !engine.norestart || !engine.noDebug || !Number.isInteger(engine.pid) || !Number.isInteger(engine.ppid)) throw Error('FoF direct engine child/no-restart/no-debug identity unproved');
  const current = await native(ctx);
  if (!current?.state.Running || current.id !== container.id || current.state.StartedAt !== container.state.StartedAt) throw Error('FoF container changed during identity proof');
  const hashes = await chainHashes(c);
  if (JSON.stringify(hashes) !== JSON.stringify(proof.hashes)) throw Error('FoF helper hashes changed during engine proof');
  const result = { containerId: container.id, startedAt: container.state.StartedAt, engine, hashes };
  stopProofs.set(ctx, result);
  await ctx.artifact('direct-engine-proof.json', JSON.stringify(result, null, 2));
  return result;
}
function supported(ctx) {
  if (ctx.fixture?.server && (ctx.fixture.recipe !== registration.fof.recipe || ctx.fixture.server.uuid !== ctx.game.serverUUID || ctx.fixture.server.name !== 'validator-' + ctx.game.id)) throw Error('FoF owned fixture mismatch');
  if (ctx.game.family !== 'fof' || ctx.game.recipe !== registration.fof.recipe) throw Error('FoF family/recipe mismatch');
}
export function retentionPaths(ctx) {
  supported(ctx);
  return [markerFile, '/fof/cfg/server.cfg', '/fof/cfg/voltra-managed.cfg', '/fof/cfg/voltra-server.cfg', archive];
}
export function restoreContext(ctx, saved) {
  supported(ctx);
  if (!/^[a-f0-9-]{36}$/.test(saved?.marker ?? '') || !/^[a-f0-9]{64}$/.test(saved?.operatorHash ?? '')) throw Error('Missing FoF persistence baseline');
  ctx.fof = { marker: saved.marker, operatorHash: saved.operatorHash };
}
export async function prerequisites(ctx) {
  supported(ctx);
  const ports = ctx.fixture?.ports;
  if (ports?.length !== 3 || new Set(ports).size !== 3 || ports.some(p => !Number.isInteger(p) || p < 1025 || p > 65535)) throw Error('FoF requires three distinct allocations');
  const profile = h.profileFromRuntime(ctx.game.recipe, receipt);
  const startup = 'exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/source_variants_wave58.py 295230';
  const served = (await h.api('/api/application/servers/' + ctx.fixture.server.id)).attributes;
  if (ctx.game.testStartup || profile.egg.startup !== startup || served.uuid !== ctx.fixture.server.uuid || served.egg !== ctx.fixture.egg.id || served.container?.startup_command !== startup) throw Error('FoF canonical startup authority changed');
  for (const [key, value] of Object.entries(registration.fof.environment)) if (ctx.game.environment?.[key] !== value) throw Error('FoF fixture environment mismatch: ' + key);
  return { required: false, queryPort: ports[0], protocol: 'A2S_INFO UDP and Source RCON TCP', scope };
}
function assertInfo(info) {
  if (info.appId !== 265630 || info.folder !== 'fof' || info.map !== 'fof_revenge' || info.name !== 'Validator FoF' || info.maxplayers !== 8 || info.players !== 0 || info.bots !== 0 || info.password) throw Error('FoF A2S identity/map/capacity mismatch');
}
// Source uses length-prefixed TCP RCON, not Quake connectionless UDP RCON.
async function rcon(ctx, command) {
  ctx.signal.throwIfAborted();
  const password = ctx.game.environment?.RCON_PASSWORD;
  if (!password || /[\x00\r\n]/.test(password)) throw Error('Missing fixture RCON credential');
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = Buffer.alloc(0), output = '', authenticated = false, finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true; clearTimeout(timer); ctx.signal.removeEventListener('abort', abort); socket.destroy();
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(ctx.signal.reason ?? Error('Aborted'));
    const timer = setTimeout(() => finish(Error('FoF TCP RCON timeout')), 5000);
    const send = (id, type, body) => {
      const bytes = Buffer.from(body), packet = Buffer.alloc(bytes.length + 14);
      packet.writeInt32LE(bytes.length + 10); packet.writeInt32LE(id, 4); packet.writeInt32LE(type, 8); bytes.copy(packet, 12); socket.write(packet);
    };
    socket.on('error', () => finish(Error('FoF TCP RCON connection failed')));
    socket.on('close', () => { if (!finished) finish(Error('FoF TCP RCON closed before response fence')); });
    socket.on('data', chunk => {
      try {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > 1048576) throw Error('Oversized RCON response');
        while (buffer.length >= 4) {
          const size = buffer.readInt32LE(0);
          if (size < 10 || size > 4096) throw Error('Invalid Source RCON packet length');
          if (buffer.length < size + 4) break;
          const packet = buffer.subarray(0, size + 4); buffer = buffer.subarray(size + 4);
          const id = packet.readInt32LE(4), type = packet.readInt32LE(8);
          if (packet.at(-1) || packet.at(-2)) throw Error('Invalid RCON terminator');
          if (id === -1) throw Error('FoF RCON authentication refused');
          if (!authenticated) {
            if (id === 101 && type === 2) { authenticated = true; send(102, 2, command); send(103, 0, ''); }
          } else if (id === 102 && type === 0) {
            output += packet.subarray(12, -2).toString('utf8');
            if (output.length > 262144) throw Error('Oversized RCON command output');
          } else if (id === 103 && type === 0) { finish(null, output); return; }
        }
      } catch (error) { finish(error); }
    });
    ctx.signal.addEventListener('abort', abort, { once: true });
    socket.connect(ctx.fixture.ports[0], '127.0.0.1', () => send(101, 3, password));
    if (ctx.signal.aborted) abort();
  });
}
export async function ready(ctx, c) {
  supported(ctx);
  const container = await native(ctx), state = container?.state;
  if (!state || !(Date.parse(state.StartedAt) >= ctx.startRequestedAt)) return false;
  if (!state.Running) {
    await ctx.artifact('startup-failure.log', await logs(ctx));
    throw Error('Native FoF exited before readiness: ' + state.ExitCode);
  }
  let info, status;
  try { info = await query(ctx); status = await rcon(ctx, 'status'); }
  catch (error) {
    if (/timed out|timeout|connection failed|closed before response fence/.test(error.message)) return false;
    throw error;
  }
  await ctx.artifact('native-query-latest.json', info);
  assertInfo(info);
  if (!/map\s*:\s*fof_revenge\b/i.test(status)) throw Error('FoF native status map missing');
  if (await c.state() !== 'running') return false;
  const processProof = await engineProof(ctx, c, container);
  if (ctx.fof?.marker) await nativeTimeLimit(ctx);
  await ctx.artifact('startup.log', await logs(ctx));
  return { startedAt: state.StartedAt, query: info, nativeStatus: status, processProof };
}
async function cleanStop(ctx, c) {
  const container = await native(ctx), state = container?.state, proof = stopProofs.get(ctx);
  if (await c.state() !== 'offline' || !state || state.Running || state.ExitCode !== 0 || state.OOMKilled || state.Dead || !(Date.parse(state.StartedAt) >= ctx.startRequestedAt)) throw Error('FoF stop did not exit cleanly');
  const text = await logs(ctx, state.StartedAt); await ctx.artifact('stop.log', text);
  if (!proof || proof.containerId !== container.id || proof.startedAt !== state.StartedAt || JSON.stringify(await chainHashes(c)) !== JSON.stringify(proof.hashes)) throw Error('FoF stopped container lacks matching direct-engine/helper proof');
  // The observed direct native child excludes a launcher/restart intermediary.
  // Frozen wave58 returns runtime.run(), whose native_console returns child.wait();
  // SystemExit propagates that numeric status through the unchanged entrypoint.
  await ctx.artifact('clean-stop-proof.json', JSON.stringify({ ...proof, exitCode: state.ExitCode, oomKilled: state.OOMKilled, stopped: true }, null, 2));
  return state;
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
    const timer = setTimeout(() => finish(Error('FoF A2S query timed out')), 3000);
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
  if (data.length < 6 || data.length > 16384 || data.readInt32LE(0) !== -1 || data[4] !== 0x49) throw Error('Invalid FoF A2S_INFO framing');
  let offset = 6;
  const string = () => {
    const end = data.indexOf(0, offset);
    if (end < 0) throw Error('Truncated A2S string');
    const value = data.subarray(offset, end).toString('utf8'); offset = end + 1; return value;
  };
  const name = string(), map = string(), folder = string(), game = string();
  if (offset + 9 > data.length) throw Error('Truncated A2S fields');
  const legacyAppId = data.readUInt16LE(offset), players = data[offset + 2], maxplayers = data[offset + 3], bots = data[offset + 4];
  const serverType = String.fromCharCode(data[offset + 5]), environment = String.fromCharCode(data[offset + 6]);
  const visibility = data[offset + 7], vac = data[offset + 8]; offset += 9;
  const version = string();
  // Match the installed GameDig Valve decoder: EDF game ID carries the full
  // application ID; FoF's old 16-bit field is zero.
  let appId = legacyAppId, gameId;
  const skip = n => { if (offset + n > data.length) throw Error('Truncated FoF EDF'); offset += n; };
  if (offset < data.length) {
    const flags = data[offset++];
    if (flags & 0x80) skip(2);
    if (flags & 0x10) skip(8);
    if (flags & 0x40) { skip(2); string(); }
    if (flags & 0x20) string();
    if (flags & 0x01) { skip(8); const id = data.readBigUInt64LE(offset - 8); gameId = id.toString(); appId = Number(id & 0xffffffn); }
  }
  if (data[5] !== 17 || players > maxplayers || bots > players || maxplayers < 1 || visibility > 1 || vac > 1 || serverType !== 'd' || environment !== 'l') throw Error('Invalid FoF A2S values');
  return { protocol: data[5], name, map, folder, game, legacyAppId, appId, gameId, players, maxplayers, bots, serverType, environment, password: !!visibility, vac: !!vac, version };
}


async function nativeTimeLimit(ctx) {
  const text = await rcon(ctx, 'mp_timelimit');
  await ctx.artifact('native-mp-timelimit.json', { response: text });
  if (!/"mp_timelimit"\s*=\s*"17(?:\.0+)?"/.test(text)) throw Error('FoF native mp_timelimit readback differs');
  return { key: 'mp_timelimit', value: 17, responseSha256: hash(text) };
}
export async function settings(ctx, c) {
  supported(ctx); await chainHashes(c);
  const initialNative = await rcon(ctx, 'mp_timelimit');
  const measured = initialNative.match(/"mp_timelimit"\s*=\s*"([0-9]+(?:\.[0-9]+)?)"/)?.[1];
  if (measured === undefined || Number(measured) > 20) throw Error('FoF measured initial time limit outside reviewed range');
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'FoF typed edit stop'); await cleanStop(ctx, c);
  const config = '/fof/cfg/server.cfg';
  const url = '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent(config);
  const listing = (await c.api('GET', '/api/client/servers/' + ctx.fixture.server.uuid + '/files/list?directory=%2Ffof%2Fcfg')).data.map(x => x.attributes);
  const exists = listing.some(x => x.name === 'server.cfg' && x.is_file && !x.is_symlink);
  if (listing.some(x => x.name === 'server.cfg') && !exists) throw Error('FoF operator config is not a regular file');
  const initial = exists ? await c.read(config) : '';
  if (!/^\s*mp_timelimit\b/im.test(initial)) {
    const seeded = initial + '\n// Validator measured native initial setting\nmp_timelimit "' + measured + '"\n';
    await c.write(config, seeded);
    await ctx.artifact('measured-operator-seed.json', { existed: exists, previousSHA256: hash(initial), seededSHA256: hash(seeded), nativeValue: measured, nativeResponseSHA256: hash(initialNative), scope: 'Owned operator configuration preparation; not a publisher default file claim' });
  }
  const before = (await h.api(url)).attributes, original = await c.read(config);
  if (before.file !== config || !before.revision || !before.fields?.some(f => f.key === 'mp_timelimit' && f.type === 'number' && f.readonly === false)) throw Error('FoF typed mp_timelimit authority unavailable');
  const refuse = async (body, statuses) => {
    const snapshot = await c.read(config); let status;
    try { await h.api(url, 'PUT', body); }
    catch (error) { status = Number(error.message.match(/: (\d{3}) /)?.[1]); if (!statuses.includes(status)) throw error; }
    if (!status || await c.read(config) !== snapshot) throw Error('FoF invalid/stale write was not refused without changing bytes');
    return status;
  };
  const invalidStatus = await refuse({ revision: before.revision, settings: { mp_timelimit: '17;quit' } }, [400, 422]);
  await h.api(url, 'PUT', { revision: before.revision, settings: { mp_timelimit: '17' } });
  const after = (await h.api(url)).attributes;
  if (Number(after.fields?.find(f => f.key === 'mp_timelimit')?.value) !== 17) throw Error('FoF typed save readback differs');
  const marker = randomUUID(), text = await c.read(config), marked = text + '\n// validator archived marker ' + marker + '\n';
  await c.write(config, marked); await c.write(archive, marked); await c.write(markerFile, marker);
  const staleStatus = await refuse({ revision: before.revision, settings: { mp_timelimit: '18' } }, [409]);
  ctx.fof = { marker, operatorHash: hash(marked) };
  await ctx.artifact('typed-edit.json', { beforeSha256: hash(original), afterSha256: hash(marked), beforeRevision: before.revision, afterRevision: after.revision, invalidStatus, staleStatus });
  ctx.startRequestedAt = Date.now(); await c.power('start'); await wait(ctx, () => ready(ctx, c), 'FoF edited native readiness');
  return { file: config, settings: { mp_timelimit: '17' }, native: await nativeTimeLimit(ctx), invalidStatus, staleStatus, scope };
}
export async function saved(ctx, c) {
  supported(ctx);
  const state = await cleanStop(ctx, c);
  if (!ctx.fof?.marker || await c.read(markerFile) !== ctx.fof.marker) throw Error('FoF stopped operator marker baseline missing; settings gate remains open');
  const hashes = {};
  for (const path of retentionPaths(ctx)) {
    const text = await c.read(path);
    if (!text.trim()) throw Error('Empty FoF retained file: ' + path);
    hashes[path] = hash(text);
  }
  if (hashes['/fof/cfg/server.cfg'] !== ctx.fof.operatorHash || await c.read(archive) !== await c.read('/fof/cfg/server.cfg')) throw Error('FoF operator config/archive changed');
  return { ...ctx.fof, hashes, engineNumericExit: 0, engineExitProven: true, nativeStop: state, scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  if (saved.engineNumericExit !== 0 || saved.engineExitProven !== true) throw Error('FoF prior direct-engine stop proof missing');
  for (const path of retentionPaths(ctx)) if (!/^[a-f0-9]{64}$/.test(saved.hashes?.[path] ?? '') || hash(await c.read(path)) !== saved.hashes[path]) throw Error('FoF retained bytes changed: ' + path);
  if (await c.read(markerFile) !== saved.marker) throw Error('FoF retained marker mismatch');
  const fresh = await ready(ctx, c);
  if (!fresh) throw Error('FoF fresh native reload missing');
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'FoF reload stop');
  const state = await cleanStop(ctx, c);
  for (const path of retentionPaths(ctx)) if (hash(await c.read(path)) !== saved.hashes[path]) throw Error('FoF reload changed retained bytes: ' + path);
  return { native: fresh, nativeStop: state, scope };
}
