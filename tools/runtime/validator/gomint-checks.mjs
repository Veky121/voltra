import dgram from 'node:dgram';
import { createHash, randomBytes } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// October evidence supplies publisher/log semantics only. Current supervisor and
// staged memory fix require fresh native acceptance on the newly served build.
export const registration = { gomint: {
  recipe: 'minecraft/bedrock/gomint/egg-go-mint.json', ports: 1,
  environment: { AUTO_UPDATE: '0' },
} };
export const retentionRequiredPath = '/world/level.dat';
const pin = 'd816bc2017b7eaa7767d7dcbb6d519c1f5ab3d7ecdf254f9792cf5668955e289';
// Root must set this to the newly served reviewed helper hash after building.
const launcherPin = 'bf8701481c3d9cbd389c2a298e82ad38546c4df9be77539d36c745239a298058';
const consolePin = 'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5';
const startup = 'exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/bedrock_family.py run gomint';
const scope = 'Legacy GoMint RC6 protocol422/Bedrock1.16.200 idle discovery, settings consumption, native shutdown world closure and initialized world metadata retention only; no players, gameplay, modern clients, ARM or WAN acceptance.';
const digest = x => createHash('sha256').update(x).digest('hex');
// Publisher RC6 d7f2c0d0, not an inference from the absence of players:
// ChunkAdapter.populate:701-710 -> setLastSavedTimestamp:291-298 clears dirty
// flags. ChunkCache.saveAll:280-286 persists only dirty chunks. The 289-chunk
// log counts loadChunk attempts unconditionally, WorldAdapter:759-778.
const metadataBoundary = {
  generatedChunkPersistence: 'Unproved; native population clears dirty flags before save',
  initializedMetadata: 'level.dat bytes plus valid LevelDB CURRENT-to-MANIFEST linkage',
  sourceCommit: 'd7f2c0d0',
  source: [
    'https://github.com/gomint/gomint/blob/d7f2c0d0/gomint-server/src/main/java/io/gomint/server/world/ChunkAdapter.java#L291-L298',
    'https://github.com/gomint/gomint/blob/d7f2c0d0/gomint-server/src/main/java/io/gomint/server/world/ChunkAdapter.java#L701-L710',
    'https://github.com/gomint/gomint/blob/d7f2c0d0/gomint-server/src/main/java/io/gomint/server/world/ChunkCache.java#L280-L286',
    'https://github.com/gomint/gomint/blob/d7f2c0d0/gomint-server/src/main/java/io/gomint/server/world/WorldAdapter.java#L759-L778',
    'https://github.com/gomint/gomint/blob/d7f2c0d0/gomint-server/src/main/java/io/gomint/server/world/leveldb/LevelDBWorldAdapter.java#L89-L112',
  ],
};
const proofs = new WeakMap();
function owned(ctx) {
  if (ctx.game.family !== 'gomint' || ctx.game.recipe !== registration.gomint.recipe || ctx.fixture?.recipe !== ctx.game.recipe || ctx.fixture?.server?.uuid !== ctx.game.serverUUID || ctx.fixture.server.name !== 'validator-' + ctx.game.id || ctx.game.testStartup) throw Error('Exact canonical owned GoMint fixture required');
  if (ctx.fixture.ports?.length !== 1 || !Number.isInteger(ctx.fixture.ports[0]) || ctx.fixture.ports[0] < 1025 || ctx.fixture.ports[0] > 65535) throw Error('GoMint requires one valid allocation');
}
async function chain(ctx, c) {
  owned(ctx);
  const profile = h.profileFromRuntime(ctx.game.recipe, receipt), served = (await h.api('/api/application/servers/' + ctx.fixture.server.id)).attributes;
  if (profile.egg.startup !== startup || served.container?.startup_command !== startup || served.uuid !== ctx.fixture.server.uuid || served.egg !== ctx.fixture.egg.id || profile.egg.config.stop !== 'stop') throw Error('GoMint canonical launch/stop authority changed');
  const hashes = {};
  for (const m of profile.egg.scripts.installation.script.matchAll(/cat > (\.voltra\/[a-zA-Z0-9_.-]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)) {
    const path = '/' + m[1], expected = digest(m[3] + '\n');
    if (digest(await c.read(path)) !== expected) throw Error('GoMint frozen helper differs: ' + path);
    hashes[path] = expected;
  }
  if (hashes['/.voltra/bedrock_family.py'] !== launcherPin || hashes['/.voltra/native_console.py'] !== consolePin || !hashes['/.voltra/steam_template.py'] || !hashes['/.voltra/native_config.py'] || !hashes['/.voltra/bedrock-family-releases.json']) throw Error('GoMint reviewed helper authority missing/drifted');
  const releaseRaw = await c.read('/.voltra/gomint/release.json'), release = JSON.parse(releaseRaw);
  if (release.version !== '1.0.0-RC6' || release.sha256 !== 'cafa0c1680bd000fb0b269a257906f58c7d6c88dcc9abfc559997532db8c2d7d' || release.files?.['GoMint.jar'] !== pin || !Object.values(release.files ?? {}).includes(release.binary_sha256)
    || release.url !== 'https://github.com/gomint/gomint/releases/download/1.0.0-RC6/1.0.0-RC6.zip'
    || release.bytes !== 34883787) throw Error('GoMint reviewed publisher archive differs');
  hashes['/.voltra/gomint/release.json'] = digest(releaseRaw);
  return hashes;
}

// Byte manifests use the installed private Python both live and offline. The
// offline helper has no network, writes, extra mounts or mutable image lookup.
async function probe(ctx, process = false) {
  owned(ctx); const container = await native(ctx);
  if (!container) throw Error('GoMint native container missing');
  const script = String.raw`
import os,json,stat,hashlib,gzip,struct,re
from pathlib import Path
r=Path('/home/container')
def safe(p):
 if not p.is_relative_to(r):raise ValueError('Outside owned volume')
 for q in [p,*p.parents]:
  if q==r.parent:break
  if q.is_symlink():raise ValueError('Symlink in native path')
 return p
out={}
for name in ['server.yml','modules/GoMint.jar']:
 p=safe(r/name);s=p.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_size>64*1024*1024:raise ValueError('Invalid native file')
 out['/'+name]=dict(sha256=hashlib.sha256(p.read_bytes()).hexdigest(),mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid)
# Preserve the initialized publisher world as bytes, without fabricating NBT identity.
level=safe(r/'world/level.dat');db=safe(r/'world/db')
if not level.is_file() or not db.is_dir():raise ValueError('Native initialized world missing')
world={}
for index,p in enumerate(sorted((r/'world').rglob('*'))):
 if index>100000:raise ValueError('Oversized initialized world tree')
 safe(p);st=p.lstat()
 if stat.S_ISREG(st.st_mode):
  if st.st_size>128*1024*1024:raise ValueError('World file too large')
  world[str(p.relative_to(r))]=dict(sha256=hashlib.sha256(p.read_bytes()).hexdigest(),mode=stat.S_IMODE(st.st_mode),uid=st.st_uid,gid=st.st_gid)
# RC6 populate() resets persistence flags via setLastSavedTimestamp before any
# save. An untouched initialized world can legitimately contain no chunk SST.
# Validate LevelDB's actual manifest pointer, without treating control files as
# proof that generated terrain was written or reloaded from storage.
current=safe(db/'CURRENT')
if not current.is_file() or current.stat().st_size>128:raise ValueError('Invalid LevelDB CURRENT')
pointer=current.read_bytes()
if not re.fullmatch(rb'MANIFEST-[0-9]+\n',pointer):raise ValueError('Invalid LevelDB manifest pointer')
manifest=safe(db/pointer.decode().strip())
if not manifest.is_file() or not 0<manifest.stat().st_size<1048576:raise ValueError('Missing initialized LevelDB manifest')
if not 8<level.stat().st_size<1048576:raise ValueError('Invalid initialized level.dat size')
b=level.read_bytes()
if len(b)<9 or b[8]!=10:raise ValueError('Native GoMint little-endian NBT root/header missing')
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
if any(not isinstance(identity[k],int) for k in ['SpawnX','SpawnY','SpawnZ']):raise ValueError('Native GoMint spawn metadata missing')
identity['levelSHA256']=hashlib.sha256(level.read_bytes()).hexdigest()
identity['scope']='Initialized seed/spawn metadata only; persisted generated chunk data unproved'

chunkFiles=[k for k in world if k.endswith(('.ldb','.sst'))]

engines=[]
if ${process ? 'True' : 'False'}:
 for p in list(Path('/proc').iterdir())[:65536]:
  if not p.name.isdigit():continue
  try:
   a=(p/'cmdline').read_bytes().split(b'\0')[:-1]
   if os.path.realpath(p/'exe')!=str((r/'.voltra/java21/bin/java').resolve()):continue
   pp=int(next(x.split()[1] for x in (p/'status').read_text().splitlines() if x.startswith('PPid:')))
   par=Path('/proc',str(pp));pa=(par/'cmdline').read_bytes().split(b'\0')[:-1]
   engines.append(dict(pid=int(p.name),ppid=pp,startTicks=(p/'stat').read_text().rsplit(')',1)[1].split()[19],direct=pa[1:]==[b'.voltra/bedrock_family.py',b'run',b'gomint'] and os.path.realpath(par/'exe')==str((r/'.voltra/python/bin/python3').resolve()),module=a[a.index(b'-m')+1].decode() if b'-m' in a else None,cwd=os.readlink(p/'cwd')))
  except (FileNotFoundError,ProcessLookupError,PermissionError):pass
print(json.dumps(dict(manifest=out,world=world,identity=identity,chunkFiles=chunkFiles,chunkPersistenceClaimed=False,engines=engines),sort_keys=True))
`;
  const args = ['-B', '-c', script]; let result;
  if (container.state.Running) result = JSON.parse(await docker(['exec', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', container.id, '/home/container/.voltra/python/bin/python3', ...args], ctx.signal, 30000));
  else {
    if (process) throw Error('Cannot inspect stopped native process');
    const [id] = JSON.parse(await docker(['inspect', container.id], ctx.signal));
    const source = '/var/lib/voltra-parity-20261029/volumes/' + ctx.fixture.server.uuid;
    if (id.Name !== '/' + ctx.fixture.server.uuid || id.State.Running || !/^sha256:[a-f0-9]{64}$/.test(id.Image) || id.Mounts.filter(m => m.Destination === '/home/container' && m.Source === source).length !== 1 || id.Mounts.some(m => m.Destination.startsWith('/home/container/'))) throw Error('Offline GoMint volume authority mismatch');
    result = JSON.parse(await docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--user', id.Config.User, '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', '--mount', 'type=bind,src=' + source + ',dst=/home/container,readonly', '--entrypoint', '/home/container/.voltra/python/bin/python3', id.Image, ...args], ctx.signal, 30000));
  }
  await ctx.artifact('gomint-probe-' + Date.now() + '.json', result);
  if (result.manifest['/modules/GoMint.jar'].sha256 !== pin) throw Error('GoMint native binary/query identity mismatch');
  return result;
}
export async function prerequisites(ctx, c) {
  const hashes = await chain(ctx, c);
  return { required: false, hashes, publisherSHA256: 'cafa0c1680bd000fb0b269a257906f58c7d6c88dcc9abfc559997532db8c2d7d', version: '1.0.0-RC6', scope };
}
async function query(ctx) {
  const socket = dgram.createSocket('udp4'), nonce = randomBytes(8), magic = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex'), port = ctx.fixture.ports[0];
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); ctx.signal.removeEventListener('abort', abort); socket.close(); error ? reject(error) : resolve(value); };
    const abort = () => finish(Error('GoMint discovery aborted'));
    const timer = setTimeout(() => finish(Error('GoMint discovery timeout')), 5000);
    socket.on('error', () => finish(Error('GoMint discovery socket failed')));
    socket.on('message', async (b, peer) => {
      if (peer.address !== '127.0.0.1' || peer.port !== port) return;
      try {
        if (b.length < 35 || b.length > 8192 || b[0] !== 0x1c || !b.subarray(1,9).equals(nonce) || !b.subarray(17,33).equals(magic) || b.length !== 35 + b.readUInt16BE(33)) throw Error('Invalid GoMint RakNet pong');
        const p = b.subarray(35).toString().split(';'), value = { edition: p[0], motd: p[1], protocol: p[2], version: p[3], players: Number(p[4]), capacity: Number(p[5]), subMotd: p[7], nonceEcho: true };
        await ctx.artifact('discovery-' + Date.now() + '.json', { observed: value, expected: { edition: 'MCPE', protocol: '422', version: '1.16.200', motd: ctx.gomint?.edited ? 'Validator GoMint retained' : '\u00a7aGoMint \u00a77Development Build', players: 0, capacity: ctx.gomint?.edited ? 7 : 10 } });
        if (value.edition !== 'MCPE' || value.protocol !== '422' || value.version !== '1.16.200' || value.motd !== (ctx.gomint?.edited ? 'Validator GoMint retained' : '\u00a7aGoMint \u00a77Development Build') || value.players !== 0 || value.capacity !== (ctx.gomint?.edited ? 7 : 10)) throw Error('GoMint native discovery/settings mismatch');
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
  if (!state.Running) throw Error('GoMint exited before readiness: ' + state.ExitCode);
  const text = (await logs(ctx, state.StartedAt)).replace(/\x1b\[[0-9;]*m/g, '');
  if (!/Done in [0-9]+ ms/.test(text) || await c.state() !== 'running') return false;
  if (!/Starting GoMint 1\.0\.0 \(MC:BE 1\.16\.200 \[422\]\) - s:d7f2c0d0/.test(text) || !/Attempting to load world 'world'/.test(text) || !/io\.gomint\.World-world - Loaded [1-9][0-9]* chunks/.test(text)) throw Error('Fresh GoMint native version/world logs missing');
  const hashes = await chain(ctx, c), p = await probe(ctx, true), engine = p.engines[0];
  if (p.engines.length !== 1 || !engine.direct || engine.module !== 'gomint.server/io.gomint.server.Bootstrap' || engine.cwd !== '/home/container') throw Error('GoMint direct native exit chain unproved');
  const proof = { containerId: container.id, startedAt: state.StartedAt, engine, hashes };
  proofs.set(ctx, proof);
  const discovery = await query(ctx); await ctx.artifact('gomint-discovery-' + Date.now() + '.json', discovery);
  return { ...proof, discovery, identity: p.identity, scope };
}
async function cleanStop(ctx, c) {
  const proof = proofs.get(ctx), container = await native(ctx), s = container?.state;
  if (!proof || container.id !== proof.containerId || s.StartedAt !== proof.startedAt || s.Running || s.ExitCode !== 0 || s.OOMKilled || s.Dead || await c.state() !== 'offline') throw Error('GoMint fresh direct engine exit 0 unproved');
  const text = (await logs(ctx, s.StartedAt)).replace(/\x1b\[[0-9;]*m/g, '');
  if (!/All worlds closed/.test(text) || !/Shutdown completed/.test(text) || /grace expired|escalating owned process|Native process exited:/i.test(text) || JSON.stringify(await chain(ctx, c)) !== JSON.stringify(proof.hashes)) throw Error('GoMint normal native stop/helper identity unproved');
  return { ...proof, engineNumericExit: 0, engineExitProven: true };
}
const url = ctx => '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent('/server.yml');
export async function settings(ctx, c) {
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'GoMint settings stop'); await cleanStop(ctx, c);
  const before = (await h.api(url(ctx))).attributes;
  for (const [key, type] of [['/maxPlayers','number'],['/motd','text']]) {
    if (!before.fields?.some(f => f.key === key && f.type === type && f.readonly === false)) throw Error('GoMint actual typed authority absent: ' + key);
  }
  await h.api(url(ctx), 'PUT', { revision: before.revision, settings: { '/maxPlayers': '7', '/motd': 'Validator GoMint retained' } });
  const after = (await h.api(url(ctx))).attributes;
  if (String(after.fields.find(f => f.key === '/maxPlayers')?.value) !== '7' || after.fields.find(f => f.key === '/motd')?.value !== 'Validator GoMint retained') throw Error('GoMint typed settings readback differs');
  ctx.gomint = { edited: true };
  ctx.startRequestedAt = Date.now(); await c.power('start');
  const fresh = await wait(ctx, () => ready(ctx, c), 'GoMint edited native discovery');
  return { changes: { '/maxPlayers': '7', '/motd': 'Validator GoMint retained' }, fresh, scope };
}
export function retentionPaths(ctx) { owned(ctx); return ['/server.yml', '/world', '/modules', '/plugins', '/.voltra/bedrock_family.py', '/.voltra/native_console.py', '/.voltra/bedrock-family-releases.json']; }
export function restoreContext(ctx, saved) {
  owned(ctx);
  if (!saved?.baseline?.identity || !saved.processProof?.engine?.direct || saved.engineNumericExit !== 0 || saved.engineExitProven !== true || !saved.hashes) throw Error('GoMint retained native proof missing');
  ctx.gomint = { edited: true, baseline: saved.baseline };
}
function compare(before, after) {
  if (JSON.stringify(before.manifest) !== JSON.stringify(after.manifest) || JSON.stringify(before.identity) !== JSON.stringify(after.identity)) throw Error('GoMint config/binary/initialized level.dat bytes changed');
}
export async function saved(ctx, c) {
  if (!ctx.gomint?.edited) throw Error('GoMint edited settings context missing');
  const processProof = await cleanStop(ctx, c), baseline = await probe(ctx), hashes = await chain(ctx, c);
  ctx.gomint.baseline = baseline;
  return { baseline, hashes, processProof, engineNumericExit: 0, engineExitProven: true, metadataBoundary, chunkPersistenceClaimed: false, scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  if (JSON.stringify(await chain(ctx, c)) !== JSON.stringify(saved.hashes)) throw Error('GoMint retained helper chain changed');
  const fresh = await ready(ctx, c);
  if (!fresh || fresh.startedAt === saved.processProof.startedAt) throw Error('GoMint fresh reload missing');
  compare(saved.baseline, await probe(ctx));
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'GoMint reload stop');
  const stop = await cleanStop(ctx, c); compare(saved.baseline, await probe(ctx));
  return { fresh, stop, initializedLevelBytesRetained: true, metadataBoundary, chunkPersistenceClaimed: false, scope };
}
