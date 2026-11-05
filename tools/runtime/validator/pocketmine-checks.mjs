import dgram from 'node:dgram';
import { createHash, randomBytes } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Historical PM5 receipts are research only. Candidate12 changed shared helpers;
// every native assertion below needs a fresh root-owned run. PM4/ARM are excluded.
export const registration = { pocketmine: {
  recipe: 'minecraft/bedrock/pocketmine_mp/egg-pocketmine-m-p.json', ports: 1,
  peakMiB: 2048, installPeakMiB: 2048, diskMiB: 4096,
  environment: { VERSION: 'PM5', SERVERNAME: 'Validator PocketMine PM5', SERVER_PORT_V6: '0', AUTO_UPDATE: '0' },
} };
export const retentionRequiredPath = '/server.properties';
// Publisher PHAR/PHP archive identity comes from the exact frozen manifest.
const sources = new WeakMap();
const launcherPin = 'c47a3da9cbdeef19e726082911deb8830d2e0cf610032822ffff24f8d9b50f98';
const consolePin = 'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5';
const startup = 'exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/bedrock_family.py run pocketmine';
const scope = 'Idle native PocketMine PM5 discovery, typed capacity consumption, clean native stop, initialized config and native world identity reload; no players, injected world data, gameplay or WAN proof.';
const digest = x => createHash('sha256').update(x).digest('hex');
const proofs = new WeakMap();
function owned(ctx) {
  if (ctx.game.family !== 'pocketmine' || ctx.game.recipe !== registration.pocketmine.recipe || ctx.fixture?.recipe !== ctx.game.recipe || ctx.fixture?.server?.uuid !== ctx.game.serverUUID || ctx.fixture.server.name !== 'validator-' + ctx.game.id || ctx.game.testStartup) throw Error('Exact canonical owned PocketMine PM5 fixture required');
  if (ctx.fixture.ports?.length !== 1 || !Number.isInteger(ctx.fixture.ports[0]) || ctx.fixture.ports[0] < 1025 || ctx.fixture.ports[0] > 65535) throw Error('PocketMine PM5 requires one valid allocation');
}
async function chain(ctx, c) {
  owned(ctx);
  const profile = h.profileFromRuntime(ctx.game.recipe, receipt), served = (await h.api('/api/application/servers/' + ctx.fixture.server.id)).attributes;
  if (profile.egg.startup !== startup || served.container?.startup_command !== startup || served.uuid !== ctx.fixture.server.uuid || served.egg !== ctx.fixture.egg.id || profile.egg.config.stop !== 'stop') throw Error('PocketMine PM5 canonical launch/stop authority changed');
  const hashes = {};
  for (const m of profile.egg.scripts.installation.script.matchAll(/cat > (\.voltra\/[a-zA-Z0-9_.-]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)) {
    const path = '/' + m[1], expected = digest(m[3] + '\n');
    if (digest(await c.read(path)) !== expected) throw Error('PocketMine PM5 frozen helper differs: ' + path);
    hashes[path] = expected;
  }
  if (hashes['/.voltra/bedrock_family.py'] !== launcherPin || hashes['/.voltra/native_console.py'] !== consolePin || !hashes['/.voltra/steam_template.py'] || !hashes['/.voltra/native_config.py'] || !hashes['/.voltra/bedrock-family-releases.json']) throw Error('PocketMine PM5 reviewed helper authority missing/drifted');
  const frozen = JSON.parse(await c.read('/.voltra/bedrock-family-releases.json'));
  const pm5 = frozen.pm5, php5 = frozen.php5;
  if (!pm5 || !php5 || !/^[a-f0-9]{64}$/.test(pm5.sha256) || !/^[a-f0-9]{64}$/.test(php5.sha256)
    || pm5.identity !== 'Publisher GitHub asset SHA256' || php5.identity !== 'Publisher GitHub asset SHA256'
    || !/^https:\/\/github\.com\/pmmp\/PocketMine-MP\/releases\/download\/5\.[0-9.]+\/PocketMine-MP\.phar$/.test(pm5.url)
    || php5.url !== 'https://github.com/pmmp/PHP-Binaries/releases/download/pm5-latest/PHP-8.2-Linux-x86_64-PM5.tar.gz') throw Error('Frozen PM5 official publisher identity missing');
  const releaseRaw = await c.read('/.voltra/pocketmine/release.json'), release = JSON.parse(releaseRaw);
  for (const key of ['version','url','bytes','sha256','identity']) if (release.php?.[key] !== php5[key]) throw Error('PocketMine PHP publication differs: ' + key);
  if (release.game !== 'pocketmine' || !/^5\.[0-9]+\.[0-9]+$/.test(release.version) || !/^[a-f0-9]{64}$/.test(release.sha256) || release.binary_sha256 !== release.sha256
    || release.url !== 'https://github.com/pmmp/PocketMine-MP/releases/download/' + release.version + '/PocketMine-MP.phar') throw Error('PocketMine PM5 installed publication identity mismatch');
  const previous = sources.get(ctx), releaseHash = digest(releaseRaw);
  if (previous && previous.releaseHash !== releaseHash) throw Error('PocketMine installed release changed during attempt');
  if (!previous) {
    if (release.version === pm5.version) {
      for (const key of ['url','bytes','sha256','identity']) if (release[key] !== pm5[key]) throw Error('Frozen PM5 publication differs: ' + key);
    } else {
      // Canonical PM5 selects publisher latest. Verify the exact installed tag,
      // not a second moving latest lookup, before admitting a newer PHAR.
      const response = await fetch('https://api.github.com/repos/pmmp/PocketMine-MP/releases/tags/' + encodeURIComponent(release.version), { headers: { Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(15000)]) });
      if (!response.ok) throw Error('PM5 publisher identity unavailable: HTTP ' + response.status + '; preserve installed fixture');
      const raw = await response.text(); if (raw.length > 1048576) throw Error('Oversized PM5 publisher metadata');
      const metadata = JSON.parse(raw), assets = metadata.assets?.filter(a => a.name === 'PocketMine-MP.phar');
      if (metadata.tag_name !== release.version || metadata.draft || metadata.prerelease || assets?.length !== 1 || assets[0].digest !== 'sha256:' + release.sha256 || assets[0].size !== release.bytes || assets[0].browser_download_url !== release.url) throw Error('Current official PM5 asset identity differs');
      await ctx.artifact('pocketmine-official-installed-release.json', { version: release.version, sha256: release.sha256, bytes: release.bytes, url: release.url, metadataSHA256: digest(raw) });
    }
    sources.set(ctx, { pm5: release, php5, releaseHash });
  }
  hashes['/.voltra/pocketmine/release.json'] = releaseHash;
  return hashes;
}

// Byte manifests use the installed private Python both live and offline. The
// offline helper has no network, writes, extra mounts or mutable image lookup.
async function probe(ctx, process = false) {
  owned(ctx); const container = await native(ctx);
  if (!container) throw Error('PocketMine PM5 native container missing');
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
for name in ['server.properties','PocketMine-MP.phar','bin/php7/bin/php','.voltra/pocketmine/php.ini']:
 p=safe(r/name);s=p.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_size>64*1024*1024:raise ValueError('Invalid native file')
 out['/'+name]=dict(sha256=hashlib.sha256(p.read_bytes()).hexdigest(),mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid)
raw=(r/'server.properties').read_bytes()
props={}
for line in raw.decode().splitlines():
 if '=' in line and not line.lstrip().startswith(('#','!')):
  k,v=line.split('=',1);props[k.strip()]=v.strip()
props={k:v for k,v in props.items() if k in ['max-players','enable-query','motd','server-port','level-name','enable-ipv6']}
php=safe(r/'bin/php7/bin/php').read_bytes()
if php[:6]!=b'\x7fELF\x02\x01' or int.from_bytes(php[18:20],'little')!=62:raise ValueError('PM5 x64 ELF runtime required')
level=safe(r/'worlds/world/level.dat');b=level.read_bytes()
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
engines=[];phpCandidates=[]
expectedTitle=${JSON.stringify('PocketMine-MP ' + sources.get(ctx).pm5.version)}
extensions=list(safe(r/'bin/php7/lib/php/extensions').iterdir())
if len(extensions)!=1 or not extensions[0].is_dir() or extensions[0].is_symlink():raise ValueError('Invalid PM5 extension topology')
expectedIni=('extension_dir=\"'+str(extensions[0])+'\"\nzend_extension=opcache.so\n').encode()
if safe(r/'.voltra/pocketmine/php.ini').read_bytes()!=expectedIni:raise ValueError('PM5 native ini differs from frozen launch source')
if ${process ? 'True' : 'False'}:
 for p in list(Path('/proc').iterdir())[:65536]:
  if not p.name.isdigit():continue
  try:
   a=(p/'cmdline').read_bytes().split(b'\0')[:-1]
   if os.path.realpath(p/'exe')!=str((r/'bin/php7/bin/php').resolve()):continue
   pp=int(next(x.split()[1] for x in (p/'status').read_text().splitlines() if x.startswith('PPid:')))
   par=Path('/proc',str(pp));pa=(par/'cmdline').read_bytes().split(b'\0')[:-1]
   phpCandidates.append(dict(pid=int(p.name),ppid=pp,argv=[x.decode(errors='replace')[:1024] for x in a[:16]],parentArgv=[x.decode(errors='replace')[:1024] for x in pa[:8]],parentExe=os.path.realpath(par/'exe'),cwd=os.readlink(p/'cwd')))
   direct=pa[1:]==[b'.voltra/bedrock_family.py',b'run',b'pocketmine'] and os.path.realpath(par/'exe')==str((r/'.voltra/python/bin/python3').resolve())
   # Native Server.php rewrites argv with cli_set_process_title. The console
   # reader's parent is PHP, so it cannot satisfy this Python parent chain.
   if not direct:continue
   procEnvironment=(p/'environ').read_bytes()
   engines.append(dict(pid=int(p.name),ppid=pp,startTicks=(p/'stat').read_text().rsplit(')',1)[1].split()[19],direct=pa[1:]==[b'.voltra/bedrock_family.py',b'run',b'pocketmine'] and os.path.realpath(par/'exe')==str((r/'.voltra/python/bin/python3').resolve()),argv=[x.decode() for x in a],nativeTitle=[x.decode() for x in a if x],expectedTitle=expectedTitle,exeSHA256=hashlib.sha256((p/'exe').read_bytes()).hexdigest(),phprc=procEnvironment.split(b'\0').count(b'PHPRC=/home/container/.voltra/pocketmine/php.ini')==1,scanDisabled=b'PHP_INI_SCAN_DIR=' in procEnvironment.split(b'\0'),procEnvironBytes=len(procEnvironment),procEnvironAllNul=bool(procEnvironment) and not procEnvironment.strip(b'\0'),cwd=os.readlink(p/'cwd')))
  except (FileNotFoundError,ProcessLookupError,PermissionError):pass
print(json.dumps(dict(manifest=out,identity=identity,properties=props,crlf=raw.count(b'\r\n'),bareLF=raw.count(b'\n')-raw.count(b'\r\n'),engines=engines,phpCandidates=phpCandidates),sort_keys=True))
`;
  const args = ['-B', '-c', script]; let result;
  if (container.state.Running) result = JSON.parse(await docker(['exec', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', container.id, '/home/container/.voltra/python/bin/python3', ...args], ctx.signal, 30000));
  else {
    if (process) throw Error('Cannot inspect stopped native process');
    const [id] = JSON.parse(await docker(['inspect', container.id], ctx.signal));
    const source = '/var/lib/voltra-parity-20261029/volumes/' + ctx.fixture.server.uuid;
    if (id.Name !== '/' + ctx.fixture.server.uuid || id.State.Running || !/^sha256:[a-f0-9]{64}$/.test(id.Image) || id.Mounts.filter(m => m.Destination === '/home/container' && m.Source === source).length !== 1 || id.Mounts.some(m => m.Destination.startsWith('/home/container/'))) throw Error('Offline PocketMine PM5 volume authority mismatch');
    result = JSON.parse(await docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--user', id.Config.User, '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', '--mount', 'type=bind,src=' + source + ',dst=/home/container,readonly', '--entrypoint', '/home/container/.voltra/python/bin/python3', id.Image, ...args], ctx.signal, 30000));
  }
  await ctx.artifact('pocketmine-probe-' + Date.now() + '.json', result);
  if (!sources.get(ctx) || result.manifest['/PocketMine-MP.phar'].sha256 !== sources.get(ctx).pm5.sha256 || result.properties['enable-query'] !== 'on') throw Error('PocketMine PM5 native binary/query identity mismatch');
  return result;
}
export async function prerequisites(ctx, c) {
  const hashes = await chain(ctx, c);
  const environment = (await h.api('/api/application/servers/' + ctx.fixture.server.id)).attributes.container?.environment;
  if (environment?.VERSION !== 'PM5' || environment.SERVER_PORT_V6 !== '0' || environment.AUTO_UPDATE !== '0') throw Error('PM5 x64/private IPv6-disabled startup authority required');
  return { required: false, hashes, publisher: sources.get(ctx), scope };
}
async function query(ctx) {
  const socket = dgram.createSocket('udp4'), nonce = randomBytes(8), magic = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex'), port = ctx.fixture.ports[0];
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); ctx.signal.removeEventListener('abort', abort); socket.close(); error ? reject(error) : resolve(value); };
    const abort = () => finish(Error('PocketMine PM5 discovery aborted'));
    const timer = setTimeout(() => finish(Error('PocketMine PM5 discovery timeout')), 5000);
    socket.on('error', () => finish(Error('PocketMine PM5 discovery socket failed')));
    socket.on('message', async (b, peer) => {
      if (peer.address !== '127.0.0.1' || peer.port !== port) return;
      try {
        if (b.length < 35 || b.length > 8192 || b[0] !== 0x1c || !b.subarray(1,9).equals(nonce) || !b.subarray(17,33).equals(magic) || b.length !== 35 + b.readUInt16BE(33)) throw Error('Invalid PocketMine PM5 RakNet pong');
        const p = b.subarray(35).toString().split(';'), value = { edition: p[0], motd: p[1], protocol: p[2], version: p[3], players: Number(p[4]), capacity: Number(p[5]), subMotd: p[7], nonceEcho: true };
        await ctx.artifact('discovery-' + Date.now() + '.json', { observed: value, expected: { edition: 'MCPE', publisherVersion: sources.get(ctx)?.pm5.version, consistentNetwork: ctx.pocketmineNetwork ?? null, motd: 'Validator PocketMine PM5', players: 0, capacity: ctx.pocketmine?.edited ? 7 : 20 } });
        if (value.edition !== 'MCPE' || !/^\d+$/.test(value.protocol) || Number(value.protocol) < 1001 || !/^1\.[0-9]+\.[0-9]+$/.test(value.version) || value.motd !== 'Validator PocketMine PM5' || value.players !== 0 || value.capacity !== (ctx.pocketmine?.edited ? 7 : 20)) throw Error('PocketMine PM5 native discovery/settings mismatch');
        const network = { protocol: value.protocol, version: value.version };
        if (ctx.pocketmineNetwork && JSON.stringify(ctx.pocketmineNetwork) !== JSON.stringify(network)) throw Error('PocketMine native network identity changed');
        ctx.pocketmineNetwork = network;
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
  if (!state.Running) throw Error('PocketMine PM5 exited before readiness: ' + state.ExitCode);
  const text = (await logs(ctx, state.StartedAt)).replace(/\x1b\[[0-9;]*m/g, '');
  if (!/Done \([0-9.]+s\)!/.test(text) || await c.state() !== 'running') return false;
  await chain(ctx, c);
  if (!text.includes('PocketMine-MP version ' + sources.get(ctx)?.pm5.version) || !/Preparing world .*world/.test(text)) throw Error('Fresh PocketMine PM5 native version/world logs missing');
  const hashes = await chain(ctx, c), p = await probe(ctx, true), engine = p.engines[0];
  await ctx.artifact('native-process-observation-' + Date.now() + '.json', { engines: p.engines, phpCandidates: p.phpCandidates, phpSHA256: p.manifest['/bin/php7/bin/php'].sha256 });
  if (p.engines.length !== 1 || !engine.direct || JSON.stringify(engine.nativeTitle) !== JSON.stringify(['PocketMine-MP ' + sources.get(ctx).pm5.version]) || !((engine.phprc && engine.scanDisabled) || (!engine.phprc && !engine.scanDisabled && engine.procEnvironAllNul === true && engine.procEnvironBytes > 0)) || engine.exeSHA256 !== p.manifest['/bin/php7/bin/php'].sha256 || engine.cwd !== '/home/container') throw Error('PocketMine PM5 direct native exit chain unproved');
  const readers = p.phpCandidates.filter(candidate => candidate.ppid === engine.pid && candidate.parentExe === '/home/container/bin/php7/bin/php' && candidate.cwd === '/home/container' && JSON.stringify(candidate.argv.filter(Boolean)) === JSON.stringify(['PocketMine-MP Console Reader']));
  if (readers.length !== 1) throw Error('PocketMine native PHP-parented console reader topology missing');
  await ctx.artifact('native-console-reader-' + Date.now() + '.json', { reader: readers[0], mainPid: engine.pid, loadedIniObserved: false });
  const proof = { containerId: container.id, startedAt: state.StartedAt, engine, hashes, environment: { sourceProven: true, procEnvironUnavailable: engine.procEnvironAllNul === true, procPHPRCObserved: engine.phprc, procScanDisabledObserved: engine.scanDisabled, loadedIniObserved: false, iniBytesMatchFrozenLaunch: true, scope: 'Frozen launcher supplies PHPRC and PHP_INI_SCAN_DIR plus explicit -c; native main/console readiness observed separately. No php_ini_loaded_file/getenv readback claim.', clobberImplementation: 'https://raw.githubusercontent.com/php/php-src/PHP-8.2/sapi/cli/ps_title.c' }, launchArguments: { sourceProven: true, observedOriginalArgv: false, helperSHA256: launcherPin, expected: ['/home/container/bin/php7/bin/php', '-c', '/home/container/.voltra/pocketmine/php.ini', '/home/container/PocketMine-MP.phar', '--no-wizard', '--disable-ansi'], nativeTitleSource: 'https://raw.githubusercontent.com/pmmp/PocketMine-MP/5.44.3/src/Server.php#L930', consoleReaderSource: 'https://raw.githubusercontent.com/pmmp/PocketMine-MP/5.44.3/src/console/ConsoleReaderChildProcess.php#L43' } };
  proofs.set(ctx, proof);
  const discovery = await query(ctx); await ctx.artifact('pocketmine-discovery-' + Date.now() + '.json', discovery);
  return { ...proof, discovery, identity: p.identity, scope };
}
async function cleanStop(ctx, c) {
  const proof = proofs.get(ctx), container = await native(ctx), s = container?.state;
  if (!proof || container.id !== proof.containerId || s.StartedAt !== proof.startedAt || s.Running || s.ExitCode !== 0 || s.OOMKilled || s.Dead || await c.state() !== 'offline') throw Error('PocketMine PM5 fresh direct engine exit 0 unproved');
  const text = (await logs(ctx, s.StartedAt)).replace(/\x1b\[[0-9;]*m/g, '');
  if (!/Stopping the server/.test(text) || !/Unloading world .*world/.test(text) || /grace expired|escalating owned process|Native process exited:/i.test(text) || JSON.stringify(await chain(ctx, c)) !== JSON.stringify(proof.hashes)) throw Error('PocketMine PM5 normal native stop/helper identity unproved');
  return { ...proof, engineNumericExit: 0, engineExitProven: true };
}
const url = ctx => '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent('/server.properties');
async function rejected(ctx, c, body, pattern) {
  const before = await c.read('/server.properties'); let error;
  try { await h.api(url(ctx), 'PUT', body); } catch (e) { error = e; }
  if (!error || !pattern.test(error.message) || await c.read('/server.properties') !== before) throw Error('PocketMine PM5 refused edit did not fail unchanged');
}
export async function settings(ctx, c) {
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'PocketMine PM5 settings stop'); await cleanStop(ctx, c);
  const original = await probe(ctx), before = (await h.api(url(ctx))).attributes;
  if (!before.revision || !before.fields?.some(f => f.key === 'max-players' && f.type === 'number' && f.readonly === false)) throw Error('PocketMine PM5 editable typed capacity authority missing');
  await rejected(ctx, c, { revision: before.revision, settings: { 'max-players': 'invalid' } }, /400|422|invalid/i);
  await h.api(url(ctx), 'PUT', { revision: before.revision, settings: { 'max-players': '7' } });
  const after = (await h.api(url(ctx))).attributes;
  if (!after.revision || after.revision === before.revision || String(after.fields?.find(f => f.key === 'max-players')?.value) !== '7') throw Error('PocketMine PM5 typed capacity/revision readback failed');
  await rejected(ctx, c, { revision: before.revision, settings: { 'max-players': '8' } }, /409|stale|revision|conflict/i);
  const edited = await probe(ctx);
  if (original.bareLF !== edited.bareLF || original.crlf > 0 && edited.crlf === 0 || JSON.stringify(original.identity) !== JSON.stringify(edited.identity)) throw Error('PocketMine PM5 native CRLF/world identity changed by settings edit');
  ctx.pocketmine = { edited: true };
  ctx.startRequestedAt = Date.now(); await c.power('start');
  const fresh = await wait(ctx, () => ready(ctx, c), 'PocketMine PM5 edited readiness');
  return { changes: { 'max-players': '7' }, revision: after.revision, fresh, scope };
}
export function retentionPaths(ctx) { owned(ctx); return ['/server.properties', '/worlds', '/players', '/plugins', '/PocketMine-MP.phar', '/bin/php7', '/.voltra/pocketmine', '/.voltra/bedrock_family.py', '/.voltra/native_console.py', '/.voltra/bedrock-family-releases.json']; }
export function restoreContext(ctx, saved) {
  owned(ctx);
  if (!saved?.baseline?.identity || !saved.processProof?.engine?.direct || saved.engineNumericExit !== 0 || saved.engineExitProven !== true || !saved.hashes) throw Error('PocketMine PM5 retained native proof missing');
  ctx.pocketmine = { edited: true, baseline: saved.baseline };
  if (!saved.network || !/^\d+$/.test(saved.network.protocol)) throw Error('PocketMine retained native network identity missing');
  ctx.pocketmineNetwork = saved.network;
}
function compare(before, after) {
  if (JSON.stringify(before.manifest) !== JSON.stringify(after.manifest) || JSON.stringify(before.identity) !== JSON.stringify(after.identity) || before.crlf !== after.crlf || before.bareLF !== after.bareLF) throw Error('PocketMine PM5 native config/binary/world identity changed');
}
export async function saved(ctx, c) {
  if (!ctx.pocketmine?.edited) throw Error('PocketMine PM5 edited settings context missing');
  const processProof = await cleanStop(ctx, c), baseline = await probe(ctx), hashes = await chain(ctx, c);
  if (baseline.properties['max-players'] !== '7') throw Error('PocketMine PM5 stopped native capacity missing');
  ctx.pocketmine.baseline = baseline;
  return { baseline, hashes, network: ctx.pocketmineNetwork, processProof, engineNumericExit: 0, engineExitProven: true, scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  if (JSON.stringify(await chain(ctx, c)) !== JSON.stringify(saved.hashes)) throw Error('PocketMine PM5 retained helper chain changed');
  const fresh = await ready(ctx, c);
  if (!fresh || fresh.startedAt === saved.processProof.startedAt) throw Error('PocketMine PM5 fresh reload missing');
  compare(saved.baseline, await probe(ctx));
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'PocketMine PM5 reload stop');
  const stop = await cleanStop(ctx, c); compare(saved.baseline, await probe(ctx));
  return { fresh, stop, nativeIdentityRetained: true, scope };
}
