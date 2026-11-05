import { createHash } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait, command } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Historical BDS receipts are research only. Candidate21 fixes publication receipt stability;
// this x64 idle operator adapter requires fresh native evidence. No SDP/player.
export const registration = { bedrock_vanilla: {
  recipe: 'minecraft/bedrock/bedrock/egg-vanilla-bedrock.json', ports: 1,
  peakMiB: 2048, installPeakMiB: 2048, diskMiB: 4096,
  environment: { BEDROCK_VERSION: '1.26.61.1', SERVERNAME: 'Validator Vanilla Bedrock', GAMEMODE: 'survival', DIFFICULTY: 'easy', CHEATS: 'false', BEDROCK_TERMS_ACCEPTED: 'true', ONLINE_MODE: 'true', BEDROCK_TRANSPORT: 'nethernet', BEDROCK_ADVERTISED_ADDRESS: '', SERVER_PORT_V6: '0', AUTO_UPDATE: '0', LD_LIBRARY_PATH: '.' },
} };
export const retentionRequiredPath = '/server.properties';
const archiveSHA = 'f6348d84fa714d04ca194f207e89453ca6bba0a1359396475271a52a150471c6';
const sources = new WeakMap();
const launcherPin = '61526a2ab3cfb772724bb2a1dcf7300922584355a39eb31c4564aefc345c3d24';
const consolePin = 'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5';
const startup = 'exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/bedrock_family.py run bds';
const scope = 'Idle native Vanilla Bedrock discovery, typed capacity consumption, clean native stop, initialized config and native world identity reload; no players, injected world data, gameplay or WAN proof.';
const digest = x => createHash('sha256').update(x).digest('hex');
const proofs = new WeakMap();
function owned(ctx) {
  if (ctx.game.family !== 'bedrock_vanilla' || ctx.game.recipe !== registration.bedrock_vanilla.recipe || ctx.fixture?.recipe !== ctx.game.recipe || ctx.fixture?.server?.uuid !== ctx.game.serverUUID || ctx.fixture.server.name !== 'validator-' + ctx.game.id || ctx.game.testStartup) throw Error('Exact canonical owned Vanilla Bedrock fixture required');
  if (ctx.fixture.ports?.length !== 1 || !Number.isInteger(ctx.fixture.ports[0]) || ctx.fixture.ports[0] < 1025 || ctx.fixture.ports[0] > 65535) throw Error('Vanilla Bedrock requires one valid allocation');
}
async function chain(ctx, c) {
  owned(ctx);
  const profile = h.profileFromRuntime(ctx.game.recipe, receipt), served = (await h.api('/api/application/servers/' + ctx.fixture.server.id)).attributes;
  if (profile.egg.startup !== startup || served.container?.startup_command !== startup || served.uuid !== ctx.fixture.server.uuid || served.egg !== ctx.fixture.egg.id || profile.egg.config.stop !== 'stop') throw Error('Vanilla Bedrock canonical launch/stop authority changed');
  const hashes = {};
  for (const m of profile.egg.scripts.installation.script.matchAll(/cat > (\.voltra\/[a-zA-Z0-9_.-]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)) {
    const path = '/' + m[1], expected = digest(m[3] + '\n');
    if (digest(await c.read(path)) !== expected) throw Error('Vanilla Bedrock frozen helper differs: ' + path);
    hashes[path] = expected;
  }
  if (hashes['/.voltra/bedrock_family.py'] !== launcherPin || hashes['/.voltra/native_console.py'] !== consolePin || !hashes['/.voltra/steam_template.py'] || !hashes['/.voltra/native_config.py'] || !hashes['/.voltra/bedrock-family-releases.json']) throw Error('Vanilla Bedrock reviewed helper authority missing/drifted');
  const frozen = JSON.parse(await c.read('/.voltra/bedrock-family-releases.json')).bds;
  const raw = await c.read('/.voltra/bds/release.json'), release = JSON.parse(raw);
  if (frozen.sha256 !== archiveSHA || release.game !== 'bds' || release.version !== '1.26.61.1' || release.sha256 !== 'b54095267d55fd401de42f71ac4daf2c1747a49515ad41810781f1f9bafde26e' || release.url !== 'https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-1.26.61.1.zip' || release.bytes !== 98093051 || release.binary_sha256 !== 'd75212f20511eac3e3a1a45c5b57646d697a33038d5e41fa92113e1fbc14efab') throw Error('BDS exact official archive/publication identity differs');
  hashes['/.voltra/bds/release.json'] = digest(raw);
  const previous = sources.get(ctx);
  if (previous && previous.binary_sha256 !== release.binary_sha256) throw Error('BDS native binary changed during attempt');
  sources.set(ctx, release);
  return hashes;
}

// Byte manifests use the installed private Python both live and offline. The
// offline helper has no network, writes, extra mounts or mutable image lookup.
async function probe(ctx, process = false) {
  owned(ctx); const container = await native(ctx);
  if (!container) throw Error('Vanilla Bedrock native container missing');
  const script = String.raw`
import os,json,stat,hashlib,struct,zlib
from pathlib import Path
r=Path('/home/container')
def safe(p):
 if not p.is_relative_to(r):raise ValueError('Outside owned volume')
 for q in [p,*p.parents]:
  if q==r.parent:break
  if q.is_symlink():raise ValueError('Symlink in native path')
 return p
out={}
for name in ['server.properties','bedrock_server']:
 p=safe(r/name);s=p.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_size>(512*1024*1024 if name=='bedrock_server' else 2*1024*1024):raise ValueError('Invalid native file')
 hasher=hashlib.sha256()
 with p.open('rb') as stream:
  for block in iter(lambda:stream.read(1048576),b''):hasher.update(block)
 out['/'+name]=dict(sha256=hasher.hexdigest(),mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid)
raw=(r/'server.properties').read_bytes()
props={}
for line in raw.decode().splitlines():
 if '=' in line and not line.lstrip().startswith(('#','!')):
  k,v=line.split('=',1);props[k.strip()]=v.strip()
props={k:v for k,v in props.items() if k in ['max-players','server-name','server-port','level-name','online-mode','transport','server-udp-ports']}
with safe(r/'bedrock_server').open('rb') as stream:binary=stream.read(20)
if binary[:6]!=b'\x7fELF\x02\x01' or int.from_bytes(binary[18:20],'little')!=62:raise ValueError('BDS x64 ELF required')
level=safe(r/'worlds/Bedrock level/level.dat');b=level.read_bytes()
if len(b)>1048576 or len(b)<12:raise ValueError('Invalid native level.dat')
if b[:2]==b'\x1f\x8b' or b[:1]==b'\x78':
 decoder=zlib.decompressobj(31 if b[:2]==b'\x1f\x8b' else 15)
 b=decoder.decompress(b,1048577)
 if not decoder.eof or decoder.unconsumed_tail or decoder.unused_data:raise ValueError('Oversized or trailing compressed native NBT')
if len(b)>1048576:raise ValueError('Oversized decompressed native NBT')
# Bedrock level.dat version10 starts with byte10 too: validate its complete
# version/length framing before treating that byte as an NBT compound tag.
if len(b)>=9 and 1<=struct.unpack('<I',b[:4])[0]<=10 and struct.unpack('<I',b[4:8])[0]==len(b)-8 and b[8]==10:
 b=b[8:]
if b[0]!=10:raise ValueError('Missing native NBT root')
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
  if isinstance(candidate.get('Data'),dict):candidate=candidate['Data']
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
   if os.path.realpath(p/'exe')!=str((r/'bedrock_server').resolve()):continue
   a=(p/'cmdline').read_bytes().split(b'\0')[:-1]
   pp=int(next(x.split()[1] for x in (p/'status').read_text().splitlines() if x.startswith('PPid:')))
   parent=Path('/proc',str(pp));pa=(parent/'cmdline').read_bytes().split(b'\0')[:-1]
   direct=pa[1:]==[b'.voltra/bedrock_family.py',b'run',b'bds'] and os.path.realpath(parent/'exe')==str((r/'.voltra/python/bin/python3').resolve())
   executableHash=hashlib.sha256()
   with (p/'exe').open('rb') as stream:
    for block in iter(lambda:stream.read(1048576),b''):executableHash.update(block)
   engines.append(dict(pid=int(p.name),ppid=pp,startTicks=(p/'stat').read_text().rsplit(')',1)[1].split()[19],direct=direct,argv=[x.decode() for x in a],exeSHA256=executableHash.hexdigest(),cwd=os.readlink(p/'cwd')))
  except (FileNotFoundError,ProcessLookupError,PermissionError):pass
print(json.dumps(dict(manifest=out,identity=identity,properties=props,crlf=raw.count(b'\r\n'),bareLF=raw.count(b'\n')-raw.count(b'\r\n'),engines=engines),sort_keys=True))
`;
  const args = ['-B', '-c', script]; let result;
  if (container.state.Running) result = JSON.parse(await docker(['exec', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', container.id, '/home/container/.voltra/python/bin/python3', ...args], ctx.signal, 30000));
  else {
    if (process) throw Error('Cannot inspect stopped native process');
    const [id] = JSON.parse(await docker(['inspect', container.id], ctx.signal));
    const source = '/var/lib/voltra-parity-20261029/volumes/' + ctx.fixture.server.uuid;
    if (id.Name !== '/' + ctx.fixture.server.uuid || id.State.Running || !/^sha256:[a-f0-9]{64}$/.test(id.Image) || id.Mounts.filter(m => m.Destination === '/home/container' && m.Source === source).length !== 1 || id.Mounts.some(m => m.Destination.startsWith('/home/container/'))) throw Error('Offline Vanilla Bedrock volume authority mismatch');
    result = JSON.parse(await docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--user', id.Config.User, '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', '--mount', 'type=bind,src=' + source + ',dst=/home/container,readonly', '--entrypoint', '/home/container/.voltra/python/bin/python3', id.Image, ...args], ctx.signal, 30000));
  }
  await ctx.artifact('bedrock_vanilla-probe-' + Date.now() + '.json', result);
  if (!sources.get(ctx) || result.manifest['/bedrock_server'].sha256 !== sources.get(ctx).binary_sha256 || result.properties['online-mode'] !== 'true' || result.properties.transport !== 'nethernet') throw Error('Vanilla Bedrock native binary/query identity mismatch');
  if (result.properties['server-port'] !== String(ctx.fixture.ports[0]) || result.properties['server-udp-ports'] !== ctx.fixture.ports[0] + ':' + ctx.fixture.ports[0] || result.properties['server-name'] !== 'Validator Vanilla Bedrock') throw Error('BDS native primary allocation/name mapping differs');
  return result;
}
export async function prerequisites(ctx, c) {
  const hashes = await chain(ctx, c);
  const environment = (await h.api('/api/application/servers/' + ctx.fixture.server.id)).attributes.container?.environment;
  for (const [key, value] of Object.entries(registration.bedrock_vanilla.environment)) if (environment?.[key] !== value) throw Error('BDS exact reviewed startup authority differs: ' + key);
  const acceptance = { accepted: true, terms: 'https://www.minecraft.net/eula', usage: 'https://www.minecraft.net/usage-guidelines', at: new Date().toISOString(), authority: 'User explicitly authorized accepting game EULAs in this session', method: 'Exact owned BEDROCK_TERMS_ACCEPTED=true', ownershipOrLicensePurchaseClaim: false };
  await ctx.artifact('bedrock-terms-authorization.json', acceptance);
  return { required: false, hashes, acceptance, scope };
}
async function capability(ctx) {
  const response = await fetch('http://127.0.0.1:' + ctx.fixture.ports[0] + '/v1/join', { redirect: 'error', signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(5000)]) });
  const reader=response.body.getReader();let bytes=0;const chunks=[];
  try { for (;;) { const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>32768)throw Error('BDS capability oversized');chunks.push(value); } } finally { await reader.cancel(); }
  if (response.status!==200 || !response.headers.get('content-type')?.includes('application/json')) throw Error('BDS native NetherNet capability unavailable');
  const proof={status:200,responseBytes:bytes,responseSHA256:digest(Buffer.concat(chunks)),serverMetadataClaim:false,sdpOfferSent:false,authenticatedSession:false};
  await ctx.artifact('bedrock-native-capability-'+Date.now()+'.json',proof);return proof;
}
async function list(ctx) {
  const expected=ctx.bedrock_vanilla?.edited?7:10;
  const reply=await command(ctx,'list',new RegExp('There are 0/'+expected+' players online:'));
  return {capacity:expected,idle:true,nativeConsoleReply:reply};
}
async function saveCycle(ctx) {
  await command(ctx,'save hold',/Saving\.\.\./);
  try {
    const since = new Date().toISOString();
    await wait(ctx, async () => {
      await h.api('/api/client/servers/' + ctx.fixture.server.uuid + '/command', 'POST', { command: 'save query' });
      const text = await logs(ctx, since);
      if (!/Data saved\. Files are now ready to be copied\./.test(text)) return false;
      await ctx.artifact('bedrock-native-save-query.json', { nativeAcknowledgement: true, replySHA256: digest(text), scope: 'Real publisher save query acknowledgement; no world/player data injection' });
      return true;
    }, 'BDS native save query completion', 30000);
  }
  finally { await command(ctx,'save resume',/Changes to the world are resumed\./); }
  return {nativeHoldQueryResume:true,diskCompletionAcknowledged:true};
}
export async function ready(ctx, c) {
  owned(ctx); const container = await native(ctx), state = container?.state;
  if (!state || Date.parse(state.StartedAt) < ctx.startRequestedAt) return false;
  if (!state.Running) throw Error('Vanilla Bedrock exited before readiness: ' + state.ExitCode);
  const text = (await logs(ctx, state.StartedAt)).replace(/\x1b\[[0-9;]*m/g, '');
  if (!text.includes('Server started.') || await c.state() !== 'running') return false;
  if (!text.includes('Version: 1.26.61.1') || !text.includes('Level Name: Bedrock level')) throw Error('Fresh BDS publisher version/world logs missing');
  const hashes=await chain(ctx,c),p=await probe(ctx,true),engine=p.engines[0];
  await ctx.artifact('bedrock-process-observation-'+Date.now()+'.json',{engines:p.engines,binarySHA256:p.manifest['/bedrock_server'].sha256});
  if(p.engines.length!==1 || !engine.direct || engine.cwd!=='/home/container' || engine.argv.length!==1 || engine.argv[0]!=='/home/container/bedrock_server' || engine.exeSHA256!==p.manifest['/bedrock_server'].sha256)throw Error('BDS direct native exit chain unproved');
  const proof={containerId:container.id,startedAt:state.StartedAt,engine,hashes};proofs.set(ctx,proof);
  return {...proof,identity:p.identity,capability:await capability(ctx),nativeList:await list(ctx),scope};
}
async function cleanStop(ctx, c) {
  const proof = proofs.get(ctx), container = await native(ctx), s = container?.state;
  if (!proof || container.id !== proof.containerId || s.StartedAt !== proof.startedAt || s.Running || s.ExitCode !== 0 || s.OOMKilled || s.Dead || await c.state() !== 'offline') throw Error('Vanilla Bedrock fresh direct engine exit 0 unproved');
  const text = (await logs(ctx, s.StartedAt)).replace(/\x1b\[[0-9;]*m/g, '');
  if (!text.includes('Server stop requested.') || !text.includes('Stopping server...') || /grace expired|escalating owned process|Native process exited:/i.test(text) || JSON.stringify(await chain(ctx, c)) !== JSON.stringify(proof.hashes)) throw Error('Vanilla Bedrock normal native stop/helper identity unproved');
  return { ...proof, engineNumericExit: 0, engineExitProven: true };
}
const url = ctx => '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent('/server.properties');
async function rejected(ctx, c, body, pattern) {
  const before = await c.read('/server.properties'); let error;
  try { await h.api(url(ctx), 'PUT', body); } catch (e) { error = e; }
  if (!error || !pattern.test(error.message) || await c.read('/server.properties') !== before) throw Error('Vanilla Bedrock refused edit did not fail unchanged');
}
export async function settings(ctx, c) {
  await saveCycle(ctx); await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'Vanilla Bedrock settings stop'); await cleanStop(ctx, c);
  const original = await probe(ctx), before = (await h.api(url(ctx))).attributes;
  if (!before.revision || !before.fields?.some(f => f.key === 'max-players' && f.type === 'number' && f.readonly === false)) throw Error('Vanilla Bedrock editable typed capacity authority missing');
  await rejected(ctx, c, { revision: before.revision, settings: { 'max-players': 'invalid' } }, /400|422|invalid/i);
  await h.api(url(ctx), 'PUT', { revision: before.revision, settings: { 'max-players': '7' } });
  const after = (await h.api(url(ctx))).attributes;
  if (!after.revision || after.revision === before.revision || String(after.fields?.find(f => f.key === 'max-players')?.value) !== '7') throw Error('Vanilla Bedrock typed capacity/revision readback failed');
  await rejected(ctx, c, { revision: before.revision, settings: { 'max-players': '8' } }, /409|stale|revision|conflict/i);
  const edited = await probe(ctx);
  if (original.bareLF !== edited.bareLF || original.crlf > 0 && edited.crlf === 0 || JSON.stringify(original.identity) !== JSON.stringify(edited.identity)) throw Error('Vanilla Bedrock native CRLF/world identity changed by settings edit');
  ctx.bedrock_vanilla = { edited: true };
  ctx.startRequestedAt = Date.now(); await c.power('start');
  const fresh = await wait(ctx, () => ready(ctx, c), 'Vanilla Bedrock edited readiness');
  return { changes: { 'max-players': '7' }, revision: after.revision, fresh, save: await saveCycle(ctx), scope };
}
export function retentionPaths(ctx) { owned(ctx); return ['/server.properties', '/worlds', '/allowlist.json', '/permissions.json', '/bedrock_server', '/.voltra/bds', '/.voltra/bedrock_family.py', '/.voltra/native_console.py', '/.voltra/bedrock-family-releases.json']; }
export function restoreContext(ctx, saved) {
  owned(ctx);
  if (!saved?.baseline?.identity || !saved.processProof?.engine?.direct || saved.engineNumericExit !== 0 || saved.engineExitProven !== true || !saved.hashes) throw Error('Vanilla Bedrock retained native proof missing');
  ctx.bedrock_vanilla = { edited: true, baseline: saved.baseline };
}
function compare(before, after) {
  if (JSON.stringify(before.manifest) !== JSON.stringify(after.manifest) || JSON.stringify(before.identity) !== JSON.stringify(after.identity) || before.crlf !== after.crlf || before.bareLF !== after.bareLF) throw Error('Vanilla Bedrock native config/binary/world identity changed');
}
export async function saved(ctx, c) {
  if (!ctx.bedrock_vanilla?.edited) throw Error('Vanilla Bedrock edited settings context missing');
  const processProof = await cleanStop(ctx, c), baseline = await probe(ctx), hashes = await chain(ctx, c);
  if (baseline.properties['max-players'] !== '7') throw Error('Vanilla Bedrock stopped native capacity missing');
  ctx.bedrock_vanilla.baseline = baseline;
  return { baseline, hashes, processProof, engineNumericExit: 0, engineExitProven: true, scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  if (JSON.stringify(await chain(ctx, c)) !== JSON.stringify(saved.hashes)) throw Error('Vanilla Bedrock retained helper chain changed');
  const fresh = await ready(ctx, c);
  if (!fresh || fresh.startedAt === saved.processProof.startedAt) throw Error('Vanilla Bedrock fresh reload missing');
  compare(saved.baseline, await probe(ctx));
  const save=await saveCycle(ctx); await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'Vanilla Bedrock reload stop');
  const stop = await cleanStop(ctx, c); compare(saved.baseline, await probe(ctx));
  return { fresh, stop, save, nativeIdentityRetained: true, scope };
}
