import dgram from 'node:dgram';
import { createHash, randomUUID } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Root owns dispatch, candidate admission, canonical reinstall and closure.
export const registration = {
  ragecoop: { recipe: 'gta/ragecoop/egg-rage-c-o-o-p.json', ports: 1,
    peakMiB: 1024, installPeakMiB: 2048, diskMiB: 4096,
    environment: { VERSION:'1.5.4.7', RELEASE_SHA256:'', SERVER_NAME: 'Validator RAGECOOP', MAX_PLAYERS: '12', PUBLIC_SERVER: '0', AUTO_UPDATE: '0' } },
};
// Admission estimates, not measured publisher requirements or container limits.
const config = '/ragecoop/Settings.xml';
const markerFile = '/ragecoop/validator-custom-asset.txt';
export const retentionRequiredPath = config;
const scope = { worldSave: 'N/A: idle operator config and custom asset retention only',
  players: false, voiceMedia: false, p2p: false, gameplay: false, wan: false,
  historicalEvidence: 'wave45/wave56 and ragecoop-live-acceptance are historical, never current acceptance' };
const nativeProofs=new WeakMap();
const binarySHA='bc342ae3bb4dcc1bffb9dd303716f2f7c5d3c7c92f9c6ff0236fc798f42a961c';
const hash = x => createHash('sha256').update(x).digest('hex');
function owned(ctx) {
  const s = ctx.fixture, r = registration.ragecoop;
  if (ctx.game.family !== 'ragecoop' || ctx.game.recipe !== r.recipe || s?.recipe !== r.recipe ||
      s.name !== 'validator-' + ctx.game.id || s.server?.name !== s.name ||
      !/^[a-f0-9-]{36}$/.test(s.server?.uuid ?? '') || ctx.game.serverUUID !== s.server.uuid ||
      s.ports?.length !== 1 || !Number.isInteger(s.ports[0]) || s.ports[0] < 1 || s.ports[0] > 65535 || ctx.game.testStartup)
    throw Error('Exact owned canonical RAGECOOP fixture required');
  return s;
}
export function retentionPaths(ctx) {
  owned(ctx);
  return [config, markerFile, '/.voltra/ragecoop-install.py', '/.voltra/ragecoop-runtime.py',
    '/.voltra/ragecoop/release.json', '/ragecoop/LICENSE'];
}
const url = ctx => '/api/client/servers/' + owned(ctx).server.uuid + '/game-settings?file=' + encodeURIComponent(config);
const view = async ctx => (await h.api(url(ctx))).attributes;
function field(doc, key) {
  const matches = doc?.fields?.filter(x => x.key === key);
  if (matches?.length !== 1) throw Error('RAGECOOP typed field unavailable or ambiguous: ' + key);
  return matches[0];
}
export async function helperAuthority(ctx, c) {
  const s = owned(ctx), profile = h.profileFromRuntime(ctx.game.recipe, receipt);
  const actual = (await h.api('/api/application/servers/' + s.server.id)).attributes;
  if (actual.uuid !== s.server.uuid || actual.name !== s.name || actual.egg !== s.egg.id ||
      actual.container?.startup_command !== profile.egg.startup)
    throw Error('RAGECOOP frozen startup authority mismatch');
  if(receipt?.binary_sha256!=='f78390ea7a4ab8d11352ba1698255879ddf46794a84545a792a1249ad31e4b45' || profile.egg.config.stop!=='^SIGINT' || profile.egg.startup!=='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/ragecoop-runtime.py') throw Error('Exact sealed21 RAGECOOP authority required');
  const release=JSON.parse(await c.read('/.voltra/ragecoop/release.json'));
  if(release.version!=='1.5.4.7'||release.sha256!=='85cb91487993138f30f913ed2fe7bffbcc5c9e2f2c2b59eba91480ce1016fd8d'||release.bytes!==30391867||release.binary_sha256!==binarySHA)throw Error('RAGECOOP installed release receipt differs');
  const helpers = [];
  for (const m of profile.egg.scripts.installation.script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)) {
    if (!m[1].endsWith('.py')) continue;
    if (!/^\.voltra\/[A-Za-z0-9_-]+\.py$/.test(m[1])) throw Error('Unsafe RAGECOOP helper path');
    const expected = hash(m[3] + '\n');
    if (hash(await c.read('/' + m[1])) !== expected) throw Error('RAGECOOP canonical helper hash mismatch: ' + m[1]);
    helpers.push({ file: m[1], sha256: expected });
  }
  for (const name of ['ragecoop-runtime.py', 'ragecoop-install.py', 'gta-runtime.py', 'native-console.py'])
    if (!helpers.some(x => x.file === '.voltra/' + name)) throw Error('Frozen RAGECOOP helper authority missing: ' + name);
  return helpers;
}
export async function prerequisites(ctx) {
  const s = owned(ctx);
  return { required: false, allocation: s.ports[0], canonicalHelperRequired: true, ...scope };
}
async function publicKey(ctx) {
  const port = owned(ctx).ports[0]; ctx.signal.throwIfAborted();
  const packet = await new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4'); let done = false;
    const finish = (error, bytes) => {
      if (done) return; done = true; clearTimeout(timer);
      ctx.signal.removeEventListener('abort', abort);
      try { socket.close(); } catch { /* May fail before bind. */ }
      error ? reject(error) : resolve(bytes);
    };
    const abort = () => finish(Error('RAGECOOP UDP probe aborted'));
    const timer = setTimeout(() => finish(Error('RAGECOOP native public-key handshake timeout')), 3000);
    socket.once('error', () => finish(Error('RAGECOOP UDP socket failed')));
    socket.on('message', (bytes, peer) => {
      if (peer.address === '127.0.0.1' && peer.port === port) finish(null, bytes);
    });
    ctx.signal.addEventListener('abort', abort, { once: true });
    // Historical native Lidgren unconnected request, not a player connection.
    socket.send(Buffer.from([0, 0, 0, 8, 0, 4]), port, '127.0.0.1', error => {
      if (error) finish(Error('RAGECOOP UDP send failed'));
    });
    if (ctx.signal.aborted) abort();
  });
  if (packet.length <= 260 || packet.length > 4096 || packet[0] !== 0 || packet[5] !== 5 ||
      packet.readUInt16LE(3) !== 8 * (packet.length - 5)) throw Error('Invalid native RAGECOOP public-key frame');
  return { responseBytes: packet.length, responseSha256: hash(packet), packetType: 5, playerJoin: false };
}
async function freshLogs(ctx, n) {
  return docker(['logs', '--tail', '250', '--since', n.state.StartedAt, n.id], ctx.signal, 5000);
}
export async function ready(ctx, c) {
  owned(ctx);
  if (!Number.isFinite(ctx.startRequestedAt)) throw Error('RAGECOOP fresh start boundary required');
  const n = await native(ctx);
  if (!n || !(Date.parse(n.state.StartedAt) >= ctx.startRequestedAt)) return false;
  if (!n.state.Running) {
    if (n.state.ExitCode !== 0) throw Error('RAGECOOP native startup exited ' + n.state.ExitCode);
    return false;
  }
  const helpers = await helperAuthority(ctx, c), text = await freshLogs(ctx, n);
  if (!text.includes('Listening for clients')) return false;
  if (!text.includes('Listening port: ' + ctx.fixture.ports[0])) throw Error('Native RAGECOOP allocated port readback missing');
  // Do not persist raw native logs: they can contain keys or network credentials.
  const process=await processProof(ctx,n);
  nativeProofs.set(ctx,{containerId:n.id,startedAt:n.state.StartedAt,process});
  return { containerId: n.id, startedAt: n.state.StartedAt, helpers,process,
    nativeListener: true, logSha256: hash(text), protocol: await publicKey(ctx), ...scope };
}
async function stopped(ctx, c) {
  const n = await native(ctx);
  if (await c.state() !== 'offline' || !n || n.state.Running || n.state.ExitCode !== 0 || n.state.OOMKilled ||
      !Number.isFinite(ctx.startRequestedAt) || !(Date.parse(n.state.StartedAt) >= ctx.startRequestedAt) ||
      !(Date.parse(n.state.FinishedAt) >= Date.parse(n.state.StartedAt))) throw Error('Fresh clean RAGECOOP native exit required');
  const proof=nativeProofs.get(ctx);
  if(!proof?.process.engine?.direct||proof.containerId!==n.id||proof.startedAt!==n.state.StartedAt)throw Error('RAGECOOP observed direct native boundary missing');
  const text = await freshLogs(ctx, n);
  if(/grace expired|escalating owned process|Native process exited:/i.test(text))throw Error('RAGECOOP native exit escalated/nonzero');
  if (!/initiating.*shutdown/i.test(text)) throw Error('Native RAGECOOP graceful shutdown evidence missing');
  return { ...proof,engineExitProven:true,engineNumericExit:0,exitCode: 0, oomKilled: false, startedAt: n.state.StartedAt, finishedAt: n.state.FinishedAt, logSha256: hash(text) };
}
// This publisher exposes listener readiness and a public-key response, but neither
// independently reports WelcomeMessage/UseVoice. XML/API readback is disk evidence.
// Never accept a helper marker, echoed command, or caller-supplied assertion as
// native deserialization. Root must supply a reviewed genuine native readback
// implementation before this remaining gate can pass.
function requireNativeConsumption() {
  throw Error('RAGECOOP_NATIVE_CONSUMPTION_UNAVAILABLE: fresh UDP handshake and disk/API readbacks do not prove native WelcomeMessage/UseVoice consumption; current settings acceptance remains failed');
}
export async function settings(ctx, c) {
  await helperAuthority(ctx, c);
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline' && !(await native(ctx))?.state.Running, 'RAGECOOP settings stop');
  await stopped(ctx, c);
  const before = await view(ctx), raw = await c.read(config);
  if (typeof before.revision !== 'string' || !before.revision) throw Error('RAGECOOP authority/document revision missing');
  for (const key of ['Name', 'MaxPlayers', 'Port', 'AnnounceSelf']) {
    const f = field(before, key); if (!(f.readonly ?? f.readOnly)) throw Error('RAGECOOP startup-managed field must be readonly: ' + key);
  }
  const welcome = field(before, 'WelcomeMessage'), voice = field(before, 'UseVoice');
  if (welcome.type !== 'text' || voice.type !== 'boolean' || welcome.readonly || welcome.readOnly || voice.readonly || voice.readOnly || typeof voice.value !== 'boolean')
    throw Error('RAGECOOP editable typed controls unavailable');
  const marker = randomUUID(), changes = { WelcomeMessage: 'Validator ' + marker, UseVoice: !voice.value };
  await helperAuthority(ctx, c); await stopped(ctx, c);
  await h.api(url(ctx), 'PUT', { revision: before.revision, settings: changes });
  const after = await view(ctx), patched = await c.read(config);
  if (after.revision === before.revision || !after.revision || field(after, 'WelcomeMessage').value !== changes.WelcomeMessage || field(after, 'UseVoice').value !== changes.UseVoice)
    throw Error('RAGECOOP settings revision/readback mismatch');
  // Byte-preserving editor contract: only the two existing child-text spans change.
  const opaque = text => {
    for (const key of Object.keys(changes)) {
      const re = new RegExp('(<'+key+'>)[^<]*(</'+key+'>)', 'g');
      let count = 0; text = text.replace(re, (_m, a, b) => { count++; return a + b; });
      if (count !== 1) throw Error('RAGECOOP config span unavailable or ambiguous');
    }
    return text;
  };
  if (opaque(raw) !== opaque(patched)) throw Error('RAGECOOP unknown fields or secrets changed');
  let staleRejected = false;
  try { await h.api(url(ctx), 'PUT', { revision: before.revision, settings: changes }); }
  catch (error) { if (/409|revision|stale|conflict/i.test(String(error.message))) staleRejected = true; else throw Error('RAGECOOP stale revision probe failed unexpectedly'); }
  if (!staleRejected || hash(await c.read(config)) !== hash(patched)) throw Error('RAGECOOP stale edit was not safely rejected');
  await c.write(markerFile, marker);
  ctx.ragecoop = { marker, configSha256: hash(patched) };
  ctx.startRequestedAt = Date.now(); await c.power('start');
  const readiness = await wait(ctx, () => ready(ctx, c), 'RAGECOOP edited native restart');
  await ctx.artifact('ragecoop-settings-findings.json', { helpers: readiness.helpers, protocol: readiness.protocol,
    stoppedEdit: true, staleRejected, revisionChanged: true, opaqueFieldsPreserved: true,
    editedConfigSha256: hash(patched), nativeConfigSha256: hash(await c.read(config)), nativeConsumption: false, ...scope });
  requireNativeConsumption();
}
export function restoreContext(ctx, saved) {
  const s = owned(ctx);
  if (saved?.uuid !== s.server.uuid || saved.port !== s.ports[0] || !/^[a-f0-9-]{36}$/.test(saved.marker ?? '') ||
      !/^[a-f0-9]{64}$/.test(saved.configSha256 ?? '') || !Number.isFinite(saved.stoppedAt)) throw Error('RAGECOOP retained identity mismatch');
  const paths = retentionPaths(ctx);
  if (saved.hashes?.length !== paths.length || paths.some(file => saved.hashes.filter(x => x.file === file && /^[a-f0-9]{64}$/.test(x.sha256)).length !== 1))
    throw Error('RAGECOOP retained hashes incomplete');
  ctx.ragecoop = { marker: saved.marker, configSha256: saved.configSha256 };
}
export async function saved(ctx, c) {
  const s = owned(ctx), exit = await stopped(ctx, c); await helperAuthority(ctx, c);
  if (!ctx.ragecoop || await c.read(markerFile) !== ctx.ragecoop.marker) throw Error('Owned RAGECOOP custom asset missing');
  const hashes = [];
  for (const file of retentionPaths(ctx)) { const bytes = await c.read(file); if (!bytes.trim()) throw Error('Empty RAGECOOP retained file: ' + file); hashes.push({ file, sha256: hash(bytes) }); }
  return { uuid: s.server.uuid, port: s.ports[0], marker: ctx.ragecoop.marker,
    configSha256: hashes.find(x => x.file === config).sha256, stoppedAt: Date.parse(exit.finishedAt), hashes, exit, ...scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  if (!(ctx.startRequestedAt > saved.stoppedAt)) throw Error('RAGECOOP retained fresh restart boundary missing');
  const readiness = await ready(ctx, c); if (!readiness) throw Error('RAGECOOP retained native readiness missing');
  for (const entry of saved.hashes) if (hash(await c.read(entry.file)) !== entry.sha256) throw Error('RAGECOOP retained file changed: ' + entry.file);
  if (await c.read(markerFile) !== saved.marker) throw Error('RAGECOOP custom asset not retained');
  requireNativeConsumption();
}

async function processProof(ctx,n){
 const script=String.raw`import os,json,hashlib
from pathlib import Path
r=Path('/home/container');binary=r/'ragecoop/RageCoop.Server'
assert not binary.is_symlink() and hashlib.sha256(binary.read_bytes()).hexdigest()=='${binarySHA}','publisher executable changed'
rows=[]
for p in Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  argv=[x.decode() for x in (p/'cmdline').read_bytes().split(b'\0') if x]
  status=dict(x.split(':',1) for x in (p/'status').read_text().splitlines() if ':' in x)
  exe=os.readlink(p/'exe');cwd=os.readlink(p/'cwd')
  if exe!=str(binary):continue
  parent=Path('/proc')/status['PPid'].strip();pa=[x.decode() for x in (parent/'cmdline').read_bytes().split(b'\0') if x]
  assert argv==[str(binary)] and cwd==str(r/'ragecoop'),'native argv/cwd differs'
  assert os.readlink(parent/'exe')==str((r/'.voltra/python/bin/python3').resolve()),'private supervisor differs'
  assert len(pa)==2 and pa[0] in ['.voltra/python/bin/python3',str(r/'.voltra/python/bin/python3')] and pa[1]=='.voltra/ragecoop-runtime.py','direct launcher differs'
  assert hashlib.sha256((p/'exe').read_bytes()).hexdigest()=='${binarySHA}','actual executable differs'
  rows.append(dict(pid=int(p.name),parentPID=int(parent.name),argv=argv,cwd=cwd,direct=True,binarySHA256='${binarySHA}'))
 except (FileNotFoundError,ProcessLookupError,PermissionError):continue
assert len(rows)==1,'exactly one direct publisher process required'
print(json.dumps(dict(engine=rows[0])))`;
 return JSON.parse(await docker(['exec',n.id,'env','PYTHONHOME=/home/container/.voltra/python','LD_LIBRARY_PATH=/home/container/.voltra/python/lib','/home/container/.voltra/python/bin/python3','-B','-c',script],ctx.signal,10000));
}
