import dgram from 'node:dgram';
import { createHash, randomUUID } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

export const registration = {
  sven: {
    recipe: 'svencoop/egg-sven-co-op.json', ports: 1,
    environment: { AUTO_UPDATE: '0', VOLTRA_SOURCE_THIRD: 'sven', SC_NAME: 'Validator Sven', SC_MAP: 'svencoop1', SC_PLAYERS: '8', SC_PASSWORD: '', RCON_PASSWORD: '' },
  },
};
const config = '/svencoop/server.cfg';
const managed = '/svencoop/voltra_managed.cfg';
const markerFile = '/validator-sven-persistence.txt';
const scope = 'Empty dedicated-server operator config retention only; no player progression, gameplay, world save or WAN claim';
const digest = text => createHash('sha256').update(text).digest('hex');
const stopProofs = new WeakMap();
async function chainHashes(ctx, c) {
  const profile = h.profileFromRuntime(ctx.game.recipe, receipt);
  const startup = 'exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/source_third_runtime.py';
  const served = (await h.api('/api/application/servers/' + ctx.fixture.server.id)).attributes;
  if (ctx.game.testStartup || profile.egg.startup !== startup || served.uuid !== ctx.fixture.server.uuid || served.egg !== ctx.fixture.egg.id || served.container?.startup_command !== startup) throw Error('Sven canonical startup changed');
  const variables = (await h.api('/api/client/servers/' + ctx.fixture.server.uuid + '/startup')).data;
  if (!Array.isArray(variables) || variables.some(v => { const a = v.attributes; return a?.env_variable === 'SC_REGION' && (a.user_viewable !== false || a.user_editable !== false); })) throw Error('Sven region remains exposed');
  if (profile.egg.variables.some(v => v.env_variable === 'SC_REGION' && (v.user_viewable !== false || v.user_editable !== false))) throw Error('Sven canonical region remains exposed');
  const hashes = {};
  for (const match of profile.egg.scripts.installation.script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)) {
    if (!/^\.voltra\/[a-z0-9_]+\.py$/.test(match[1])) continue;
    const path = '/' + match[1], expected = digest(match[3] + '\n');
    if (hashes[path] || digest(await c.read(path)) !== expected) throw Error('Sven canonical helper mismatch: ' + path);
    hashes[path] = expected;
  }
  for (const name of ['source_third_runtime', 'source_third_install', 'source_runtime', 'native_console', 'source_l4d']) if (!hashes['/.voltra/' + name + '.py']) throw Error('Missing frozen Sven helper: ' + name);
  for (const [path, expected] of Object.entries({ '/svends_run': 'ea85064073709d24bae8abcc29d4bff7bf70b5cf82aeeb3a4372a17bcaee9b2c', '/.voltra-svends-run-exec': 'ce155394e8043334f97d5e9439c2c114ee4f69470f32086ffd1016615fa20148' })) {
    if (digest(await c.read(path)) !== expected) throw Error('Sven publisher launcher drift');
    hashes[path] = expected;
  }
  if (/^\s*sv_region\b/im.test(await c.read(managed))) throw Error('Sven managed config still generates region');
  return hashes;
}
async function cleanStop(ctx, c) {
  const container = await native(ctx), state = container?.state, proof = stopProofs.get(ctx);
  if (await c.state() !== 'offline' || !state || state.Running || state.ExitCode !== 0 || state.OOMKilled || state.Dead || !proof || proof.containerId !== container.id || proof.startedAt !== state.StartedAt || !(Date.parse(state.StartedAt) >= ctx.startRequestedAt)) throw Error('Sven clean native stop unproved');
  const text = await logs(ctx, state.StartedAt);
  const markers = [...text.matchAll(/^VOLTRA_SVEN_NATIVE_CHILD_RETURN (-?\d+)\r?$/gm)];
  if (markers.length !== 1 || markers[0][1] !== '0') throw Error('Sven actual native child return missing/nonzero');
  if (JSON.stringify(await chainHashes(ctx, c)) !== JSON.stringify(proof.hashes)) throw Error('Sven stopped launch chain changed');
  const result = { ...proof, engineNumericExit: 0, containerExit: state.ExitCode, oomKilled: state.OOMKilled };
  await ctx.artifact('sven-stop-proof.json', JSON.stringify(result, null, 2));
  return state;
}
async function engineProof(ctx, c, container) {
  // Only sanitized identities leave the container. Never emit argv or proc errors:
  // Source launch arguments can contain the fixture's RCON credential.
  const script = String.raw`
import os, json, hashlib
from pathlib import Path
root = Path('/home/container')
paths = json.loads(os.environ['VOLTRA_PROOF_PATHS'])
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
            if exe not in ['/home/container/svends_i686', '/home/container/svends_amd']: continue
            parent = ppid(pid)
            args, supervisor = argv(pid), argv(parent)
            direct = any(x == b'/home/container/.voltra/source_third_runtime.py' or x == b'.voltra/source_third_runtime.py' for x in supervisor[1:2]) and os.readlink(Path('/proc', str(parent), 'exe')) == str((root / '.voltra/python/bin/python3').resolve())
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
  const expected = await chainHashes(ctx, c);
  let proof;
  try {
    proof = JSON.parse(await docker(['exec', '-e', 'VOLTRA_PROOF_PATHS=' + JSON.stringify(Object.keys(expected).map(p => p.slice(1))), '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', container.id, '/home/container/.voltra/python/bin/python3', '-c', script], ctx.signal, 10000));
  } catch { throw Error('Sven direct engine identity probe failed'); }
  await ctx.artifact('engine-identity-probe.json', JSON.stringify(proof, null, 2));
  const engine = proof.engines?.[0];
  const current = await native(ctx);
  if (!current?.state.Running || current.id !== container.id || current.state.StartedAt !== container.state.StartedAt) throw Error('Sven engine container changed during proof');
  if (!proof.ok || proof.engines?.length !== 1 || !engine?.directSupervisor || !engine.norestart || !engine.noDebug || !Number.isInteger(engine.pid) || !Number.isInteger(engine.ppid)) throw Error('Sven direct engine child/no-restart/no-debug identity unproved');
  const hashes = await chainHashes(ctx, c);
  if (JSON.stringify(hashes) !== JSON.stringify(expected)) throw Error('Sven launch chain changed; review exit propagation before acceptance');
  if (JSON.stringify(hashes) !== JSON.stringify(proof.hashes)) throw Error('Sven helper hashes changed during engine proof');
  const result = { containerId: container.id, startedAt: container.state.StartedAt, engine, hashes };
  stopProofs.set(ctx, result);
  await ctx.artifact('direct-engine-proof.json', JSON.stringify(result, null, 2));
  return result;
}
function supported(ctx) {
  if (ctx.game.family !== 'sven' || ctx.game.recipe !== registration.sven.recipe || ctx.fixture?.recipe !== ctx.game.recipe || ctx.fixture?.server?.uuid !== ctx.game.serverUUID || ctx.fixture.server.name !== 'validator-' + ctx.game.id) throw Error('Exact owned Sven fixture required');
  const port = ctx.fixture.ports?.[0];
  if (ctx.fixture.ports.length !== 1 || !Number.isInteger(port) || port < 1025 || port > 65535) throw Error('Sven requires one primary UDP allocation');
}
export function retentionPaths(ctx) {
  supported(ctx);
  return [markerFile, config, managed, '/svencoop/voltra_server.cfg', '/svencoop/voltra_bootstrap.cfg', '/svends_run', '/.voltra-svends-run-exec'];
}
export function restoreContext(ctx, saved) {
  supported(ctx);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(saved?.marker ?? '')) throw Error('Missing owned Sven marker');
  if (!/^[a-f0-9]{64}$/.test(saved.operatorHash ?? '')) throw Error('Missing Sven operator config baseline');
  ctx.sven = { marker: saved.marker, edited: true, operatorHash: saved.operatorHash };
}
export async function prerequisites(ctx) {
  supported(ctx);
  return { required: false, protocol: 'A2S_INFO with challenge', scope };
}

// Keep a socket across challenge and response. Ignore packets from other peers.
async function exchange(ctx, initial, receive) {
  ctx.signal.throwIfAborted();
  const socket = dgram.createSocket('udp4'), port = ctx.fixture.ports[0];
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer); ctx.signal.removeEventListener('abort', abort);
      socket.close(); error ? reject(error) : resolve(value);
    };
    const abort = () => finish(Error('Sven UDP proof aborted'));
    const timer = setTimeout(() => finish(Error('Sven UDP proof timed out')), 4000);
    const send = bytes => socket.send(bytes, port, '127.0.0.1', error => { if (error) finish(Error('Sven UDP send failed')); });
    socket.on('error', () => finish(Error('Sven UDP socket failed')));
    socket.on('message', (data, peer) => {
      if (finished || peer.address !== '127.0.0.1' || peer.port !== port) return;
      try {
        if (data.length < 5 || data.length > 16384 || data.readInt32LE(0) !== -1) throw Error('Unsupported Sven UDP framing');
        const result = receive(data, send);
        if (result !== undefined) finish(null, result);
      } catch (error) { finish(error); }
    });
    ctx.signal.addEventListener('abort', abort, { once: true });
    send(initial);
    if (ctx.signal.aborted) abort();
  });
}
async function query(ctx) {
  const request = Buffer.from('\xff\xff\xff\xffTSource Engine Query\0', 'latin1');
  let challenged = false;
  return exchange(ctx, request, (data, send) => {
    if (data[4] === 0x41) {
      if (challenged || data.length !== 9) throw Error('Invalid/repeated Sven A2S challenge');
      challenged = true; send(Buffer.concat([request, data.subarray(5)])); return;
    }
    if (data[4] !== 0x49 || data[5] !== 17) throw Error('Unsupported Sven A2S_INFO response');
    let offset = 6;
    const string = () => {
      const end = data.indexOf(0, offset);
      if (end < 0) throw Error('Truncated Sven A2S string');
      const value = data.subarray(offset, end).toString('utf8'); offset = end + 1; return value;
    };
    const name = string(), map = string(), folder = string(), game = string();
    if (offset + 9 > data.length) throw Error('Truncated Sven A2S fields');
    const appId = data.readUInt16LE(offset), players = data[offset + 2], maxplayers = data[offset + 3], bots = data[offset + 4];
    const serverType = data[offset + 5], environment = data[offset + 6], visibility = data[offset + 7], vac = data[offset + 8]; offset += 9;
    const version = string();
    if (folder !== 'svencoop' || !/Sven/i.test(game) || !version || players > maxplayers || bots > players || maxplayers < 2 || maxplayers > 32 || serverType !== 100 || environment !== 108 || visibility > 1 || vac > 1) throw Error('Invalid Sven A2S identity/values');
    return { name, map, folder, game, appId, players, maxplayers, bots, password: !!visibility, version, challenged };
  });
}
async function readback(ctx, c) {
  const info = await query(ctx), edited = ctx.sven?.edited === true;
  if (info.name !== (edited ? 'Validator Sven edited' : 'Validator Sven') || info.map !== (edited ? 'stadium4' : 'svencoop1') || info.maxplayers !== (edited ? 6 : 8) || info.players !== 0 || info.bots !== 0 || info.password) throw Error('Sven native name/map/capacity/empty-server mismatch');
  return { query: info };
}
export async function ready(ctx, c) {
  supported(ctx);
  const container = await native(ctx), state = container?.state;
  if (!state || !(Date.parse(state.StartedAt) >= ctx.startRequestedAt)) return false;
  if (!state.Running) throw Error('Sven exited before readiness: wrapper exit ' + state.ExitCode);
  const text = await logs(ctx, new Date(ctx.startRequestedAt).toISOString());
  if (!/^VOLTRA_SOURCE_THIRD_MAP_READY\r?$/m.test(text) || await c.state() !== 'running') return false;
  return { startedAt: state.StartedAt, native: await readback(ctx, c), processProof: await engineProof(ctx, c, container) };
}
export async function settings(ctx, c) {
  supported(ctx);
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'Sven settings stop');
  await cleanStop(ctx, c);
  const original = await c.read(config);
  ctx.sven = { marker: randomUUID(), edited: true, operatorHash: digest(original) };
  await c.write(markerFile, ctx.sven.marker);
  // Only standard setup environment fields. No startup or installer override.
  await h.api('/api/application/servers/' + ctx.fixture.server.id + '/startup', 'PATCH', { environment: { SC_NAME: 'Validator Sven edited', SC_MAP: 'stadium4', SC_PLAYERS: '6' } });
  ctx.startRequestedAt = Date.now(); await c.power('start');
  const result = await wait(ctx, () => ready(ctx, c), 'Sven edited readiness');
  if (await c.read(config) !== original) throw Error('Sven operator config changed');
  return { environment: { SC_NAME: 'Validator Sven edited', SC_MAP: 'stadium4', SC_PLAYERS: '6' }, native: result, scope };
}
export async function saved(ctx, c) {
  supported(ctx);
  const nativeStop = await cleanStop(ctx, c), hashes = {};
  for (const path of retentionPaths(ctx)) {
    const content = await c.read(path);
    if (!content.trim()) throw Error('Missing Sven retained file: ' + path);
    hashes[path] = digest(content);
  }
  if (!ctx.sven?.marker || await c.read(markerFile) !== ctx.sven.marker || hashes[config] !== ctx.sven.operatorHash) throw Error('Sven marker/operator config baseline changed');
  return { marker: ctx.sven.marker, operatorHash: ctx.sven.operatorHash, hashes, engineNumericExit: 0, engineExitProven: true, nativeStop, scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  if (saved.engineNumericExit !== 0 || saved.engineExitProven !== true || saved.hashes?.[config] !== saved.operatorHash) throw Error('Sven baseline lacks actual engine/config proof');
  for (const path of retentionPaths(ctx)) if (!saved.hashes?.[path] || digest(await c.read(path)) !== saved.hashes[path]) throw Error('Sven retained file changed: ' + path);
  if (await c.read(markerFile) !== saved.marker) throw Error('Sven retained marker mismatch');
  const fresh = await ready(ctx, c);
  if (!fresh) throw Error('Sven fresh reload readiness missing');
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'Sven reload stop');
  const nativeStop = await cleanStop(ctx, c);
  for (const path of retentionPaths(ctx)) if (digest(await c.read(path)) !== saved.hashes[path]) throw Error('Sven reload stop changed retained file: ' + path);
  return { native: fresh, nativeStop, markerRetained: true, configRetained: true, scope };
}
