import dgram from 'node:dgram';
import { createHash, randomBytes } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// The October receipt is research only: candidate12 updates unlimited-memory launch on top of the changed supervisor and
// installer helpers. Every native assertion below must run on the new fixture.
export const registration = { nukkit: {
  recipe: 'minecraft/bedrock/nukkit/egg-nukkit.json', ports: 1,
  environment: { SERVER_JARFILE: 'server.jar', NUKKIT_VERSION: '1.0-20261027.214338-1252', SERVERNAME: 'Validator Nukkit', AUTO_UPDATE: '0' },
} };
export const retentionRequiredPath = '/nukkit.yml';
const pin = '1ed570be49d694cdfd93da0174be6bba8bb7e64f3b4568eac9421159df145879';
const launcherPin = '352173c37b86afd6d6ff62fddbad9ef8d79961dcdf5a716f50b74d80c8e15000';
const consolePin = 'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5';
const startup = 'exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/bedrock_family.py run nukkit';
const scope = 'Idle native Nukkit discovery, typed capacity consumption, clean native stop, initialized config and native world identity reload; no players, injected world data, gameplay or WAN proof.';
const digest = x => createHash('sha256').update(x).digest('hex');
const proofs = new WeakMap();
function owned(ctx) {
  if (ctx.game.family !== 'nukkit' || ctx.game.recipe !== registration.nukkit.recipe || ctx.fixture?.recipe !== ctx.game.recipe || ctx.fixture?.server?.uuid !== ctx.game.serverUUID || ctx.fixture.server.name !== 'validator-' + ctx.game.id || ctx.game.testStartup) throw Error('Exact canonical owned Nukkit fixture required');
  if (ctx.fixture.ports?.length !== 1 || !Number.isInteger(ctx.fixture.ports[0]) || ctx.fixture.ports[0] < 1025 || ctx.fixture.ports[0] > 65535) throw Error('Nukkit requires one valid allocation');
}
async function chain(ctx, c) {
  owned(ctx);
  const profile = h.profileFromRuntime(ctx.game.recipe, receipt), served = (await h.api('/api/application/servers/' + ctx.fixture.server.id)).attributes;
  if (profile.egg.startup !== startup || served.container?.startup_command !== startup || served.uuid !== ctx.fixture.server.uuid || served.egg !== ctx.fixture.egg.id || profile.egg.config.stop !== 'stop') throw Error('Nukkit canonical launch/stop authority changed');
  const hashes = {};
  for (const m of profile.egg.scripts.installation.script.matchAll(/cat > (\.voltra\/[a-zA-Z0-9_.-]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)) {
    const path = '/' + m[1], expected = digest(m[3] + '\n');
    if (digest(await c.read(path)) !== expected) throw Error('Nukkit frozen helper differs: ' + path);
    hashes[path] = expected;
  }
  if (hashes['/.voltra/bedrock_family.py'] !== launcherPin || hashes['/.voltra/native_console.py'] !== consolePin || !hashes['/.voltra/steam_template.py'] || !hashes['/.voltra/native_config.py'] || !hashes['/.voltra/bedrock-family-releases.json']) throw Error('Nukkit reviewed helper authority missing/drifted');
  const releaseRaw = await c.read('/.voltra/nukkit/release.json'), release = JSON.parse(releaseRaw);
  if (release.version !== registration.nukkit.environment.NUKKIT_VERSION || release.sha256 !== pin || release.binary_sha256 !== pin
    || release.url !== 'https://repo.opencollab.dev/maven-snapshots/cn/nukkit/nukkit/1.0-SNAPSHOT/nukkit-1.0-20261027.214338-1252.jar'
    || release.bytes !== 27129197) throw Error('Nukkit reviewed publisher snapshot differs');
  hashes['/.voltra/nukkit/release.json'] = digest(releaseRaw);
  return hashes;
}

// Byte manifests use the installed private Python both live and offline. The
// offline helper has no network, writes, extra mounts or mutable image lookup.
async function probe(ctx, process = false) {
  owned(ctx); const container = await native(ctx);
  if (!container) throw Error('Nukkit native container missing');
  const script = String.raw`
import os,json,stat,hashlib,gzip,struct
from pathlib import Path
r=Path('/home/container')
def safe(p):
 if not p.is_relative_to(r):raise ValueError('Outside owned volume')
 for q in [p,*p.parents]:
  if q==r.parent:break
  if q.is_symlink():raise ValueError('Symlink in native path')
 return p
out={}
for name in ['server.properties','nukkit.yml','server.jar']:
 p=safe(r/name);s=p.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_size>64*1024*1024:raise ValueError('Invalid native file')
 out['/'+name]=dict(sha256=hashlib.sha256(p.read_bytes()).hexdigest(),mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid)
raw=(r/'server.properties').read_bytes()
props={}
for line in raw.decode().splitlines():
 if '=' in line and not line.lstrip().startswith(('#','!')):
  k,v=line.split('=',1);props[k.strip()]=v.strip()
level=safe(r/'worlds/world/level.dat');b=level.read_bytes()
if len(b)>1048576 or len(b)<12:raise ValueError('Invalid native level.dat')
if b[:2]==b'\x1f\x8b':b=gzip.decompress(b)
# Native Bedrock little-endian NBT, possibly preceded by its 8-byte header.
if b[0]!=10:
 if len(b)<9 or b[8]!=10:raise ValueError('Missing native NBT root')
 b=b[8:]
at=0;nodes=0
def take(n):
 global at
 if n<0 or at+n>len(b):raise ValueError('Truncated NBT')
 v=b[at:at+n];at+=n;return v
def num(fmt):return struct.unpack(endian+fmt,take(struct.calcsize(fmt)))[0]
def text():return take(num('H')).decode('utf-8')
def tag(t,depth=0):
 global nodes
 nodes+=1
 if depth>32 or nodes>100000:raise ValueError('Oversized NBT')
 if t in (1,2,3,4,5,6):return num({1:'b',2:'h',3:'i',4:'q',5:'f',6:'d'}[t])
 if t==8:return text()
 if t in (7,11,12):
  n=num('i')
  if n<0 or n>1048576:raise ValueError('Invalid array')
  take(n*{7:1,11:4,12:8}[t]);return None
 if t==9:
  typ=num('B');n=num('i')
  if n<0 or n>100000:raise ValueError('Invalid list')
  return [tag(typ,depth+1) for _ in range(n)]
 if t==10:
  out={}
  while True:
   typ=num('B')
   if typ==0:return out
   name=text();out[name]=tag(typ,depth+1)
 raise ValueError('Unknown NBT type')
data=None
for endian in ['<','>']:
 try:
  at=0;nodes=0
  if num('B')!=10:raise ValueError('Invalid root')
  text();candidate=tag(10)
  if at!=len(b) or not isinstance(candidate.get('RandomSeed'),int) or not isinstance(candidate.get('LevelName'),str):raise ValueError('Incomplete native NBT')
  data=candidate;break
 except (ValueError,UnicodeError,struct.error):pass
if data is None:raise ValueError('Invalid native NBT identity')
identity={k:data.get(k) for k in ['RandomSeed','LevelName','SpawnX','SpawnY','SpawnZ']}
if not isinstance(identity['RandomSeed'],int) or not isinstance(identity['LevelName'],str):raise ValueError('Missing native world identity')
engines=[]
if ${process ? 'True' : 'False'}:
 for p in list(Path('/proc').iterdir())[:65536]:
  if not p.name.isdigit():continue
  try:
   a=(p/'cmdline').read_bytes().split(b'\0')[:-1]
   if os.path.realpath(p/'exe')!=str((r/'.voltra/java21/bin/java').resolve()):continue
   pp=int(next(x.split()[1] for x in (p/'status').read_text().splitlines() if x.startswith('PPid:')))
   par=Path('/proc',str(pp));pa=(par/'cmdline').read_bytes().split(b'\0')[:-1]
   engines.append(dict(pid=int(p.name),ppid=pp,startTicks=(p/'stat').read_text().rsplit(')',1)[1].split()[19],direct=pa[1:]==[b'.voltra/bedrock_family.py',b'run',b'nukkit'] and os.path.realpath(par/'exe')==str((r/'.voltra/python/bin/python3').resolve()),jar=a[a.index(b'-jar')+1].decode() if b'-jar' in a else None,cwd=os.readlink(p/'cwd')))
  except (FileNotFoundError,ProcessLookupError,PermissionError):pass
print(json.dumps(dict(manifest=out,identity=identity,properties=props,crlf=raw.count(b'\r\n'),bareLF=raw.count(b'\n')-raw.count(b'\r\n'),engines=engines),sort_keys=True))
`;
  const args = ['-B', '-c', script]; let result;
  if (container.state.Running) result = JSON.parse(await docker(['exec', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', container.id, '/home/container/.voltra/python/bin/python3', ...args], ctx.signal, 30000));
  else {
    if (process) throw Error('Cannot inspect stopped native process');
    const [id] = JSON.parse(await docker(['inspect', container.id], ctx.signal));
    const source = '/var/lib/voltra-parity-20261029/volumes/' + ctx.fixture.server.uuid;
    if (id.Name !== '/' + ctx.fixture.server.uuid || id.State.Running || !/^sha256:[a-f0-9]{64}$/.test(id.Image) || id.Mounts.filter(m => m.Destination === '/home/container' && m.Source === source).length !== 1 || id.Mounts.some(m => m.Destination.startsWith('/home/container/'))) throw Error('Offline Nukkit volume authority mismatch');
    result = JSON.parse(await docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--user', id.Config.User, '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', '--mount', 'type=bind,src=' + source + ',dst=/home/container,readonly', '--entrypoint', '/home/container/.voltra/python/bin/python3', id.Image, ...args], ctx.signal, 30000));
  }
  await ctx.artifact('nukkit-probe-' + Date.now() + '.json', result);
  if (result.manifest['/server.jar'].sha256 !== pin || result.properties['enable-query'] !== 'on') throw Error('Nukkit native binary/query identity mismatch');
  return result;
}
export async function prerequisites(ctx, c) {
  const hashes = await chain(ctx, c);
  const server = (await h.api('/api/application/servers/' + ctx.fixture.server.id)).attributes;
  const current = server.container?.environment?.NUKKIT_VERSION, expected = registration.nukkit.environment.NUKKIT_VERSION;
  if (current !== expected) {
    if (current !== 'latest' || await c.state() !== 'offline') throw Error('Unexpected Nukkit snapshot selection');
    await ctx.artifact('snapshot-selection-intent.json', { before: current, after: expected, sha256: pin, reason: 'Bind already installed publisher-verified snapshot for repeatable retention' });
    await h.api('/api/client/servers/' + ctx.fixture.server.uuid + '/startup/variable', 'PUT', { key: 'NUKKIT_VERSION', value: expected });
    const after = (await h.api('/api/application/servers/' + ctx.fixture.server.id)).attributes;
    if (after.container.environment.NUKKIT_VERSION !== expected) throw Error('Nukkit snapshot selection readback failed');
  }
  return { required: false, hashes, publisherSHA256: pin, version: expected, scope };
}
async function query(ctx) {
  const socket = dgram.createSocket('udp4'), nonce = randomBytes(8), magic = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex'), port = ctx.fixture.ports[0];
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); ctx.signal.removeEventListener('abort', abort); socket.close(); error ? reject(error) : resolve(value); };
    const abort = () => finish(Error('Nukkit discovery aborted'));
    const timer = setTimeout(() => finish(Error('Nukkit discovery timeout')), 5000);
    socket.on('error', () => finish(Error('Nukkit discovery socket failed')));
    socket.on('message', async (b, peer) => {
      if (peer.address !== '127.0.0.1' || peer.port !== port) return;
      try {
        if (b.length < 35 || b.length > 8192 || b[0] !== 0x1c || !b.subarray(1,9).equals(nonce) || !b.subarray(17,33).equals(magic) || b.length !== 35 + b.readUInt16BE(33)) throw Error('Invalid Nukkit RakNet pong');
        const p = b.subarray(35).toString().split(';'), value = { edition: p[0], motd: p[1], protocol: p[2], version: p[3], players: Number(p[4]), capacity: Number(p[5]), subMotd: p[7], nonceEcho: true };
        await ctx.artifact('discovery-' + Date.now() + '.json', { observed: value, expected: { edition: 'MCPE', protocol: '2225', version: '1.26.60', motd: 'Validator Nukkit', players: 0, capacity: ctx.nukkit?.edited ? 7 : 20 } });
        if (value.edition !== 'MCPE' || value.protocol !== '2225' || value.version !== '1.26.60' || value.motd !== 'Validator Nukkit' || value.players !== 0 || value.capacity !== (ctx.nukkit?.edited ? 7 : 20)) throw Error('Nukkit native discovery/settings mismatch');
        finish(null, value);
      } catch (e) { finish(e); }
    });
    ctx.signal.addEventListener('abort', abort, { once: true });
    socket.send(Buffer.concat([Buffer.from([1]), nonce, magic, randomBytes(8)]), port, '127.0.0.1', e => { if (e) finish(e); });
    if (ctx.signal.aborted) abort();
  });
}
export async function ready(ctx, c) {
  owned(ctx); const container = await native(ctx), state = container?.state;
  if (!state || Date.parse(state.StartedAt) < ctx.startRequestedAt) return false;
  if (!state.Running) throw Error('Nukkit exited before readiness: ' + state.ExitCode);
  const text = (await logs(ctx, state.StartedAt)).replace(/\x1b\[[0-9;]*m/g, '');
  if (!/Done \([0-9.]+s\)!/.test(text) || await c.state() !== 'running') return false;
  if (!/Nukkit version .*git-4841947/.test(text) || !/Preparing level .*world/.test(text)) throw Error('Fresh Nukkit native version/world logs missing');
  const hashes = await chain(ctx, c), p = await probe(ctx, true), engine = p.engines[0];
  if (p.engines.length !== 1 || !engine.direct || engine.jar !== 'server.jar' || engine.cwd !== '/home/container') throw Error('Nukkit direct native exit chain unproved');
  const proof = { containerId: container.id, startedAt: state.StartedAt, engine, hashes };
  proofs.set(ctx, proof);
  const discovery = await query(ctx); await ctx.artifact('nukkit-discovery-' + Date.now() + '.json', discovery);
  return { ...proof, discovery, identity: p.identity, scope };
}
async function cleanStop(ctx, c) {
  const proof = proofs.get(ctx), container = await native(ctx), s = container?.state;
  if (!proof || container.id !== proof.containerId || s.StartedAt !== proof.startedAt || s.Running || s.ExitCode !== 0 || s.OOMKilled || s.Dead || await c.state() !== 'offline') throw Error('Nukkit fresh direct engine exit 0 unproved');
  const text = (await logs(ctx, s.StartedAt)).replace(/\x1b\[[0-9;]*m/g, '');
  if (!/Stopping the server/.test(text) || !/Unloading level .*world/.test(text) || /grace expired|escalating owned process|Native process exited:/i.test(text) || JSON.stringify(await chain(ctx, c)) !== JSON.stringify(proof.hashes)) throw Error('Nukkit normal native stop/helper identity unproved');
  return { ...proof, engineNumericExit: 0, engineExitProven: true };
}
const url = ctx => '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent('/server.properties');
async function rejected(ctx, c, body, pattern) {
  const before = await c.read('/server.properties'); let error;
  try { await h.api(url(ctx), 'PUT', body); } catch (e) { error = e; }
  if (!error || !pattern.test(error.message) || await c.read('/server.properties') !== before) throw Error('Nukkit refused edit did not fail unchanged');
}
export async function settings(ctx, c) {
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'Nukkit settings stop'); await cleanStop(ctx, c);
  // Publisher Server.java at git-4841947 reads this optional property with default 20.
  // Make the operator setting explicit without altering native world data.
  const properties = await c.read('/server.properties');
  if (!/^max-players\s*=/m.test(properties)) {
    const newline = properties.includes('\r\n') ? '\r\n' : '\n';
    const explicit = properties + (properties.endsWith('\n') ? '' : newline) + 'max-players=20' + newline;
    await ctx.artifact('optional-capacity-intent.json', { beforeSHA256: digest(properties), afterSHA256: digest(explicit), key: 'max-players', default: 20, source: 'https://raw.githubusercontent.com/CloudburstMC/Nukkit/4841947/src/main/java/cn/nukkit/Server.java' });
    await c.write('/server.properties', explicit);
    if (await c.read('/server.properties') !== explicit) throw Error('Nukkit optional capacity readback differs');
  }
  const original = await probe(ctx), before = (await h.api(url(ctx))).attributes;
  if (!before.revision || !before.fields?.some(f => f.key === 'max-players' && f.type === 'number' && f.readonly === false)) throw Error('Nukkit editable typed capacity authority missing');
  await rejected(ctx, c, { revision: before.revision, settings: { 'max-players': 'invalid' } }, /400|422|invalid/i);
  await h.api(url(ctx), 'PUT', { revision: before.revision, settings: { 'max-players': '7' } });
  const after = (await h.api(url(ctx))).attributes;
  if (!after.revision || after.revision === before.revision || String(after.fields?.find(f => f.key === 'max-players')?.value) !== '7') throw Error('Nukkit typed capacity/revision readback failed');
  await rejected(ctx, c, { revision: before.revision, settings: { 'max-players': '8' } }, /409|stale|revision|conflict/i);
  const edited = await probe(ctx);
  if (original.bareLF !== edited.bareLF || original.crlf > 0 && edited.crlf === 0 || JSON.stringify(original.identity) !== JSON.stringify(edited.identity)) throw Error('Nukkit native CRLF/world identity changed by settings edit');
  ctx.nukkit = { edited: true };
  ctx.startRequestedAt = Date.now(); await c.power('start');
  const fresh = await wait(ctx, () => ready(ctx, c), 'Nukkit edited readiness');
  return { changes: { 'max-players': '7' }, revision: after.revision, fresh, scope };
}
export function retentionPaths(ctx) { owned(ctx); return ['/server.properties', '/nukkit.yml', '/worlds', '/players', '/plugins', '/server.jar', '/.voltra/bedrock_family.py', '/.voltra/native_console.py', '/.voltra/bedrock-family-releases.json']; }
export function restoreContext(ctx, saved) {
  owned(ctx);
  if (!saved?.baseline?.identity || !saved.processProof?.engine?.direct || saved.engineNumericExit !== 0 || saved.engineExitProven !== true || !saved.hashes) throw Error('Nukkit retained native proof missing');
  ctx.nukkit = { edited: true, baseline: saved.baseline };
}
function compare(before, after) {
  if (JSON.stringify(before.manifest) !== JSON.stringify(after.manifest) || JSON.stringify(before.identity) !== JSON.stringify(after.identity) || before.crlf !== after.crlf || before.bareLF !== after.bareLF) throw Error('Nukkit native config/binary/world identity changed');
}
export async function saved(ctx, c) {
  if (!ctx.nukkit?.edited) throw Error('Nukkit edited settings context missing');
  const processProof = await cleanStop(ctx, c), baseline = await probe(ctx), hashes = await chain(ctx, c);
  if (baseline.properties['max-players'] !== '7') throw Error('Nukkit stopped native capacity missing');
  ctx.nukkit.baseline = baseline;
  return { baseline, hashes, processProof, engineNumericExit: 0, engineExitProven: true, scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  if (JSON.stringify(await chain(ctx, c)) !== JSON.stringify(saved.hashes)) throw Error('Nukkit retained helper chain changed');
  const fresh = await ready(ctx, c);
  if (!fresh || fresh.startedAt === saved.processProof.startedAt) throw Error('Nukkit fresh reload missing');
  compare(saved.baseline, await probe(ctx));
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'Nukkit reload stop');
  const stop = await cleanStop(ctx, c); compare(saved.baseline, await probe(ctx));
  return { fresh, stop, nativeIdentityRetained: true, scope };
}
