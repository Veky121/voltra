import dgram from 'node:dgram';
import { createHash, randomBytes } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
import { canonicalEggUUID } from './smallgames-canonical-check.mjs';
export { verifyBuild } from './game-checks.mjs';

// Historical f64fca receipts are research only. b802 requires fresh native proof.
const recipes = {
  waterdog: 'minecraft/proxy/bedrock/waterdog_pe/egg-waterdog-p-e.json',
  'waterdog-duplicate': 'minecraft/proxy/bedrock/waterdog_pe/egg-waterdog-pe.json',
};
export const registration = Object.fromEntries(Object.entries(recipes).map(([family, recipe]) => [family, { recipe, ports: 2, peakMiB: 2048, installPeakMiB: 2048, diskMiB: 4096, environment: { WATERDOG_VERSION: 'latest', SERVER_JARFILE: 'server.jar', DOWNLOAD_SHA256: '', WATERDOG_TRANSPORT: 'both' } }]));
export const retentionRequiredPath = '/config.yml';
const jarSHA = 'b8023621c5d5c3fc38a008df065a70bf3396b26eeae74c9d3a747c9e901c7581';
const helperImage = 'sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8';
const hash = x => createHash('sha256').update(x).digest('hex');
const proofs = new WeakMap();
const scope = 'Fresh native proxy discovery/settings/config/plugin/NetherNet identity retention only. No world save, player login, backend join/forwarding, WebRTC media, STUN reachability, TLS trust or WAN claim.';
function owned(ctx) {
  const family = Object.keys(recipes).find(key => recipes[key] === ctx.game.recipe), f = ctx.fixture;
  if (!family || ctx.game.id !== family + '-canonical-b802' || ctx.game.family !== family || f?.recipe !== ctx.game.recipe || f.server?.uuid !== ctx.game.serverUUID || f.name !== 'validator-' + ctx.game.id || f.server.name !== f.name || ctx.game.testStartup) throw Error('Exact owned canonical Waterdog variant required');
  if (f.ports?.length !== 2 || new Set(f.ports).size !== 2 || f.ports.some(p => !Number.isInteger(p) || p < 1025 || p > 65535)) throw Error('Two distinct Waterdog allocations required');
  return family;
}
async function authority(ctx, c) {
  const family = owned(ctx), profile = h.profileFromRuntime(ctx.game.recipe, receipt);
  const server = (await h.api('/api/application/servers/' + ctx.fixture.server.id)).attributes;
  const egg = (await h.api('/api/admin/eggs/' + server.egg)).attributes;
  const expectedUUID = canonicalEggUUID({ game: { id: family + '-canonical' } }, profile);
  const sourceScript = profile.egg.scripts.installation.script;
  const gatedScript = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(ctx.fixture.gateId ?? '') ? h.installerGate(sourceScript, ctx.fixture.gateId).replace(/\n$/, '') : null;
  const allowedScript = egg.script_install === sourceScript || gatedScript !== null && egg.script_install === gatedScript;
  if (egg.uuid !== expectedUUID || ctx.fixture.egg?.uuid !== expectedUUID || server.uuid !== ctx.fixture.server.uuid || server.name !== ctx.fixture.name || server.egg !== ctx.fixture.egg.id || server.container?.startup_command !== profile.egg.startup || !allowedScript || profile.egg.config.stop !== 'end') throw Error('Canonical Waterdog egg/startup/script authority differs');
  const ec = profile.egg.voltra?.java_config;
  const runtimes = (await h.api('/api/admin/java/runtimes')).data.map(row => row.attributes ?? row);
  const runtime = runtimes.find(row => row.enabled === true && Number(row.major) === 21 && (!ec?.required_distribution || row.distribution === ec.required_distribution));
  const expectedJava = { enabled: true, required_major: 0, required_distribution: '', runtime_id: 'auto', xms_mib: 128, xmx_mib: 2048, extra_args: '' };
  const java = server.java_config ?? {};
  if (ec?.enabled !== true || ec.default_major !== 21 || ec.required_major !== 17 || !runtime || server.container.image !== runtime.image || ctx.fixture.diagnosticMemory?.confirmed !== true || Object.keys(java).length !== Object.keys(expectedJava).length || Object.entries(expectedJava).some(([key, value]) => java[key] !== value) || Number(server.limits?.memory) !== 0) throw Error('Waterdog exact managed Java21/2048MiB heap test authority differs');
  const environment = server.container.environment;
  if (environment.WATERDOG_VERSION !== 'latest' || environment.SERVER_JARFILE !== 'server.jar' || environment.DOWNLOAD_SHA256 !== '' || environment.WATERDOG_TRANSPORT !== 'both' || environment.WEBRTC_PORT !== String(ctx.fixture.ports[1])) throw Error('Waterdog transport/media allocation authority differs');
  const helpers = {};
  for (const m of profile.egg.scripts.installation.script.matchAll(/cat > (\.voltra\/[a-zA-Z0-9_.-]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)) {
    const path = '/' + m[1], expected = hash(m[3] + '\n');
    if (hash(await c.read(path)) !== expected) throw Error('Waterdog frozen helper differs: ' + path);
    helpers[path] = expected;
  }
  for (const name of ['limbo_install.py', 'proxy_family_install.py', 'proxy-family-releases.json']) if (!helpers['/.voltra/' + name]) throw Error('Waterdog helper chain missing');
  const pinned = JSON.parse(await c.read('/.voltra/proxy-family-releases.json')).waterdog;
  const raw = await c.read('/.voltra/proxy-family/release.json'), release = JSON.parse(raw);
  if (pinned.sha256 !== jarSHA || pinned.release_id !== 431363986 || pinned.bytes !== 73951735 || release.sha256 !== jarSHA || release.release_id !== pinned.release_id || release.url !== pinned.url || release.main_class !== 'dev.waterdog.waterdogpe.WaterdogPE' || release.class_major !== 61) throw Error('Waterdog reviewed publisher/JAR identity differs');
  helpers['/.voltra/proxy-family/release.json'] = hash(raw);
  return { helpers, eggUUID: expectedUUID, startup: profile.egg.startup, release };
}
const url = ctx => '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent('/config.yml');
function field(body, path) {
  const matches = body.fields?.filter(f => f.key === path || f.key === '/' + path.replaceAll('.', '/'));
  if (matches?.length !== 1) throw Error('Waterdog exact settings field missing: ' + path);
  return matches[0];
}
async function document(ctx) {
  const body = (await h.api(url(ctx))).attributes;
  for (const [path, value] of Object.entries({ 'listener.host': '0.0.0.0:' + ctx.fixture.ports[0], 'listener.transport': 'both', 'nethernet.webrtc_port': ctx.fixture.ports[1], 'nethernet.signaling.mode': 'builtin', 'nethernet.signaling.stun_discovery': false })) {
    if (String(field(body, path).value) !== String(value)) throw Error('Waterdog native transport/signaling configuration differs: ' + path);
  }
  return body;
}
export async function prerequisites(ctx, c) {
  const source = await authority(ctx, c);
  if (ctx.game.offlineHelperImage !== helperImage) throw Error('Reviewed existing immutable readonly Python helper required');
  return { source, scope, required: false };
}
async function query(ctx) {
  const port = ctx.fixture.ports[0], nonce = randomBytes(8), magic = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex'), socket = dgram.createSocket('udp4');
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); ctx.signal.removeEventListener('abort', abort); socket.close(); error ? reject(error) : resolve(value); };
    const abort = () => finish(Error('Waterdog query aborted'));
    const timer = setTimeout(() => finish(Error('Waterdog RakNet timeout')), 5000);
    socket.on('error', () => finish(Error('Waterdog query socket error')));
    socket.on('message', (b, peer) => {
      if (peer.address !== '127.0.0.1' || peer.port !== port) return;
      try {
        if (b.length < 35 || b.length > 8192 || b[0] !== 0x1c || !b.subarray(1,9).equals(nonce) || !b.subarray(17,33).equals(magic) || b.length !== 35 + b.readUInt16BE(33)) throw Error('Invalid Waterdog native pong');
        const p = b.subarray(35).toString().split(';'), value = { edition: p[0], motd: p[1], protocol: p[2], version: p[3], players: Number(p[4]), capacity: Number(p[5]), subMotd: p[7], nonceEcho: true };
        if (value.edition !== 'MCPE' || !/^\d+$/.test(value.protocol) || !/^1\.[0-9]+\.[0-9]+$/.test(value.version) || value.players !== 0 || value.motd !== (ctx.waterdog?.edited ? 'Validator "Waterdog" $ retained' : 'Voltra WaterdogPE') || value.capacity !== (ctx.waterdog?.edited ? 7 : 20)) throw Error('Waterdog native discovery/typed consumption mismatch');
        if (ctx.waterdogNetwork && JSON.stringify(ctx.waterdogNetwork) !== JSON.stringify([value.protocol, value.version])) throw Error('Waterdog native network identity changed');
        ctx.waterdogNetwork = [value.protocol, value.version]; finish(null, value);
      } catch (e) { finish(e); }
    });
    ctx.signal.addEventListener('abort', abort, { once: true });
    socket.send(Buffer.concat([Buffer.from([1]), nonce, magic, randomBytes(8)]), port, '127.0.0.1', e => { if (e) finish(e); });
    if (ctx.signal.aborted) abort();
  });
}
// The helper shares a live PID namespace only for native process observation.
// All owned-volume mounts remain readonly; stopped containers are never exec'd.
async function probe(ctx, process = false) {
  owned(ctx); const n = await native(ctx);
  if (!n) throw Error('Waterdog owned container missing');
  const [id] = JSON.parse(await docker(['inspect', n.id], ctx.signal));
  const source = '/var/lib/voltra-parity-20261029/volumes/' + ctx.fixture.server.uuid;
  if (id.Name !== '/' + ctx.fixture.server.uuid || id.Mounts.filter(m => m.Destination === '/home/container' && m.Source === source).length !== 1 || id.Mounts.some(m => m.Destination.startsWith('/home/container/')) || process && !id.State.Running || ctx.game.offlineHelperImage !== helperImage) throw Error('Waterdog readonly probe identity mismatch');
  const program = String.raw`
import os,stat,json,hashlib,zipfile
from pathlib import Path
r=Path('/home/container');out={};total=0
for name in ['config.yml','server.jar','nethernet','plugins']:
 p=r/name
 if not p.exists():raise ValueError('Missing initialized proxy path')
 paths=[p]+(list(p.rglob('*')) if p.is_dir() else [])
 if len(paths)>10000:raise ValueError('Oversized proxy tree')
 for p in sorted(paths):
  for ancestor in [p,*p.parents]:
   if ancestor==r.parent:break
   if ancestor.is_symlink():raise ValueError('Symlink proxy path')
  s=p.lstat()
  if not(stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode)):raise ValueError('Special proxy file')
  total+=s.st_size
  if total>256*1024*1024:raise ValueError('Oversized proxy data')
  digest=None
  if p.is_file():
   h=hashlib.sha256()
   with p.open('rb') as stream:
    for block in iter(lambda:stream.read(1048576),b''):h.update(block)
   digest=h.hexdigest()
  out['/'+str(p.relative_to(r))]=dict(sha256=digest,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid)
with zipfile.ZipFile(r/'server.jar') as z:
 git=z.read('git.properties').decode()
 if 'bf72bbea0bf7ae2e95ca103d4f2ee9e23b47e101' not in git:raise ValueError('Waterdog native publisher commit mismatch')
engines=[]
if ${process ? 'True' : 'False'}:
 for p in list(Path('/proc').iterdir())[:65536]:
  if not p.name.isdigit():continue
  try:
   a=(p/'cmdline').read_bytes().split(b'\0')[:-1]
   if Path(os.readlink(p/'exe')).name!='java' or b'-jar' not in a:continue
   if a[a.index(b'-jar')+1] not in (b'server.jar',b'/home/container/server.jar'):continue
   inodes=set()
   for fd in (p/'fd').iterdir():
    try:
     link=os.readlink(fd)
     if link.startswith('socket:['):inodes.add(link[8:-1])
    except (FileNotFoundError,PermissionError):pass
   ports={}
   for protocol in ['udp','udp6','tcp','tcp6']:
    ports[protocol]=[]
    for row in (p/'net'/protocol).read_text().splitlines()[1:]:
     columns=row.split()
     if len(columns)>9 and columns[9] in inodes and (protocol.startswith('udp') or columns[3]=='0A'):ports[protocol].append(int(columns[1].rsplit(':',1)[1],16))
   engines.append(dict(pid=int(p.name),argv=[x.decode() for x in a],cwd=os.readlink(p/'cwd'),startTicks=(p/'stat').read_text().rsplit(')',1)[1].split()[19],ownedPorts=ports))
  except (FileNotFoundError,ProcessLookupError,PermissionError):pass
print(json.dumps(dict(manifest=out,engines=engines),sort_keys=True))`;
  // A named Java-image account need not exist in the Python helper image.
  // Resolve the live owned image's account to numeric IDs before sharing PID
  // visibility; same-UID process inspection does not need ptrace capabilities.
  let user;
  if (id.State.Running) {
    const uid = (await docker(['exec', id.Id, 'id', '-u'], ctx.signal, 10000)).trim(), gid = (await docker(['exec', id.Id, 'id', '-g'], ctx.signal, 10000)).trim();
    if (!/^\d+$/.test(uid) || !/^\d+$/.test(gid)) throw Error('Waterdog runtime numeric account identity unavailable');
    user = uid + ':' + gid;
    ctx.waterdogUser = { containerId: id.Id, image: id.Image, user };
  } else if (/^\d+(?::\d+)?$/.test(id.Config.User)) user = id.Config.User;
  else if (ctx.waterdogUser?.containerId === id.Id && ctx.waterdogUser.image === id.Image && /^\d+:\d+$/.test(ctx.waterdogUser.user)) user = ctx.waterdogUser.user;
  else throw Error('Stopped Waterdog image numeric account is not persisted; root must review readonly helper identity');
  const result = JSON.parse(await docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--user', user, '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--pids-limit', '32', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', ...(process ? ['--pid', 'container:' + id.Id] : []), '--mount', 'type=bind,src=' + source + ',dst=/home/container,readonly', '--entrypoint', 'python3', helperImage, '-B', '-c', program], ctx.signal, 30000));
  await ctx.artifact('waterdog-probe-' + Date.now() + '.json', result);
  if (result.manifest['/server.jar']?.sha256 !== jarSHA || !result.manifest['/nethernet/identity.pem']?.sha256) throw Error('Waterdog native JAR/private identity missing');
  return { ...result, runtimeUser: ctx.waterdogUser };
}
export async function ready(ctx, c) {
  const n = await native(ctx), s = n?.state;
  if (!s || Date.parse(s.StartedAt) < ctx.startRequestedAt) return false;
  if (!s.Running) throw Error('Waterdog exited before readiness: ' + s.ExitCode);
  if (!(await logs(ctx, s.StartedAt)).includes('Started query on ') || await c.state() !== 'running') return false;
  const source = await authority(ctx, c), config = await document(ctx), p = await probe(ctx, true), engine = p.engines[0];
  // PID1 Java is required so container exit0 is native Java exit0. A shell
  // wrapper needs separate maintained-source proof, never a relaxed assertion.
  if (p.engines.length !== 1 || engine.pid !== 1 || engine.cwd !== '/home/container' || !engine.argv.includes('-Xmx2048M') || !engine.argv.includes('-Xms128M') || !engine.argv.includes('-Dterminal.jline=false') || !engine.argv.includes('-Dterminal.ansi=false')) throw Error('Waterdog direct PID1 managed Java exit semantics unproved; root reviews runtime wrapper');
  const udp = [...engine.ownedPorts.udp, ...engine.ownedPorts.udp6], tcp = [...engine.ownedPorts.tcp, ...engine.ownedPorts.tcp6];
  // Exact b802 classes: NetherNetServerChannel.doBind binds signaling; its
  // acceptConnection creates PeerConnection.createPeer. HTTP signaling.bind
  // starts UDP discovery only with nonempty STUN servers. With STUN disabled
  // and no offers, an idle media UDP bind is not a publisher startup contract.
  // The distinct media allocation/config remain mandatory; media is untested.
  if (!udp.includes(ctx.fixture.ports[0]) || !tcp.includes(ctx.fixture.ports[0])) throw Error('Waterdog owned RakNet UDP and builtin signaling TCP binds unproved');
  const proof = { containerId: n.id, startedAt: s.StartedAt, engine, source, runtimeUser: p.runtimeUser };
  proofs.set(ctx, proof);
  const discovery = await query(ctx); await ctx.artifact('waterdog-discovery-' + Date.now() + '.json', discovery);
  const response = await fetch('http://127.0.0.1:' + ctx.fixture.ports[0] + '/v1/join', { redirect: 'error', signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(5000)]) });
  const reader = response.body.getReader(); let bytes = 0; const chunks = [];
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 65536) throw Error('Waterdog advertisement oversized'); chunks.push(value); } } finally { await reader.cancel(); }
  if (response.status !== 200) throw Error('Waterdog builtin NetherNet advertisement unavailable');
  const advertisement = { status: response.status, bytes, sha256: hash(Buffer.concat(chunks)), offerSent: false, authenticatedSession: false };
  await ctx.artifact('waterdog-nethernet-advertisement-' + Date.now() + '.json', advertisement);
  return { ...proof, discovery, advertisement, transport: { mode: field(config, 'listener.transport').value, configuredReservedMediaPort: ctx.fixture.ports[1], mediaUdpObserved: udp.includes(ctx.fixture.ports[1]), mediaScope: 'Exact publisher JAR creates peer media on accepted connections; idle media readiness/session not exercised', stunDiscoveryConfigured: false, ownedSocketBinds: engine.ownedPorts, authenticatedSession: false }, scope };
}
async function clean(ctx, c) {
  const proof = proofs.get(ctx), n = await native(ctx), s = n?.state;
  if (!proof || n.id !== proof.containerId || s.StartedAt !== proof.startedAt || s.Running || s.Dead || s.OOMKilled || s.ExitCode !== 0 || await c.state() !== 'offline' || JSON.stringify(await authority(ctx, c)) !== JSON.stringify(proof.source)) throw Error('Waterdog exact native Java stop0 unproved');
  return { ...proof, engineNumericExit: 0, engineExitProven: true };
}
async function rejected(ctx, c, body, pattern) {
  const before = await c.read('/config.yml'); let error;
  try { await h.api(url(ctx), 'PUT', body); } catch (e) { error = e; }
  if (!error || !pattern.test(error.message) || await c.read('/config.yml') !== before) throw Error('Waterdog refusal did not preserve config');
}
export async function settings(ctx, c) {
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'Waterdog settings stop'); await clean(ctx, c);
  const before = await document(ctx), motd = field(before, 'listener.motd'), capacity = field(before, 'listener.max_players');
  if (!before.revision || motd.type !== 'text' || capacity.type !== 'number' || motd.readonly || capacity.readonly || motd.read_only || capacity.read_only) throw Error('Waterdog editable MOTD/capacity authority missing');
  await rejected(ctx, c, { revision: before.revision, settings: { [capacity.key]: 'invalid' } }, /400|422|invalid/i);
  const changes = { [motd.key]: 'Validator "Waterdog" $ retained', [capacity.key]: '7' };
  await h.api(url(ctx), 'PUT', { revision: before.revision, settings: changes });
  const after = await document(ctx);
  if (!after.revision || after.revision === before.revision || field(after, 'listener.motd').value !== changes[motd.key] || String(field(after, 'listener.max_players').value) !== '7') throw Error('Waterdog typed revision/readback failed');
  await rejected(ctx, c, { revision: before.revision, settings: changes }, /409|stale|revision|conflict/i);
  ctx.waterdog = { edited: true, baseline: (await probe(ctx)).manifest };
  ctx.startRequestedAt = Date.now(); await c.power('start');
  return { changes, revision: after.revision, fresh: await wait(ctx, () => ready(ctx, c), 'Waterdog edited native discovery'), scope };
}
export function retentionPaths(ctx) { owned(ctx); return ['/config.yml', '/plugins', '/nethernet', '/server.jar', '/.voltra/limbo_install.py', '/.voltra/proxy_family_install.py', '/.voltra/proxy-family-releases.json', '/.voltra/proxy-family/release.json']; }
export function restoreContext(ctx, saved) {
  owned(ctx);
  if (saved?.fixture !== ctx.fixture.server.uuid || !saved.baseline || !saved.network || !saved.processProof?.engine || saved.engineNumericExit !== 0 || saved.engineExitProven !== true) throw Error('Waterdog retained native context missing');
  ctx.waterdog = { edited: true, baseline: saved.baseline }; ctx.waterdogNetwork = saved.network;
  if (saved.runtimeUser) ctx.waterdogUser = saved.runtimeUser;
}
export async function saved(ctx, c) {
  const processProof = await clean(ctx, c), baseline = (await probe(ctx)).manifest;
  if (!ctx.waterdog?.edited || JSON.stringify(ctx.waterdog.baseline) !== JSON.stringify(baseline)) throw Error('Waterdog config/plugin/private identity changed after native restart');
  return { fixture: ctx.fixture.server.uuid, baseline, network: ctx.waterdogNetwork, runtimeUser: ctx.waterdogUser, processProof, engineNumericExit: 0, engineExitProven: true, scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved); const fresh = await ready(ctx, c);
  if (!fresh || fresh.startedAt === saved.processProof.startedAt) throw Error('Waterdog fresh reload missing');
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'Waterdog reload stop');
  const nativeStop = await clean(ctx, c), manifest = (await probe(ctx)).manifest;
  if (JSON.stringify(manifest) !== JSON.stringify(saved.baseline)) throw Error('Waterdog retained config/plugins/identity changed');
  return { fresh, nativeStop, configPluginIdentityRetained: true, scope };
}
