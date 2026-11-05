import dgram from 'node:dgram';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Candidate8 frozen CS2 recipe. Main PRACTICAL-QUEUE has no accepted native
// CS2 receipt; CURRENT-PROGRESS says not_verified. No historical pass inferred.
// Root must register and admit this separately. Cold disk is a reservation,
// not a measured publisher download size. Never use the generic 4 GiB disk default.
export const registration = { cs2: {
  recipe: 'counter_strike/counter_strike_2/egg-counter--strike2.json', ports: 2,
  peakMiB: 4096, installPeakMiB: 4096, diskMiB: 65536, phaseTimeoutMs: 300000,
  environment: { SRCDS_APPID: '730', VOLTRA_SOURCE_THIRD: 'cs2', AUTO_UPDATE: '0', VOLTRA_STEAM_AUTO_UPDATE: '0', SRCDS_MAP: 'de_dust2', MAX_PLAYERS: '8', TV_PORT: '0', STEAM_GSLT: '', VAC_ENABLED: '0', RCON_ENABLED: '1', SERVER_NAME: 'Validator CS2', SERVER_PASSWORD: 'validator-cs2-private', RCON_PASSWORD: 'validator-cs2-local-only', GAME_MODE: '1', GAME_TYPE: '0', SRCDS_BETAID: '', SRCDS_BETAPASS: '' },
} };
const config = '/game/csgo/cfg/voltra-native.cfg';
const operator = '/game/csgo/cfg/server.cfg';
const archive = '/validator-cs2-retained.cfg';
const markerFile = '/validator-cs2-persistence.txt';
const scope = 'Bounded private idle operator configuration only; no player, gameplay, public authentication, WAN or world-save acceptance';
const startup = 'exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/cs2_runtime.py';
const hash = text => createHash('sha256').update(text).digest('hex');
const stopProofs = new WeakMap();
const reviewedHelpers = {
  "/.voltra/steam_template.py": "dc8ff0a9e462751878aad55da80bea8fd2a2d4ef16dbf8d37b798ea8d4c476dd",
  "/.voltra/source_install.py": "a1f63dd97984ed20dba5b5af6fddfaff5efdd15f7666231b32728da0c5f54a13",
  "/.voltra/bundle_debian_python.py": "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",
  "/.voltra/native_console.py": "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",
  "/.voltra/source_runtime.py": "f04a64a44b49a03ad45af79d61698b413b27c0ee999081696024085944633752",
  "/.voltra/source_next_install.py": "ab8c1f51facbb540191bbb9904a8aae7479cf3804d5c71726a96c0819ff0a70e",
  "/.voltra/source_l4d.py": "1a14d6063b26d3da4751cacab14319ef43a8250ab1fecb71ead3a87f408d498c",
  "/.voltra/source_third_install.py": "78d96cf5de6ab0258ab50feb2c02bce9c8e00e4259a1bef6fce035fd55208de7",
  "/.voltra/source_third_runtime.py": "57a057ed06d217b9bb77497a88979d0f9d4313c9661cb601e3faa38ea1ac2cc0",
  "/.voltra/cs2_runtime.py": "55e778a285c67c65b713159b416560dfa7ee1bcf802f7f8e8a107a6ef734cc76"
};

function supported(ctx) {
  if (ctx.game.family !== 'cs2' || ctx.game.recipe !== registration.cs2.recipe || ctx.fixture?.recipe !== ctx.game.recipe || ctx.fixture?.server?.uuid !== ctx.game.serverUUID || ctx.fixture.server.name !== 'validator-' + ctx.game.id) throw Error('Exact owned CS2 fixture required');
  const ports = ctx.fixture.ports;
  if (ports?.length !== 2 || new Set(ports).size !== 2 || ports.some(p => !Number.isInteger(p) || p < 1025 || p > 65535)) throw Error('CS2 requires distinct primary and SourceTV allocations');
}
async function chainHashes(ctx, c) {
  supported(ctx);
  const profile = h.profileFromRuntime(ctx.game.recipe, receipt);
  const served = (await h.api('/api/application/servers/' + ctx.fixture.server.id)).attributes;
  if (ctx.game.testStartup || profile.egg.startup !== startup || served.uuid !== ctx.fixture.server.uuid || served.egg !== ctx.fixture.egg.id || served.container?.startup_command !== startup) throw Error('CS2 canonical startup authority changed');
  const variables = (await h.api('/api/client/servers/' + ctx.fixture.server.uuid + '/startup')).data;
  if (!Array.isArray(variables)) throw Error('CS2 served startup variables unavailable');
  // Client startup intentionally omits hidden recipe controls. Verify the full
  // application environment, and independently require visible values to agree.
  const actual = Object.fromEntries(Object.entries(served.container?.environment ?? {}).map(([key, value]) => [key, String(value)]));
  for (const row of variables) {
    const v = row.attributes;
    if (v.secret === true) {
      if (v.server_value !== '' || v.secret_configured !== Boolean(actual[v.env_variable])) throw Error('CS2 secret metadata disagreement: ' + v.env_variable);
      continue;
    }
    if (actual[v.env_variable] !== String(v.server_value ?? v.default_value ?? '')) throw Error('CS2 client/application startup disagreement: ' + v.env_variable);
  }
  for (const [key, expected] of Object.entries(registration.cs2.environment)) {
    // VOLTRA_STEAM_AUTO_UPDATE is an optional injected control; AUTO_UPDATE is
    // canonical and is always checked. Absent undeclared controls stay absent.
    if (key === 'VOLTRA_STEAM_AUTO_UPDATE' && !(key in actual)) continue;
    if (actual[key] !== expected) throw Error('CS2 served environment mismatch: ' + key);
  }
  for (const [key, value] of Object.entries(actual)) if (value && (/^(PYTHON|LD_)/.test(key) || ['BASH_ENV', 'ENV'].includes(key) || key === 'VOLTRA_SERVER_ROOT' && value !== '/home/container')) throw Error('Unsafe CS2 served runtime environment');
  const hashes = {};
  for (const [path, expected] of Object.entries(reviewedHelpers)) {
    hashes[path] = hash(await c.read(path));
    if (hashes[path] !== expected) throw Error('CS2 candidate8 installed helper changed: ' + path);
  }
  const emitted = {};
  for (const m of profile.egg.scripts.installation.script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)) if (/^\.voltra\/[a-z0-9_]+\.py$/.test(m[1])) emitted['/' + m[1]] = hash(m[3] + '\n');
  if (JSON.stringify(Object.entries(emitted).sort()) !== JSON.stringify(Object.entries(reviewedHelpers).sort())) throw Error('CS2 served recipe differs from frozen candidate8 helpers');
  return hashes;
}
// Runs only against the stopped fixture. The first pass records the exact bytes
// before the second pass can append the private idle configuration.
async function prepareIdle(ctx, c) {
  const container = await native(ctx);
  if (!container?.id || await c.state() !== 'offline' || container.state.Running) throw Error('CS2 idle preparation requires stopped installed fixture');
  const identity = JSON.parse(await docker(['inspect', '--format', '{{json .}}', container.id], ctx.signal));
  const uuid = ctx.fixture.server.uuid, source = '/var/lib/voltra-parity-20261029/volumes/' + uuid;
  const mounts = identity?.Mounts?.filter(m => m.Destination === '/home/container');
  if (!/^[a-f0-9-]{36}$/.test(uuid) || identity.Id !== container.id || identity.Name !== '/' + uuid || identity.State.Running || identity.State.Dead || identity.State.OOMKilled || identity.State.ExitCode !== 0 || !/^sha256:[a-f0-9]{64}$/.test(identity.Image) || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(identity.Config.User) || mounts?.length !== 1 || mounts[0].Source !== source || mounts[0].Type !== 'bind' || identity.Mounts.some(m => m.Destination.startsWith('/home/container/'))) throw Error('CS2 offline preparation identity/mount mismatch');
  const script = String.raw`
import os, sys, stat, json, hashlib, base64
block = b'\n// BEGIN validator CS2 idle v1\nbot_quota 0\nbot_kick\n// END validator CS2 idle v1\n'
expected = json.loads(sys.argv[1])
fds = []
try:
    fd = os.open('/home', os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW); fds.append(fd)
    for name in ['container', 'game', 'csgo', 'cfg']:
        fd = os.open(name, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW, dir_fd=fd); fds.append(fd)
    parent = fd
    def read():
        try: leaf = os.open('server.cfg', os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK, dir_fd=parent)
        except FileNotFoundError: return None, None
        try:
            meta = os.fstat(leaf)
            if not stat.S_ISREG(meta.st_mode) or meta.st_nlink != 1 or meta.st_size > 1048576: raise ValueError('Unsafe operator file')
            raw = os.read(leaf, 1048577)
            if len(raw) != meta.st_size: raise ValueError('Operator file changed')
            return raw, dict(device=meta.st_dev, inode=meta.st_ino, mode=stat.S_IMODE(meta.st_mode), uid=meta.st_uid, gid=meta.st_gid)
        finally: os.close(leaf)
    raw, meta = read()
    present = raw is not None
    original = raw if present else b''
    owned = b'// BEGIN validator CS2 idle v1' in original or b'// END validator CS2 idle v1' in original
    if owned and (not original.endswith(block) or original.count(block) != 1 or original.count(b'// BEGIN validator CS2 idle v1') != 1 or original.count(b'// END validator CS2 idle v1') != 1): raise ValueError('Ambiguous validator idle block')
    baseline = dict(present=present, sha256=hashlib.sha256(original).hexdigest(), bytes=len(original), provenance=meta, originalBase64=base64.b64encode(original).decode(), alreadyPrepared=owned)
    if expected is not None:
        if expected != baseline: raise ValueError('Operator baseline changed before publication')
        if not owned:
            flags = os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK
            flags |= os.O_APPEND if present else os.O_CREAT|os.O_EXCL
            leaf = os.open('server.cfg', flags, 0o600, dir_fd=parent)
            try:
                current = os.fstat(leaf)
                if not stat.S_ISREG(current.st_mode) or current.st_nlink != 1 or present and (current.st_dev != meta['device'] or current.st_ino != meta['inode'] or current.st_size != len(original)): raise ValueError('Operator identity changed')
                if os.read(leaf, 1048577) != original: raise ValueError('Operator bytes changed before append')
                if os.write(leaf, block) != len(block): raise ValueError('Incomplete idle append')
                os.fsync(leaf)
            finally: os.close(leaf)
            os.fsync(parent)
        final, finalMeta = read()
        if final != original + (b'' if owned else block): raise ValueError('Idle preparation readback mismatch')
        if present and finalMeta != meta: raise ValueError('Operator provenance changed')
        print(json.dumps(dict(baseline=baseline, preparedSHA256=hashlib.sha256(final).hexdigest(), preparedBytes=len(final), provenance=finalMeta, appended=not owned)))
    else: print(json.dumps(baseline))
finally:
    for fd in reversed(fds): os.close(fd)
`;
  async function probe(expected) {
    const current = await native(ctx);
    if (await c.state() !== 'offline' || current?.id !== container.id || current.state.Running) throw Error('CS2 fixture changed before offline preparation');
    // Steam ships this exact default as root:root 0755. Preserve ownership and
    // mode; use its owner only for the verified append inside the stopped volume.
    const publisherOwned = expected?.provenance?.uid === 0 && expected.provenance.gid === 0
      && expected.provenance.mode === 0o755
      && expected.sha256 === '0bdec3e7ad4d5aabef744bb11aa2cfd980ed85daf656eb1d263b63bfb5ee4e31';
    const helperUser = publisherOwned ? '0:0' : identity.Config.User;
    const helper = 'validator-cs2-idle-' + randomUUID(), token = randomUUID();
    try {
      return JSON.parse(await docker(['run', '--rm', '--pull', 'never', '--name', helper, '--label', 'voltra.cs2.idle=' + token, '--network', 'none', '--read-only', '--user', helperUser, '--memory', '128m', '--memory-swap', '128m', '--cpus', '0.5', '--pids-limit', '32', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--mount', 'type=bind,src=' + source + ',dst=/home/container', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', '--entrypoint', '/home/container/.voltra/python/bin/python3', identity.Image, '-B', '-c', script, JSON.stringify(expected)], ctx.signal, 30000));
    } finally {
      const ids = (await docker(['ps', '-aq', '--filter', 'name=^/' + helper + '$'], undefined, 10000)).trim();
      if (ids) {
        if (!/^[a-f0-9]{12,64}$/.test(ids) || (await docker(['inspect', '--format', '{{index .Config.Labels "voltra.cs2.idle"}}', ids], undefined, 10000)).trim() !== token) throw Error('CS2 idle helper cleanup ownership mismatch');
        await docker(['rm', '-f', ids], undefined, 10000);
      }
    }
  }
  await chainHashes(ctx, c);
  const baseline = await probe(null);
  await ctx.artifact('operator-before-idle-' + baseline.sha256 + '.json', { file: operator, containerId: container.id, image: identity.Image, user: identity.Config.User, source, ...baseline });
  const prepared = await probe(baseline);
  if (!/^[a-f0-9]{64}$/.test(prepared.preparedSHA256 ?? '') || hash(await c.read(operator)) !== prepared.preparedSHA256) throw Error('CS2 prepared operator file API readback mismatch');
  await ctx.artifact('operator-idle-prepared.json', { file: operator, ...prepared, scope });
  return { sha256: prepared.preparedSHA256, appended: prepared.appended, originalPresent: baseline.present };
}
export async function prerequisites(ctx, c) {
  supported(ctx);
  for (const [key, value] of Object.entries(registration.cs2.environment)) if (ctx.game.environment?.[key] !== value) throw Error('CS2 private fixture environment mismatch: ' + key);
  if (![ctx.game.peakMiB, ctx.game.installPeakMiB, ctx.game.diskMiB].every(Number.isFinite) || ctx.game.peakMiB < 4096 || ctx.game.installPeakMiB < 4096 || ctx.game.diskMiB < 65536) throw Error('Root admission must reserve 4096 MiB idle/install RAM and 65536 MiB cold disk for CS2');
  const idlePreparation = await prepareIdle(ctx, c);
  return { required: false, idlePreparation, resources: { peakMiB: 4096, installPeakMiB: 4096, diskMiB: 65536 }, protocol: 'Independent A2S_INFO UDP and Source RCON TCP', scope };
}
export function retentionPaths(ctx) {
  supported(ctx);
  return [config, operator, '/game/csgo/cfg/voltra-managed.cfg', '/game/csgo/cfg/voltra-server.cfg', archive, markerFile];
}
export function restoreContext(ctx, saved) {
  supported(ctx);
  if (!/^[a-f0-9-]{36}$/.test(saved?.marker ?? '') || !/^[a-f0-9]{64}$/.test(saved?.operatorHash ?? '') || !Number.isInteger(saved?.limit) || saved.limit < 0 || saved.limit > 30) throw Error('Missing CS2 persistence baseline');
  ctx.cs2 = { marker: saved.marker, operatorHash: saved.operatorHash, limit: saved.limit };
}
function assertInfo(info) {
  if (info.players !== 0 || info.bots !== 0) throw Error('CS2 idle fixture blocker: native A2S reports players/bots; frozen recipe does not promise bot_quota=0. Root must prepare an owned idle configuration before retry');
  if (info.appId !== 730 || info.gameId !== '730' || info.folder !== 'csgo' || info.map !== 'de_dust2' || info.name !== 'Validator CS2' || info.maxplayers !== 8 || info.players !== 0 || info.bots !== 0 || !info.password || info.vac) throw Error('CS2 idle private A2S identity mismatch');
}
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
      const artifact = { command, output, complete: !error, error: error?.message };
      Promise.resolve(ctx.artifact('rcon-' + command.replace(/[^a-z0-9_-]/gi, '_') + '-latest.json', artifact)).then(() => error ? reject(error) : resolve(result), reject);
    };
    const abort = () => finish(ctx.signal.reason ?? Error('Aborted'));
    const timer = setTimeout(() => finish(Error('CS2 TCP RCON timeout')), 5000);
    const send = (id, type, body) => {
      const bytes = Buffer.from(body), packet = Buffer.alloc(bytes.length + 14);
      packet.writeInt32LE(bytes.length + 10); packet.writeInt32LE(id, 4); packet.writeInt32LE(type, 8); bytes.copy(packet, 12); socket.write(packet);
    };
    socket.on('error', () => finish(Error('CS2 TCP RCON connection failed')));
    socket.on('close', () => { if (!finished) finish(Error('CS2 TCP RCON closed before response fence')); });
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
          if (id === -1) throw Error('CS2 RCON authentication refused');
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
            if exe not in ['/home/container/game/bin/linuxsteamrt64/cs2']: continue
            parent = ppid(pid)
            args, supervisor = argv(pid), argv(parent)
            direct = any(x == b'/home/container/.voltra/cs2_runtime.py' or x == b'.voltra/cs2_runtime.py' for x in supervisor[1:2]) and os.readlink(Path('/proc', str(parent), 'exe')) == str((root / '.voltra/python/bin/python3').resolve())
            shell = ppid(parent)
            shellArgs = argv(shell)
            tini = os.readlink('/proc/1/exe') == '/usr/bin/tini' and argv(1) == [b'/usr/bin/tini', b'-g', b'--', b'/entrypoint.sh']
            outer = tini and (shell == 1 or (ppid(shell) == 1 and os.path.basename(os.readlink(Path('/proc', str(shell), 'exe'))) == 'bash' and b'/entrypoint.sh' in shellArgs))
            entryHash = hashlib.sha256(Path('/entrypoint.sh').read_bytes()).hexdigest()
            direct = direct and outer and entryHash == '32ae2a4f09300d31db2e10379a935614fc95f743da134eefbef61019dd4da4c4'
            norestart = b'-norestart' in args
            sockets = set()
            for fd in (entry/'fd').iterdir():
                try:
                    link = os.readlink(fd)
                    if link.startswith('socket:['): sockets.add(link[8:-1])
                except FileNotFoundError: pass
            owned = []
            for table in ['udp', 'tcp']:
                rows = Path('/proc/net/'+table).read_text().splitlines()[1:]
                owned.append(any(int(row.split()[1].split(':')[1],16) == int(os.environ['VOLTRA_PROOF_PORT']) and row.split()[9] in sockets for row in rows))
            direct = direct and all(owned) and b'-dedicated' in args and b'-strictportbind' in args
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
    proof = JSON.parse(await docker(['exec', '-e', 'VOLTRA_PROOF_PORT=' + ctx.fixture.ports[0], '-e', 'VOLTRA_PROOF_PATHS=' + JSON.stringify(Object.keys(expected).map(p => p.slice(1))), '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', container.id, '/home/container/.voltra/python/bin/python3', '-c', script], ctx.signal, 10000));
  } catch { throw Error('CS2 direct engine identity probe failed'); }
  await ctx.artifact('engine-identity-probe.json', JSON.stringify(proof, null, 2));
  const engine = proof.engines?.[0];
  const current = await native(ctx);
  if (!current?.state.Running || current.id !== container.id || current.state.StartedAt !== container.state.StartedAt) throw Error('CS2 engine container changed during proof');
  if (!proof.ok || proof.engines?.length !== 1 || !engine?.directSupervisor || !engine.norestart || !engine.noDebug || !Number.isInteger(engine.pid) || !Number.isInteger(engine.ppid)) throw Error('CS2 direct engine child/no-restart/no-debug identity unproved');
  const hashes = await chainHashes(ctx, c);
  if (JSON.stringify(hashes) !== JSON.stringify(expected)) throw Error('CS2 launch chain changed; review exit propagation before acceptance');
  if (JSON.stringify(hashes) !== JSON.stringify(proof.hashes)) throw Error('CS2 helper hashes changed during engine proof');
  const result = { containerId: container.id, startedAt: container.state.StartedAt, engine, hashes };
  stopProofs.set(ctx, result);
  await ctx.artifact('direct-engine-proof.json', JSON.stringify(result, null, 2));
  return result;
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
    const timer = setTimeout(() => finish(Error('CS2 A2S query timed out')), 3000);
    const send = bytes => socket.send(bytes, port, host, error => { if (error) finish(error); });
    socket.once('error', error => finish(error));
    socket.on('message', async (data, peer) => {
      if (finished || peer.address !== host || peer.port !== port) return;
      try {
        await ctx.artifact('a2s-response-latest.json', { hex: data.toString('hex'), peer: { address: peer.address, port: peer.port } });
        if (finished) return;
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
  if (data.length < 6 || data.length > 16384 || data.readInt32LE(0) !== -1 || data[4] !== 0x49 || data[5] !== 17) throw Error('Invalid CS2 A2S_INFO framing');
  let offset = 6;
  const need = n => { if (offset + n > data.length) throw Error('Truncated CS2 A2S field'); };
  const string = () => { const end = data.indexOf(0, offset); if (end < 0) throw Error('Truncated A2S string'); const value = data.subarray(offset, end).toString('utf8'); offset = end + 1; return value; };
  const name = string(), map = string(), folder = string(), game = string();
  need(9);
  const appId = data.readUInt16LE(offset), players = data[offset+2], maxplayers = data[offset+3], bots = data[offset+4], serverType = String.fromCharCode(data[offset+5]), environment = String.fromCharCode(data[offset+6]), visibility = data[offset+7], vac = data[offset+8]; offset += 9;
  const version = string(); let gameId;
  if (offset < data.length) {
    const edf = data[offset++];
    if (edf & ~0xf1) throw Error('Unknown CS2 A2S EDF');
    if (edf & 0x80) { need(2); offset += 2; }
    if (edf & 0x10) { need(8); offset += 8; }
    if (edf & 0x40) { need(2); offset += 2; string(); }
    if (edf & 0x20) string();
    // Full uint64 GameID, never truncate to the low AppID bits.
    if (edf & 1) { need(8); gameId = data.readBigUInt64LE(offset).toString(); offset += 8; }
  }
  if (offset !== data.length || players > maxplayers || bots > players || maxplayers < 1 || visibility > 1 || vac > 1 || serverType !== 'd' || environment !== 'l') throw Error('Invalid CS2 A2S values');
  return { protocol: data[5], name, map, folder, game, appId, gameId, players, maxplayers, bots, serverType, environment, password: !!visibility, vac: !!vac, version };
}
export async function ready(ctx, c) {
  supported(ctx);
  const container = await native(ctx), state = container?.state;
  if (!state || !(Date.parse(state.StartedAt) >= ctx.startRequestedAt)) return false;
  if (!state.Running) {
    await ctx.artifact('startup-failure.log', await logs(ctx, state.StartedAt));
    throw Error('CS2 exited before readiness: ' + state.ExitCode);
  }
  if (!(await logs(ctx, state.StartedAt)).includes('VOLTRA_SOURCE_THIRD_MAP_READY')) return false;
  let info, status;
  try {
    info = await query(ctx);
    await ctx.artifact('native-query-latest.json', info);
    await ctx.artifact('native-identity-flags.json', { ...info, password: undefined, privateSession: info.password });
    if (info.bots > 0) {
      // Map/game-mode config can spawn bots after server.cfg. Remove only
      // native bots in the verified private fixture, then require a fresh zero.
      assertInfo({ ...info, players: 0, bots: 0 });
      if (info.players !== info.bots) throw Error('Unexpected non-bot player in private CS2 fixture');
      await rcon(ctx, 'bot_quota 0');
      await rcon(ctx, 'bot_kick');
      info = await query(ctx);
      await ctx.artifact('native-query-after-idle.json', info);
      if (info.bots > 0 && info.players === info.bots) return false;
    }
    assertInfo(info);
    status = await rcon(ctx, 'status');
    await ctx.artifact('native-status-latest.txt', status);
  } catch (error) {
    if (/timed out|timeout|connection failed|closed before response fence/.test(error.message)) return false;
    throw error;
  }
  if (!/\bde_dust2\b/.test(status)) throw Error('CS2 native status map missing');
  if (await c.state() !== 'running') return false;
  const processProof = await engineProof(ctx, c, container);
  await ctx.artifact('startup.log', await logs(ctx, state.StartedAt));
  return { startedAt: state.StartedAt, query: info, nativeStatus: status, processProof };
}
async function cleanStop(ctx, c) {
  const container = await native(ctx), state = container?.state, proof = stopProofs.get(ctx);
  if (await c.state() !== 'offline' || !state || state.Running || state.ExitCode !== 0 || state.OOMKilled || state.Dead || !(Date.parse(state.StartedAt) >= ctx.startRequestedAt) || !proof || proof.containerId !== container.id || proof.startedAt !== state.StartedAt) throw Error('CS2 graceful numeric exit unproved');
  await ctx.artifact('stop.log', await logs(ctx, state.StartedAt));
  if (JSON.stringify(await chainHashes(ctx, c)) !== JSON.stringify(proof.hashes)) throw Error('CS2 stopped launch chain changed');
  // Frozen cs2 main returns shared.run; native_console returns child.wait().
  // The observed executable is the direct child, with no launcher/restart shell.
  // SystemExit and the hash-bound entrypoint/tini chain propagate numeric status.
  // No nonexistent CS2 zero-exit log marker is assumed.
  await ctx.artifact('clean-stop-proof.json', { ...proof, engineNumericExit: 0, containerExit: state.ExitCode, propagation: 'direct child.wait -> main return -> SystemExit -> verified entrypoint/tini', scope });
  return state;
}
async function nativeLimit(ctx, expected, label) {
  const reply = await rcon(ctx, 'mp_limitteams');
  await ctx.artifact(label + '.txt', reply);
  // Source2 builds may quote the name/value or print name = value. Accept only
  // an anchored scalar line and require one unambiguous actual value.
  const matches = [...reply.matchAll(/^\s*"?mp_limitteams"?\s*=\s*"?([0-9]+)"?(?=\s|$)[^\r\n]*$/gmi)];
  if (matches.length !== 1 || Number(matches[0][1]) !== expected) throw Error('CS2 effective mp_limitteams mismatch or unsupported native response; inspect preserved reply');
  return { key: 'mp_limitteams', value: expected, reply };
}
async function refusal(ctx, c, url, body, expected, original) {
  let status;
  try { await c.api('PUT', url, body); status = 200; }
  catch (error) {
    const match = error.message.match(/HTTP (\d{3})/);
    if (!match) throw error;
    status = Number(match[1]);
  }
  await ctx.artifact('settings-refusal-' + expected + '.json', { status, expected });
  if (status !== expected || await c.read(config) !== original) throw Error('CS2 settings refusal failed or changed bytes');
}
export async function settings(ctx, c) {
  supported(ctx);
  await c.power('stop');
  await wait(ctx, async () => await c.state() === 'offline', 'CS2 settings stop');
  await cleanStop(ctx, c);
  const url = '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent(config);
  const before = (await h.api(url)).attributes;
  const field = before.fields?.find(f => f.key === 'mp_limitteams');
  if (before.file !== config || !before.revision || field?.type !== 'number' || field.readonly || !/^\d+$/.test(String(field.value)) || Number(field.value) > 30) throw Error('CS2 existing editable typed mp_limitteams authority missing');
  const original = await c.read(config), limit = Number(field.value) === 3 ? 4 : 3;
  let operatorText;
  try { operatorText = await c.read(operator); }
  catch (error) { throw Error('CS2 fixture blocker: existing operator game/csgo/cfg/server.cfg is required before edits; ' + error.message); }
  // Existing supported fields only. Never seed an invented publisher config.
  await refusal(ctx, c, url, { revision: before.revision, settings: { mp_limitteams: 31 } }, 422, original);
  await h.api(url, 'PUT', { revision: before.revision, settings: { mp_limitteams: limit } });
  const edited = await c.read(config);
  if (edited === original) throw Error('CS2 typed edit did not change native config');
  await refusal(ctx, c, url, { revision: before.revision, settings: { mp_limitteams: 2 } }, 409, edited);
  const after = (await h.api(url)).attributes;
  if (Number(after.fields?.find(f => f.key === 'mp_limitteams')?.value) !== limit) throw Error('CS2 typed settings readback failed');
  const marker = randomUUID();
  // Preserve an existing publisher/operator server.cfg exactly; a missing file
  // is a precise fixture blocker, never silently replaced with an assumed one.
  const marked = edited + '\n// validator CS2 retained marker ' + marker + '\n';
  await c.write(config, marked); await c.write(archive, marked); await c.write(markerFile, marker);
  ctx.cs2 = { marker, operatorHash: hash(operatorText), limit };
  ctx.startRequestedAt = Date.now(); await c.power('start');
  await wait(ctx, () => ready(ctx, c), 'CS2 edited settings readiness');
  const initial = await nativeLimit(ctx, limit, 'native-cvar-after-edit');
  // Exercise the canonical servercfgfile on an actual subsequent map load.
  // The cvar check follows a fresh fenced status query and readiness proof.
  // A deliberately different in-memory value prevents an old matching status
  // reply from satisfying the reload gate before the map command is consumed.
  await rcon(ctx, 'mp_limitteams 5');
  await nativeLimit(ctx, 5, 'native-cvar-before-map-reload');
  await c.api('POST', '/api/client/servers/' + ctx.fixture.server.uuid + '/command', { command: 'changelevel de_dust2' });
  await wait(ctx, async () => {
    try {
      const reply = await rcon(ctx, 'status');
      await ctx.artifact('map-reload-status.txt', reply);
      if (!/\bde_dust2\b/.test(reply)) return false;
      const value = await rcon(ctx, 'mp_limitteams');
      await ctx.artifact('map-reload-cvar-poll.txt', value);
      if (/^\s*"?mp_limitteams"?\s*=\s*"?5"?(?=\s|$)/mi.test(value)) return false;
      await nativeLimit(ctx, limit, 'native-cvar-after-map-reload');
      return !!await ready(ctx, c);
    } catch (error) {
      if (/timeout|connection failed|closed before response fence/.test(error.message)) return false;
      throw error;
    }
  }, 'CS2 map reload native consumption');
  if (hash(await c.read(operator)) !== ctx.cs2.operatorHash) throw Error('CS2 operator server.cfg changed during startup/reload');
  return { file: config, key: 'mp_limitteams', limit, native: initial, invalidRefused: true, staleRefused: true, scope };
}
export async function saved(ctx, c) {
  supported(ctx);
  const state = await cleanStop(ctx, c), baseline = ctx.cs2;
  if (!baseline?.marker || await c.read(markerFile) !== baseline.marker || hash(await c.read(operator)) !== baseline.operatorHash) throw Error('CS2 operator persistence baseline missing/changed');
  const hashes = {};
  for (const path of retentionPaths(ctx)) hashes[path] = hash(await c.read(path));
  if (await c.read(config) !== await c.read(archive) || !(await c.read(config)).includes('// validator CS2 retained marker ' + baseline.marker)) throw Error('CS2 archived config marker missing');
  return { ...baseline, hashes, engineNumericExit: 0, containerExit: state.ExitCode, scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  for (const path of retentionPaths(ctx)) if (!/^[a-f0-9]{64}$/.test(saved.hashes?.[path] ?? '') || hash(await c.read(path)) !== saved.hashes[path]) throw Error('CS2 retained file changed: ' + path);
  if (await c.read(markerFile) !== saved.marker || hash(await c.read(operator)) !== saved.operatorHash) throw Error('CS2 retained operator baseline mismatch');
  const proof = await ready(ctx, c);
  if (!proof) throw Error('CS2 reload readiness not established');
  const consumption = await nativeLimit(ctx, saved.limit, 'native-cvar-after-restart');
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'CS2 reload stop');
  await cleanStop(ctx, c);
  return { markerRetained: true, configRetained: true, operatorRetained: true, native: consumption, engineNumericExit: 0, scope };
}
