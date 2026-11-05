import dgram from 'node:dgram';
import { createHash, randomBytes } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Historical PNX receipts establish protocol shapes only. Fresh current-helper evidence is required.
// Candidate20 exact-zero fallback yields2048MiB heap; finite2304MiB retains the same bounded heap.
export const registration = { pnx: {
  recipe: 'minecraft/bedrock/PowerNukkitX/egg-powernukkitx.json', ports: 1,
  environment: { VERSION: '3.0.5', SERVERNAME: 'Validator PowerNukkitX', PNX_LICENSE_ACCEPTED: 'true', AUTOREBOOT: '', AUTO_UPDATE: '0' },
} };
export const retentionRequiredPath = '/pnx.yml';
export const budgets = { memoryMiB:2304, heapMiB:2048, diskMiB:4096, startupMs:240000, stopMs:90000 };
const pin = 'bc3c54236256c8e3bf8573ecf090e3853785c7622891d7d28d780a398fc1de60';
const launcherPin = '8549b68357e0c47655a8d2d29084c35a0e2cd3d9b66bf51fe1968cef2a966d00';
const consolePin = 'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5';
const startup = 'exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/bedrock_family.py run pnx';
const scope = 'Idle native PowerNukkitX discovery, typed capacity consumption, clean native stop, initialized config and primary-world NBT identity reload; no players, injected world data, gameplay or WAN proof.';
const digest = x => createHash('sha256').update(x).digest('hex');
const proofs = new WeakMap();
function owned(ctx) {
  if (ctx.game.family !== 'pnx' || ctx.game.recipe !== registration.pnx.recipe || ctx.fixture?.recipe !== ctx.game.recipe || ctx.fixture?.server?.uuid !== ctx.game.serverUUID || ctx.fixture.server.name !== 'validator-' + ctx.game.id || ctx.game.testStartup) throw Error('Exact canonical owned PowerNukkitX fixture required');
  if (ctx.fixture.ports?.length !== 1 || !Number.isInteger(ctx.fixture.ports[0]) || ctx.fixture.ports[0] < 1025 || ctx.fixture.ports[0] > 65535) throw Error('PowerNukkitX requires one valid allocation');
}
async function chain(ctx, c) {
  owned(ctx);
  const profile = h.profileFromRuntime(ctx.game.recipe, receipt), served = (await h.api('/api/application/servers/' + ctx.fixture.server.id)).attributes;
  if (profile.egg.startup !== startup || served.container?.startup_command !== startup || served.uuid !== ctx.fixture.server.uuid || Number(served.node) === 202 || served.egg !== ctx.fixture.egg.id || profile.egg.config.stop !== 'stop') throw Error('PowerNukkitX canonical launch/stop authority changed');
  const hashes = {};
  for (const m of profile.egg.scripts.installation.script.matchAll(/cat > (\.voltra\/[a-zA-Z0-9_.-]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)) {
    const path = '/' + m[1], expected = digest(m[3] + '\n');
    if (digest(await c.read(path)) !== expected) throw Error('PowerNukkitX frozen helper differs: ' + path);
    hashes[path] = expected;
  }
  if (hashes['/.voltra/bedrock_family.py'] !== launcherPin || hashes['/.voltra/native_console.py'] !== consolePin || !hashes['/.voltra/steam_template.py'] || !hashes['/.voltra/native_config.py'] || !hashes['/.voltra/bedrock-family-releases.json']) throw Error('PowerNukkitX reviewed helper authority missing/drifted');
  const releaseRaw = await c.read('/.voltra/pnx/release.json'), release = JSON.parse(releaseRaw);
  if (release.version !== '3.0.5' || release.sha256 !== pin || release.binary_sha256 !== pin
    || release.url !== 'https://github.com/PowerNukkitX/PowerNukkitX/releases/download/3.0.5/powernukkitx.jar'
    || release.bytes !== 86100503) throw Error('PowerNukkitX reviewed publisher snapshot differs');
  hashes['/.voltra/pnx/release.json'] = digest(releaseRaw);
  return hashes;
}

// Byte manifests use the installed private Python both live and offline. The
// offline helper has no network, writes, extra mounts or mutable image lookup.
async function probe(ctx, process = false) {
  owned(ctx); const container = await native(ctx);
  if (!container) throw Error('PowerNukkitX native container missing');
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
for name in ['pnx.yml','powernukkitx.jar']:
 p=safe(r/name);s=p.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_size>128*1024*1024:raise ValueError('Invalid native file')
 out['/'+name]=dict(sha256=hashlib.sha256(p.read_bytes()).hexdigest(),mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid)
raw=(r/'pnx.yml').read_bytes()
# Observe only the actual publisher's bounded integer scalar. Full YAML editing
# remains in the backend; ambiguous/noncanonical shapes fail rather than guess.
import re
sections=list(re.finditer(r'(?m)^settings:[ \t]*(?:#.*)?$',raw.decode()))
if len(sections)!=1:raise ValueError('Unproved PNX publisher settings section')
tail=raw.decode()[sections[0].end():];nextsection=re.search(r'(?m)^[^ \t#\r\n][^\r\n]*:',tail)
section=tail[:nextsection.start()] if nextsection else tail
indents=[len(x) for x in re.findall(r'(?m)^([ ]+)[A-Za-z0-9_-]+:',section)]
if not indents or '\t' in section:raise ValueError('Unproved PNX YAML indentation')
indent=min(indents)
capacity=re.findall(r'(?m)^'+(' '*indent)+r'maxPlayers:[ ]*([0-9]+)[ ]*(?:#.*)?\r?$',section)
if len(capacity)!=1:raise ValueError('Unproved PNX existing settings.maxPlayers scalar')
props={'maxPlayers':capacity[0]}
level=safe(r/'worlds/world/level.dat');b=level.read_bytes()
if len(b)>1048576 or len(b)<12:raise ValueError('Invalid native level.dat')
if b[:2]==b'\x1f\x8b':b=gzip.decompress(b)
# A Bedrock level header version can itself be10 (TAG_Compound).
# Try the complete bounded payload at both supported offsets; never identify
# header presence from its first byte alone. Require one full identity parse.
original=b
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
candidates=[]
for offset in [0,8]:
 b=original[offset:]
 for endian in ['<','>']:
  try:
   at=0;nodes=0
   if num('B')!=10:raise ValueError('Invalid root')
   text();candidate=tag(10)
   if at!=len(b) or not isinstance(candidate.get('RandomSeed'),int) or not isinstance(candidate.get('LevelName'),str):raise ValueError('Incomplete native NBT')
   candidates.append(candidate)
  except (ValueError,UnicodeError,struct.error):pass
if len(candidates)!=1:raise ValueError('Invalid or ambiguous native NBT identity')
data=candidates[0]
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
   engines.append(dict(pid=int(p.name),ppid=pp,startTicks=(p/'stat').read_text().rsplit(')',1)[1].split()[19],direct=pa[1:]==[b'.voltra/bedrock_family.py',b'run',b'pnx'] and os.path.realpath(par/'exe')==str((r/'.voltra/python/bin/python3').resolve()),jar=a[a.index(b'-jar')+1].decode() if b'-jar' in a else None,heap2048=b'-Xmx2048M' in a,licenseAccepted=b'--accept-license' in a,cwd=os.readlink(p/'cwd')))
  except (FileNotFoundError,ProcessLookupError,PermissionError):pass
print(json.dumps(dict(manifest=out,identity=identity,properties=props,crlf=raw.count(b'\r\n'),bareLF=raw.count(b'\n')-raw.count(b'\r\n'),engines=engines),sort_keys=True))
`;
  const args = ['-B', '-c', script]; let result;
  if (container.state.Running) result = JSON.parse(await docker(['exec', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', container.id, '/home/container/.voltra/python/bin/python3', ...args], ctx.signal, 30000));
  else {
    if (process) throw Error('Cannot inspect stopped native process');
    const [id] = JSON.parse(await docker(['inspect', container.id], ctx.signal));
    const source = '/var/lib/voltra-parity-20261029/volumes/' + ctx.fixture.server.uuid;
    if (id.Name !== '/' + ctx.fixture.server.uuid || id.State.Running || !/^sha256:[a-f0-9]{64}$/.test(id.Image) || id.Mounts.filter(m => m.Destination === '/home/container' && m.Source === source).length !== 1 || id.Mounts.some(m => m.Destination.startsWith('/home/container/'))) throw Error('Offline PowerNukkitX volume authority mismatch');
    result = JSON.parse(await docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--user', id.Config.User, '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', '--mount', 'type=bind,src=' + source + ',dst=/home/container,readonly', '--entrypoint', '/home/container/.voltra/python/bin/python3', id.Image, ...args], ctx.signal, 30000));
  }
  await ctx.artifact('pnx-probe-' + Date.now() + '.json', result);
  if (result.manifest['/powernukkitx.jar'].sha256 !== pin) throw Error('PowerNukkitX native binary/query identity mismatch');
  return result;
}
export async function prerequisites(ctx,c) {
  const hashes=await chain(ctx,c),server=(await h.api('/api/application/servers/'+ctx.fixture.server.id)).attributes;
  if(await c.state()!=='offline'||(await native(ctx))?.state.Running) throw Error('PNX prerequisites require stopped owned fixture');
  const env=server.container?.environment??{};
  for(const [key,value] of Object.entries(registration.pnx.environment)) if(String(env[key])!==value) throw Error('Reviewed PNX startup control missing: '+key);
  if(![0,2304].includes(Number(server.limits?.memory))) throw Error('Reviewed PNX memory0 fallback or finite2304MiB setting required for2048MiB Java heap');
  await ctx.artifact('pnx-license-and-heap.json',{licenseAccepted:true,authority:'User explicitly authorized EULA acceptance; controlled PNX_LICENSE_ACCEPTED=true',license:'https://www.gnu.org/licenses/lgpl-3.0.html',memoryMiB:Number(server.limits.memory),expectedJavaHeapMiB:2048,autoReboot:false});
  return {hashes,publisherSHA256:pin,version:'3.0.5',scope};
}
async function query(ctx) {
  const socket = dgram.createSocket('udp4'), nonce = randomBytes(8), magic = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex'), port = ctx.fixture.ports[0];
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); ctx.signal.removeEventListener('abort', abort); socket.close(); error ? reject(error) : resolve(value); };
    const abort = () => finish(Error('PowerNukkitX discovery aborted'));
    const timer = setTimeout(() => finish(Error('PowerNukkitX discovery timeout')), 5000);
    socket.on('error', () => finish(Error('PowerNukkitX discovery socket failed')));
    socket.on('message', async (b, peer) => {
      if (peer.address !== '127.0.0.1' || peer.port !== port) return;
      try {
        if (b.length < 35 || b.length > 8192 || b[0] !== 0x1c || !b.subarray(1,9).equals(nonce) || !b.subarray(17,33).equals(magic) || b.length !== 35 + b.readUInt16BE(33)) throw Error('Invalid PowerNukkitX RakNet pong');
        const p = b.subarray(35).toString().split(';'), value = { edition: p[0], motd: p[1], protocol: p[2], version: p[3], players: Number(p[4]), capacity: Number(p[5]), subMotd: p[7], nonceEcho: true };
        await ctx.artifact('discovery-' + Date.now() + '.json', { observed: value, expected: { edition: 'MCPE', protocol: '2193', version: '1.26.50', motd: 'Validator PowerNukkitX', players: 0, capacity: ctx.pnx?.edited ? 7 : 20 } });
        if (value.edition !== 'MCPE' || value.protocol !== '2193' || value.version !== '1.26.50' || value.motd !== 'Validator PowerNukkitX' || value.players !== 0 || value.capacity !== (ctx.pnx?.edited ? 7 : 20)) throw Error('PowerNukkitX native discovery/settings mismatch');
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
  if (!state.Running) throw Error('PowerNukkitX exited before readiness: ' + state.ExitCode);
  const text = (await logs(ctx, state.StartedAt)).replace(/\x1b\[[0-9;]*m/g, '');
  if (!/Done \([0-9.]+s\)!/.test(text) || await c.state() !== 'running') return false;
  if (!/PowerNukkitX version .*git-9813b75/.test(text) || !/Preparing level .*world/.test(text)) throw Error('Fresh PowerNukkitX native version/world logs missing');
  const hashes = await chain(ctx, c), p = await probe(ctx, true), engine = p.engines[0];
  if (p.engines.length !== 1 || !engine.direct || !engine.heap2048 || !engine.licenseAccepted || engine.jar !== 'powernukkitx.jar' || engine.cwd !== '/home/container') throw Error('PowerNukkitX direct native exit chain unproved');
  const proof = { containerId: container.id, startedAt: state.StartedAt, engine, hashes };
  proofs.set(ctx, proof);
  const discovery = await query(ctx); await ctx.artifact('pnx-discovery-' + Date.now() + '.json', discovery);
  return { ...proof, discovery, identity: p.identity, scope };
}
async function cleanStop(ctx, c) {
  const proof = proofs.get(ctx), container = await native(ctx), s = container?.state;
  if (!proof || container.id !== proof.containerId || s.StartedAt !== proof.startedAt || s.Running || s.ExitCode !== 0 || s.OOMKilled || s.Dead || await c.state() !== 'offline') throw Error('PowerNukkitX fresh direct engine exit 0 unproved');
  const text = (await logs(ctx, s.StartedAt)).replace(/\x1b\[[0-9;]*m/g, '');
  if (!/Stopping the server/.test(text) || !/Unloading level .*world"/.test(text) || !/Unloading level .*world_the_nether"/.test(text) || !/Unloading level .*world_the_end"/.test(text) || !/Stopping other threads/.test(text) || /grace expired|escalating owned process|Native process exited:/i.test(text) || JSON.stringify(await chain(ctx, c)) !== JSON.stringify(proof.hashes)) throw Error('PowerNukkitX normal native stop/helper identity unproved');
  return { ...proof, engineNumericExit: 0, engineExitProven: true };
}
const url = ctx => '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent('/pnx.yml');
async function rejected(ctx, c, body, pattern) {
  const before = await c.read('/pnx.yml'); let error;
  try { await h.api(url(ctx), 'PUT', body); } catch (e) { error = e; }
  if (!error || !pattern.test(error.message) || await c.read('/pnx.yml') !== before) throw Error('PowerNukkitX refused edit did not fail unchanged');
}
export async function settings(ctx, c) {
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'PowerNukkitX settings stop'); await cleanStop(ctx, c);
  const original = await probe(ctx), before = (await h.api(url(ctx))).attributes;
  if (!before.revision || !before.fields?.some(f => f.key === '/settings/maxPlayers' && f.type === 'number' && f.readonly === false)) throw Error('PowerNukkitX editable typed capacity authority missing');
  await rejected(ctx, c, { revision: before.revision, settings: { '/settings/maxPlayers': 'invalid' } }, /400|422|invalid/i);
  await h.api(url(ctx), 'PUT', { revision: before.revision, settings: { '/settings/maxPlayers': '7' } });
  const after = (await h.api(url(ctx))).attributes;
  if (!after.revision || after.revision === before.revision || String(after.fields?.find(f => f.key === '/settings/maxPlayers')?.value) !== '7') throw Error('PowerNukkitX typed capacity/revision readback failed');
  await rejected(ctx, c, { revision: before.revision, settings: { '/settings/maxPlayers': '8' } }, /409|stale|revision|conflict/i);
  const unchanged = body => JSON.stringify(body.fields.filter(f=>f.key!=='/settings/maxPlayers').map(f=>[f.key,f.type,f.value,f.readonly]).sort((a,b)=>a[0].localeCompare(b[0])));
  if(unchanged(before)!==unchanged(after)) throw Error('PNX unrelated typed settings changed');
  const edited = await probe(ctx);
  if (JSON.stringify(original.identity) !== JSON.stringify(edited.identity)) throw Error('PNX native world identity changed by settings edit');
  ctx.pnx = { edited: true };
  ctx.startRequestedAt = Date.now(); await c.power('start');
  const fresh = await wait(ctx, () => ready(ctx, c), 'PowerNukkitX edited readiness');
  return { changes: { '/settings/maxPlayers': '7' }, revision: after.revision, fresh, scope };
}
export function retentionPaths(ctx) { owned(ctx); return ['/pnx.yml', '/worlds', '/players', '/plugins', '/powernukkitx.jar', '/.voltra/bedrock_family.py', '/.voltra/native_console.py', '/.voltra/bedrock-family-releases.json']; }
export function restoreContext(ctx, saved) {
  owned(ctx);
  if (!saved?.baseline?.identity || !saved.processProof?.engine?.direct || saved.engineNumericExit !== 0 || saved.engineExitProven !== true || !saved.hashes) throw Error('PowerNukkitX retained native proof missing');
  ctx.pnx = { edited: true, baseline: saved.baseline };
}
function compare(before, after) {
  if (JSON.stringify(before.manifest) !== JSON.stringify(after.manifest) || JSON.stringify(before.identity) !== JSON.stringify(after.identity) || before.crlf !== after.crlf || before.bareLF !== after.bareLF) throw Error('PowerNukkitX native config/binary/world identity changed');
}
export async function saved(ctx, c) {
  if (!ctx.pnx?.edited) throw Error('PowerNukkitX edited settings context missing');
  const processProof = await cleanStop(ctx, c), baseline = await probe(ctx), hashes = await chain(ctx, c);
  if (baseline.properties['maxPlayers'] !== '7') throw Error('PowerNukkitX stopped native capacity missing');
  ctx.pnx.baseline = baseline;
  return { baseline, hashes, processProof, engineNumericExit: 0, engineExitProven: true, scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  if (JSON.stringify(await chain(ctx, c)) !== JSON.stringify(saved.hashes)) throw Error('PowerNukkitX retained helper chain changed');
  const fresh = await ready(ctx, c);
  if (!fresh || fresh.startedAt === saved.processProof.startedAt) throw Error('PowerNukkitX fresh reload missing');
  compare(saved.baseline, await probe(ctx));
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'PowerNukkitX reload stop');
  const stop = await cleanStop(ctx, c); compare(saved.baseline, await probe(ctx));
  return { fresh, stop, nativeIdentityRetained: true, scope };
}
