import dgram from 'node:dgram';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { campaign as h, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
import { client } from './api-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Frozen wave221 recipe. Registration/integration is a separate coordinator edit.
export const registration = { hl2dm: {
  recipe: 'half_life_2_deathmatch/egg-half--life2--deathmatch.json', ports: 3,
  environment: { SRCDS_APPID: '232370', SRCDS_GAME: 'hl2mp', AUTO_UPDATE: '0', VOLTRA_STEAM_AUTO_UPDATE: '0', VALIDATE: '0', SERVER_NAME: 'Validator HL2DM', MAP_NAME: 'dm_lockdown', MAX_PLAYERS: '8', TICK_RATE: '66', PUBLIC_SERVER: '0', TV_ENABLE: '0', SRCDS_CPORT: '0', SRCDS_STV: '0', RCON_PASSWORD: 'validator-hl2dm-local-only' },
} };
const config = '/hl2mp/cfg/voltra-gameplay.cfg';
const archive = '/validator-hl2dm-retained.cfg';
const markerFile = '/validator-hl2dm-persistence.txt';
const scope = 'N/A: session arena; retained gameplay configuration and archived comment marker only, no survival world, player, gameplay or WAN proof';
const values = { mp_timelimit: '8', mp_fraglimit: '0', mp_teamplay: false, mp_weaponstay: true, mp_friendlyfire: false, mp_flashlight: true, mp_forcerespawn: true, sv_alltalk: false, sv_voiceenable: true, sv_gravity: '550', mp_chattime: '10', sv_hl2mp_weapon_respawn_time: '20', sv_hl2mp_item_respawn_time: '30' };
const hash = text => createHash('sha256').update(text).digest('hex');
const stopProofs = new WeakMap();
const chainPaths = ['/.voltra/hl2dm_runtime.py', '/.voltra/source_runtime.py', '/.voltra/native_console.py', '/srcds_run'];
const reviewedChain = ['f3285bc82fd9a1dc758c71288b4521348ad4c0ec7224a24bd915e7c1ab093627', 'f04a64a44b49a03ad45af79d61698b413b27c0ee999081696024085944633752', 'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5', 'addadff442f0987adc84958ecb4490c2b0456aa6a0a848d6c885cd99a97b0348'];
async function chainHashes(c) {
  const hashes = {};
  for (const path of chainPaths) hashes[path] = hash(await c.read(path));
  return hashes;
}
async function engineProof(ctx, c, container) {
  // Only sanitized identities leave the container. Never emit argv or proc errors:
  // Source launch arguments can contain the fixture's RCON credential.
  const script = String.raw`
import os, json, hashlib
from pathlib import Path
root = Path('/home/container')
paths = ['.voltra/hl2dm_runtime.py', '.voltra/source_runtime.py', '.voltra/native_console.py', 'srcds_run']
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
            direct = any(x == b'/home/container/.voltra/hl2dm_runtime.py' or x == b'.voltra/hl2dm_runtime.py' for x in supervisor[1:2]) and os.path.basename(os.readlink(Path('/proc', str(parent), 'exe'))).startswith('python')
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
  } catch { throw Error('HL2DM direct engine identity probe failed'); }
  await ctx.artifact('engine-identity-probe.json', JSON.stringify(proof, null, 2));
  const engine = proof.engines?.[0];
  if (!proof.ok || proof.engines?.length !== 1 || !engine?.directSupervisor || !engine.norestart || !engine.noDebug || !Number.isInteger(engine.pid) || !Number.isInteger(engine.ppid)) throw Error('HL2DM direct engine child/no-restart/no-debug identity unproved');
  const hashes = await chainHashes(c);
  if (chainPaths.some((path, i) => hashes[path] !== reviewedChain[i])) throw Error('HL2DM launch chain changed; review exit propagation before acceptance');
  if (JSON.stringify(hashes) !== JSON.stringify(proof.hashes)) throw Error('HL2DM helper hashes changed during engine proof');
  const result = { containerId: container.id, startedAt: container.state.StartedAt, engine, hashes };
  stopProofs.set(ctx, result);
  await ctx.artifact('direct-engine-proof.json', JSON.stringify(result, null, 2));
  return result;
}
function supported(ctx) {
  if (ctx.fixture?.server && (ctx.fixture.recipe !== registration.hl2dm.recipe || ctx.fixture.server.name !== 'validator-' + ctx.game.id)) throw Error('HL2DM owned fixture mismatch');
  if (ctx.game.family !== 'hl2dm' || ctx.game.recipe !== registration.hl2dm.recipe) throw Error('HL2DM family/recipe mismatch');
}
export function retentionPaths(ctx) {
  supported(ctx);
  return [config, '/hl2mp/cfg/voltra-managed.cfg', '/hl2mp/cfg/voltra-server.cfg', archive, markerFile, ...(ctx.hl2dm?.serverConfigPresent ? ['/hl2mp/cfg/server.cfg'] : [])];
}
export function restoreContext(ctx, saved) {
  supported(ctx);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(saved?.marker ?? '')) throw Error('Missing owned HL2DM marker');
  if (typeof saved.serverConfigPresent !== 'boolean') throw Error('Missing optional server.cfg presence receipt');
  ctx.hl2dm = { marker: saved.marker, serverConfigPresent: saved.serverConfigPresent };
}
async function serverConfigPresent(ctx, c) {
  const listing = await c.api('GET', '/api/client/servers/' + ctx.fixture.server.uuid + '/files/list?directory=%2Fhl2mp%2Fcfg');
  if (!Array.isArray(listing.data)) throw Error('Missing HL2DM directory listing');
  return listing.data.some(entry => entry.attributes?.name === 'server.cfg');
}
export async function prerequisites(ctx) {
  supported(ctx);
  const ports = ctx.fixture?.ports;
  if (ports?.length !== 3 || new Set(ports).size !== 3 || ports.some(p => !Number.isInteger(p) || p < 1025 || p > 65535)) throw Error('HL2DM requires three distinct allocations');
  return { required: false, queryPort: ports[0], protocol: 'A2S_INFO UDP and Source RCON TCP', extraGate: 'Owned offline helper integrity check with exact restoration' };
}
function assertInfo(info) {
  if (info.appId !== 320 || info.folder !== 'hl2mp' || info.map !== 'dm_lockdown' || info.name !== 'Validator HL2DM' || info.maxplayers !== 8) throw Error('HL2DM A2S identity/map/capacity mismatch');
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
    const timer = setTimeout(() => finish(Error('HL2DM TCP RCON timeout')), 5000);
    const send = (id, type, body) => {
      const bytes = Buffer.from(body), packet = Buffer.alloc(bytes.length + 14);
      packet.writeInt32LE(bytes.length + 10); packet.writeInt32LE(id, 4); packet.writeInt32LE(type, 8); bytes.copy(packet, 12); socket.write(packet);
    };
    socket.on('error', () => finish(Error('HL2DM TCP RCON connection failed')));
    socket.on('close', () => { if (!finished) finish(Error('HL2DM TCP RCON closed before response fence')); });
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
          if (id === -1) throw Error('HL2DM RCON authentication refused');
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
    throw Error('Native HL2DM exited before readiness: ' + state.ExitCode);
  }
  let info, status;
  try { info = await query(ctx); status = await rcon(ctx, 'status'); }
  catch (error) {
    if (/timed out|timeout|connection failed|closed before response fence/.test(error.message)) return false;
    throw error;
  }
  assertInfo(info);
  if (!/map\s*:\s*dm_lockdown\b/i.test(status)) throw Error('HL2DM native status map missing');
  if (await c.state() !== 'running') return false;
  const processProof = await engineProof(ctx, c, container);
  await ctx.artifact('startup.log', await logs(ctx));
  return { startedAt: state.StartedAt, query: info, nativeStatus: status, processProof };
}
async function readback(ctx) {
  const info = await query(ctx); assertInfo(info);
  const replies = {};
  for (const [key, value] of Object.entries(values)) {
    const reply = await rcon(ctx, key);
    const match = reply.match(new RegExp('"' + key + '"\\s*=\\s*"([^"\\r\\n]+)"', 'i'));
    if (!match || Number(match[1]) !== Number(value)) throw Error('HL2DM native cvar mismatch: ' + key);
    replies[key] = reply;
  }
  await ctx.artifact('native-cvars.json', JSON.stringify(replies, null, 2));
  return { query: info, cvars: replies };
}
async function cleanStop(ctx, c) {
  const container = await native(ctx), state = container?.state, proof = stopProofs.get(ctx);
  if (await c.state() !== 'offline' || !state || state.Running || state.ExitCode !== 0 || state.OOMKilled || state.Dead || !(Date.parse(state.StartedAt) >= ctx.startRequestedAt)) throw Error('HL2DM stop did not exit cleanly');
  const text = await logs(ctx); await ctx.artifact('stop.log', text);
  if (!proof || proof.containerId !== container.id || proof.startedAt !== state.StartedAt || JSON.stringify(await chainHashes(c)) !== JSON.stringify(proof.hashes)) throw Error('HL2DM stopped container lacks matching direct-engine/helper proof');
  // Reviewed installed chain: source_runtime uses -norestart; srcds_run execs
  // HL_CMD without RESTART/DEBUG; native_console returns child.wait();
  // hl2dm_runtime exits with main()/run() status. The observed direct engine
  // child therefore propagates numeric zero through that hash-bound chain.
  await ctx.artifact('clean-stop-proof.json', JSON.stringify({ ...proof, exitCode: state.ExitCode, oomKilled: state.OOMKilled, stopped: true }, null, 2));
  return state;
}
// Frozen wave485 bundled helpers. Snapshot preparation must not import changed code.
const seedHelpers = {
  'steam_template.py': '7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897',
  'source_install.py': 'a1f63dd97984ed20dba5b5af6fddfaff5efdd15f7666231b32728da0c5f54a13',
  'bundle_debian_python.py': '16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0',
  'native_console.py': reviewedChain[2], 'source_runtime.py': reviewedChain[1],
  'source_variant_runtime.py': '6a22ec1d61167233f22be3332d409369bc3f0119e0308f6a89482cbeb6c200b3',
  'hl2dm_runtime.py': reviewedChain[0],
  'hl2dm_gameplay.py': '9d8883a0f92214f8f1ad9e5fffeb2152c7953d7cf25f7048a8214740c4133c7b',
};
async function measuredCvars(ctx, label, expected) {
  const replies = {}, effective = {};
  for (const key of Object.keys(values)) {
    const reply = await rcon(ctx, key); replies[key] = reply;
    const matches = [...reply.matchAll(new RegExp('^\\s*"' + key + '"\\s*=\\s*"([^"\\r\\n]+)"', 'gmi'))];
    if (matches.length !== 1) throw Error('HL2DM native scalar missing or ambiguous: ' + key);
    const value = matches[0][1], number = Number(value);
    if (value.length > 32 || !/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(value) || !Number.isFinite(number) || number < 0 || number > 3.4028234e38 || number !== 0 && Math.fround(number) === 0 || typeof values[key] === 'boolean' && !['0', '1'].includes(value) || key === 'mp_chattime' && (number < 1 || number > 120) || ['mp_timelimit', 'mp_fraglimit'].includes(key) && number > 2147483520 || key === 'mp_fraglimit' && !Number.isInteger(number)) throw Error('Invalid measured HL2DM scalar: ' + key);
    effective[key] = value;
  }
  await ctx.artifact(label + '.json', JSON.stringify({ effective, replies }, null, 2));
  if (expected && Object.keys(values).some(key => Number(effective[key]) !== Number(expected[key]))) throw Error('HL2DM canonical seed changed measured native gameplay');
  return effective;
}
async function gameplaySnapshot(ctx, c, effective, previous) {
  supported(ctx);
  if (!ctx.fixture?.server || ctx.fixture.server.name !== 'validator-' + ctx.game.id) throw Error('HL2DM seed requires exact owned fixture');
  const container = await native(ctx);
  if (!container?.id || !!container.state.Running !== !previous || await c.state() !== (previous ? 'offline' : 'running')) throw Error('HL2DM seed fixture state mismatch');
  const script = String.raw`
import sys, os, json, hashlib, stat
from pathlib import Path
sys.dont_write_bytecode = True
root = Path('/home/container')
if root.is_symlink() or root.resolve() != root: raise ValueError('Unsafe fixture root')
expected, effective, previous = json.loads(sys.argv[1]), json.loads(sys.argv[2]), json.loads(sys.argv[3])
# Check every path component and exact source bytes before importing helpers.
for relative in ['.voltra', 'hl2mp', 'hl2mp/cfg', *['.voltra/'+name for name in expected]]:
    target = root/relative
    mode = target.lstat().st_mode
    if stat.S_ISLNK(mode) or not (stat.S_ISDIR(mode) if relative in ['.voltra','hl2mp','hl2mp/cfg'] else stat.S_ISREG(mode)):
        raise ValueError('Unsafe seed path/type')
for name, digest in expected.items():
    if hashlib.sha256((root/'.voltra'/name).read_bytes()).hexdigest() != digest: raise ValueError('Changed bundled helper')
sys.path.insert(0, str(root/'.voltra'))
import hl2dm_gameplay as gameplay
receipt = gameplay.snapshot(root, effective)
# Existing canonical files are never replaced by migration preparation.
if gameplay.read(root, gameplay.DOCUMENT, 65536) is not None:
    if previous is not None: raise ValueError('Gameplay file appeared during preparation')
    print(json.dumps({'existing':True, 'snapshot':receipt})); sys.exit(0)
if gameplay.read(root, gameplay.RECEIPT, 65536) is not None: raise ValueError('Existing seed receipt requires review')
if previous is not None:
    if receipt != previous: raise ValueError('Build/legacy/effective snapshot changed before publication')
    raw = (json.dumps(receipt, sort_keys=True, indent=2)+'\n').encode()
    if len(raw)>65536: raise ValueError('Seed receipt exceeds size limit')
    from steam_template import _publication_parent, _publication_leaf
    with _publication_parent(root, gameplay.RECEIPT) as (parent, leaf, volume):
        if parent is None or _publication_leaf(parent, leaf) is not None: raise ValueError('Seed receipt destination changed')
        fd = os.open(leaf, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600, dir_fd=parent)
        try:
            with os.fdopen(os.dup(fd), 'wb') as out: out.write(raw); out.flush(); os.fsync(out.fileno())
            if os.geteuid()==0: os.fchown(fd, volume.st_uid, volume.st_gid)
            os.fsync(parent)
        finally: os.close(fd)
    if gameplay.read(root, gameplay.RECEIPT, 65536) != raw or gameplay.plan(root) is None: raise ValueError('Published seed receipt readback failed')
print(json.dumps({'existing':False, 'snapshot':receipt, 'published':previous is not None, 'helpers':expected}))
`;
  const env = ['-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib'];
  const pythonArgs = ['-B', '-c', script, JSON.stringify(seedHelpers), JSON.stringify(effective), JSON.stringify(previous ?? null)];
  let result;
  if (!previous) result = JSON.parse(await docker(['exec', ...env, container.id, '/home/container/.voltra/python/bin/python3', ...pythonArgs], ctx.signal, 30000));
  else {
    const identity = JSON.parse(await docker(['inspect', '--format', '{{json .}}', container.id], ctx.signal));
    const uuid = ctx.fixture.server.uuid, source = '/var/lib/voltra-parity-20261029/volumes/' + uuid;
    const mounts = identity?.Mounts?.filter(m => m.Destination === '/home/container');
    if (!/^[a-f0-9-]{36}$/.test(uuid) || identity?.Name !== '/' + uuid || identity.State.Running || identity.State.ExitCode !== 0 || identity.State.OOMKilled || !/^sha256:[a-f0-9]{64}$/.test(identity.Image) || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(identity.Config.User) || mounts?.length !== 1 || mounts[0].Source !== source || mounts[0].Type !== 'bind' || identity.Mounts.some(m => m.Destination.startsWith('/home/container/'))) throw Error('HL2DM offline seed identity/mount verification failed');
    const helper = 'validator-hl2dm-seed-' + randomUUID(), token = randomUUID();
    try {
      result = JSON.parse(await docker(['run', '--rm', '--pull', 'never', '--name', helper, '--label', 'voltra.hl2dm.seed=' + token, '--network', 'none', '--read-only', '--user', identity.Config.User, '--memory', '128m', '--memory-swap', '128m', '--cpus', '0.5', '--pids-limit', '32', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--mount', 'type=bind,src=' + source + ',dst=/home/container', ...env, '--entrypoint', '/home/container/.voltra/python/bin/python3', identity.Image, ...pythonArgs], ctx.signal, 30000));
    } finally {
      const ids = (await docker(['ps', '-aq', '--filter', 'name=^/' + helper + '$'], undefined, 10000)).trim();
      if (ids) {
        const label = (await docker(['inspect', '--format', '{{index .Config.Labels "voltra.hl2dm.seed"}}', ids], undefined, 10000)).trim();
        if (label !== token) throw Error('HL2DM seed cleanup ownership mismatch');
        await docker(['rm', '-f', ids], undefined, 10000);
      }
    }
  }
  await ctx.artifact(previous ? 'gameplay-seed-published.json' : 'gameplay-seed-preparation.json', JSON.stringify(result, null, 2));
  if (!result.snapshot || previous && !result.published) throw Error('HL2DM canonical snapshot proof missing');
  return result;
}
export async function settings(ctx, c) {
  supported(ctx);
  const effective = await measuredCvars(ctx, 'native-cvars-before-seed');
  const preparation = await gameplaySnapshot(ctx, c, effective);
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'HL2DM settings stop'); await cleanStop(ctx, c);
  if (!preparation.existing) {
    await gameplaySnapshot(ctx, c, effective, preparation.snapshot);
    ctx.startRequestedAt = Date.now(); await c.power('start'); await wait(ctx, () => ready(ctx, c), 'HL2DM canonical seed readiness');
    await measuredCvars(ctx, 'native-cvars-after-seed', effective);
    await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'HL2DM canonical seed stop'); await cleanStop(ctx, c);
  }
  const url = '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent(config);
  const before = (await h.api(url)).attributes;
  if (before.file !== config) throw Error('HL2DM typed settings authority missing after canonical measured seed preparation');
  await helperAuthority(ctx, c);
  for (const [key, value] of Object.entries(values)) {
    if (!before.fields?.some(f => f.key === key && f.type === (typeof value === 'boolean' ? 'boolean' : 'number') && !f.readonly)) throw Error('Missing typed HL2DM setting: ' + key);
  }
  await h.api(url, 'PUT', { revision: before.revision, settings: values });
  ctx.hl2dm = { marker: randomUUID(), serverConfigPresent: await serverConfigPresent(ctx, c) };
  const text = await c.read(config), marked = text + '\n// validator archived marker ' + ctx.hl2dm.marker + '\n';
  await c.write(config, marked); await c.write(archive, marked); await c.write(markerFile, ctx.hl2dm.marker);
  ctx.startRequestedAt = Date.now(); await c.power('start'); await wait(ctx, () => ready(ctx, c), 'HL2DM settings readiness');
  return { file: config, settings: values, native: await readback(ctx), worldSave: scope, helperHashBinding: 'see installed-helper-authority-refusal check' };
}
export async function saved(ctx, c) {
  supported(ctx); const state = await cleanStop(ctx, c);
  const marker = ctx.hl2dm?.marker;
  if (!marker || await c.read(markerFile) !== marker) throw Error('Owned HL2DM marker missing');
  const hashes = {};
  for (const path of retentionPaths(ctx)) {
    const text = await c.read(path);
    if (!text.trim()) throw Error('Empty retained HL2DM file: ' + path);
    hashes[path] = hash(text);
  }
  if (await c.read(config) !== await c.read(archive) || !(await c.read(archive)).includes('// validator archived marker ' + marker)) throw Error('HL2DM archived config marker missing');
  return { marker, hashes, serverConfigPresent: ctx.hl2dm.serverConfigPresent, exitCode: state.ExitCode, nativeExit: 'verified direct engine child status propagated through unchanged helpers', worldSave: scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  if (await serverConfigPresent(ctx, c) !== saved.serverConfigPresent) throw Error('Optional HL2DM server.cfg presence changed');
  for (const path of retentionPaths(ctx)) if (!saved.hashes?.[path] || hash(await c.read(path)) !== saved.hashes[path]) throw Error('Retained HL2DM file changed: ' + path);
  if (await c.read(markerFile) !== saved.marker || !(await c.read(archive)).includes('// validator archived marker ' + saved.marker)) throw Error('HL2DM retained marker mismatch');
  const readbackProof = await readback(ctx);
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'HL2DM reload stop');
  await cleanStop(ctx, c);
  return { native: readbackProof, markerRetained: true, configRetained: true, cleanExit: true, worldSave: scope, helperHashBinding: 'see installed-helper-authority-refusal check' };
}

// Extra gates for the coordinator:
// 1. Source fixture test: inject the exact frozen eight-helper bytes into a fake
//    file API, alter one helper byte in that in-memory fixture, and require typed
//    GET/PUT refusal. This is source-only evidence, never native acceptance.
// 2. Authorized native negative check: mutate only the exact owned offline
//    fixture helper, require GET/PUT refusal without config changes, then restore
//    exact bytes under the independent deadline. Preserve all probe artifacts.
// 3. Canonical reinstall: parked owned fixture, retentionPaths plus installer
//    metadata comparison, then fresh ready/loaded native readbacks. Keep this gate
//    separate from lifecycle and helper refusal; do not label source checks native.

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
    const timer = setTimeout(() => finish(Error('HL2DM A2S query timed out')), 3000);
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
  if (data.length < 6 || data.length > 16384 || data.readInt32LE(0) !== -1 || data[4] !== 0x49) throw Error('Invalid HL2DM A2S_INFO framing');
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
  if (data[5] !== 17 || players > maxplayers || bots > players || maxplayers < 1 || visibility > 1 || vac > 1 || serverType !== 'd' || environment !== 'l') throw Error('Invalid HL2DM A2S values');
  return { protocol: data[5], name, map, folder, game, appId, players, maxplayers, bots, serverType, environment, password: !!visibility, vac: !!vac, version };
}

export async function helperAuthority(ctx, c) {
  supported(ctx);
  if (await c.state() !== 'offline' || (await native(ctx))?.state.Running) throw Error('Authority probe requires stopped owned fixture');
  const url = '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent(config);
  const before = (await h.api(url)).attributes;
  await ctx.check('installed-helper-authority-refusal', async () => {
    const helper = '/.voltra/hl2dm_runtime.py';
    const original = await c.read(helper), beforeConfig = await c.read(config);
    await ctx.artifact('hl2dm-authority-original.py', original);
    let getStatus, putStatus;
    const refusal = async (method, body) => {
      try { await c.api(method, url, body); return 200; }
      catch (error) { if (error.message.includes('HTTP 404')) return 404; throw error; }
    };
    try {
      await c.write(helper, original + '\n# validator owned offline integrity probe\n');
      getStatus = await refusal('GET');
      putStatus = await refusal('PUT', { revision: before.revision, settings: { mp_teamplay: true } });
      if (getStatus !== 404 || putStatus !== 404 || await c.read(config) !== beforeConfig) throw Error('Changed helper did not refuse settings without writes');
    } finally {
      const restore = client({ ...ctx, signal: AbortSignal.timeout(30000) });
      await restore.write(helper, original);
      if (await restore.read(helper) !== original) throw Error('Owned helper restoration failed');
      await ctx.artifact('hl2dm-authority-restored.json', JSON.stringify({ helper, sha256: hash(original), restored: true }));
    }
    const restored = (await h.api(url)).attributes;
    if (restored.file !== config) throw Error('Restored authority unavailable');
    return { getStatus, putStatus, configUnchanged: true, helperRestoredSHA256: hash(original), scope: 'Exact owned offline fixture; native helper never executed while modified' };
  });
}
