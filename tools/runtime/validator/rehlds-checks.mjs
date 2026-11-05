import dgram from 'node:dgram';
import { createHash, randomUUID } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Exact CS module recipe, not hlds_server/rehlds (the Valve game).
export const registration = { rehlds: {
  recipe: 'counter_strike/counter_strike_1.6_rehlds/egg-cs 1.6-rehlds.json', ports: 2,
  environment: { SRCDS_APPID: '90', HLDS_GAME: 'cstrike', SRCDS_BETAID: 'steam_legacy', AUTO_UPDATE: '0', VOLTRA_STEAM_AUTO_UPDATE: '0', VALIDATE: '0', VERSION: 'latest', INSTALL_MODULES: 'rehlds,reunion,amxmodx,metamod-r,reapi,ReGameDLL_CS', HOSTNAME: 'Validator ReHLDS', SRCDS_MAP: 'de_dust2', SRV_SLOTS: '8', SRV_PINGBOOST: '0', SYS_TICRATE: '100', SRV_SECURE: 'insecure', PUBLIC_SERVER: '0', VAC_PORT: '0', SERVER_PASSWORD: '', RCON_PASSWORD: 'validator-rehlds-local-only' },
} };
const scope = 'Idle CS1.6 operator configuration/module retention and native reload only; no players, WAN, gameplay or survival world claim';
const markerFile = '/validator-rehlds-persistence.txt';
export const retentionRequiredPath = markerFile;
const hash = value => createHash('sha256').update(value).digest('hex');
const proofs = new WeakMap();
const startup = 'exec env VOLTRA_GOLDSRC_RECIPE=generic PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/counterstrike_preflight.py rehlds';
function supported(ctx) {
  if (ctx.game.family !== 'rehlds' || ctx.game.recipe !== registration.rehlds.recipe || ctx.fixture?.recipe !== ctx.game.recipe || ctx.fixture?.server?.uuid !== ctx.game.serverUUID || ctx.fixture.server.name !== 'validator-' + ctx.game.id || ctx.game.testStartup) throw Error('Exact owned canonical CS1.6 ReHLDS fixture required');
  const ports = ctx.fixture.ports;
  if (!Array.isArray(ports) || ports.length !== 2 || new Set(ports).size !== 2 || ports.some(p => !Number.isInteger(p) || p < 1025 || p > 65535)) throw Error('ReHLDS requires two distinct allocations');
}
async function chain(ctx, c) {
  const profile = h.profileFromRuntime(ctx.game.recipe, receipt);
  const served = (await h.api('/api/application/servers/' + ctx.fixture.server.id)).attributes;
  if (profile.egg.startup !== startup || served.container?.startup_command !== startup || served.uuid !== ctx.fixture.server.uuid || served.egg !== ctx.fixture.egg.id || profile.egg.config.stop !== 'quit') throw Error('ReHLDS canonical launch/quit authority changed');
  const hashes = {};
  for (const m of profile.egg.scripts.installation.script.matchAll(/cat > (\.voltra\/[a-z0-9_]+\.py) <<'([^']+)'\n([\s\S]*?)\n\2/g)) {
    const path = '/' + m[1], expected = hash(m[3] + '\n');
    if (hash(await c.read(path)) !== expected) throw Error('Frozen ReHLDS helper mismatch: ' + path);
    hashes[path] = expected;
  }
  for (const name of ['counterstrike_preflight', 'goldsrc_runtime', 'native_console', 'cs16_modules_install', 'steam_template']) if (!hashes['/.voltra/' + name + '.py']) throw Error('Missing frozen ReHLDS helper: ' + name);
  hashes['/hlds_run'] = hash(await c.read('/hlds_run'));
  return hashes;
}
export async function prerequisites(ctx, c) {
  supported(ctx);
  const variables = (await h.api('/api/client/servers/' + ctx.fixture.server.uuid + '/startup')).data;
  const hashes = await chain(ctx, c);
  const reset = {};
  for (const key of ['HOSTNAME', 'SRCDS_MAP', 'SRV_SLOTS']) {
    const a = variables?.find(v => v.attributes?.env_variable === key)?.attributes;
    if (!a || a.is_editable !== true) throw Error('ReHLDS startup authority unavailable: ' + key);
    const initial = registration.rehlds.environment[key];
    const edited = { HOSTNAME: 'Validator ReHLDS edited', SRCDS_MAP: 'de_dust', SRV_SLOTS: '6' }[key];
    if (a.server_value !== initial) {
      if (!ctx.previous || a.server_value !== edited || await c.state() !== 'offline') throw Error('Unexpected ReHLDS retry startup value: ' + key);
      reset[key] = { before: a.server_value, after: initial };
      await h.api('/api/client/servers/' + ctx.fixture.server.uuid + '/startup/variable', 'PUT', { key, value: initial });
    }
  }
  await ctx.artifact('rehlds-retry-startup-reset.json', reset);
  return { required: false, hashes, reset, scope };
}

// One socket for challenge and reply; fixed local owned allocation, bounded packets.
async function exchange(ctx, initial, receive) {
  ctx.signal.throwIfAborted();
  const socket = dgram.createSocket('udp4'), port = ctx.fixture.ports[0];
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); ctx.signal.removeEventListener('abort', abort); socket.close(); error ? reject(error) : resolve(value); };
    const abort = () => finish(Error('ReHLDS UDP aborted'));
    const timer = setTimeout(() => finish(Error('ReHLDS UDP timed out')), 4000);
    const send = bytes => socket.send(bytes, port, '127.0.0.1', e => { if (e) finish(Error('ReHLDS UDP send failed')); });
    socket.on('error', () => finish(Error('ReHLDS UDP socket failed')));
    socket.on('message', (data, peer) => {
      if (done || peer.address !== '127.0.0.1' || peer.port !== port) return;
      try {
        if (data.length < 5 || data.length > 32768 || data.readInt32LE(0) !== -1) throw Error('Unsupported ReHLDS UDP framing');
        const result = receive(data, send); if (result !== undefined) finish(null, result);
      } catch (e) { finish(e); }
    });
    ctx.signal.addEventListener('abort', abort, { once: true }); send(initial); if (ctx.signal.aborted) abort();
  });
}
async function query(ctx) {
  const request = Buffer.from('\xff\xff\xff\xffTSource Engine Query\0', 'latin1');
  let challenged = false;
  return exchange(ctx, request, (data, send) => {
    if (data[4] === 0x41) {
      if (challenged || data.length !== 9) throw Error('Repeated/invalid ReHLDS challenge');
      challenged = true; send(Buffer.concat([request, data.subarray(5)])); return;
    }
    if (data[4] !== 0x49) throw Error('Expected ReHLDS A2S_INFO');
    let offset = 6;
    const string = () => { const end = data.indexOf(0, offset); if (end < 0) throw Error('Truncated ReHLDS query string'); const v = data.subarray(offset, end).toString('utf8'); offset = end + 1; return v; };
    const name = string(), map = string(), folder = string(), game = string();
    if (offset + 9 > data.length) throw Error('Truncated ReHLDS query fields');
    const appId = data.readUInt16LE(offset), players = data[offset + 2], maxplayers = data[offset + 3], bots = data[offset + 4], serverType = data[offset + 5], environment = data[offset + 6], password = data[offset + 7], vac = data[offset + 8]; offset += 9;
    return { protocol: data[5], name, map, folder, game, appId, players, maxplayers, bots, serverType, environment, password, vac, version: string(), challenged };
  });
}
async function rcon(ctx, consoleCommand) {
  let challengeSent = false;
  return exchange(ctx, Buffer.from('\xff\xff\xff\xffchallenge rcon\n', 'latin1'), (data, send) => {
    const text = data.subarray(4).toString('utf8').replace(/\0+$/, '');
    if (!challengeSent) {
      const challenge = text.match(/^challenge rcon (-?\d+)\s*$/)?.[1];
      if (!challenge) throw Error('Invalid GoldSrc RCON challenge');
      challengeSent = true;
      send(Buffer.from('\xff\xff\xff\xffrcon ' + challenge + ' "' + registration.rehlds.environment.RCON_PASSWORD + '" ' + consoleCommand + '\n', 'latin1')); return;
    }
    if (data[4] !== 0x6c || /Bad rcon|Bad challenge/i.test(text)) throw Error('GoldSrc RCON authentication failed');
    return text.slice(1);
  });
}
async function readback(ctx) {
  const info = await query(ctx);
  // Capture the actual packet fields before any identity/value assertion.
  await ctx.artifact('rehlds-query-' + Date.now() + '.json', info);
  const edited = ctx.rehlds?.edited;
  if (info.protocol !== 48 || info.folder !== 'cstrike' || !/Counter-Strike/i.test(info.game) || info.appId !== 10 || info.serverType !== 100 || info.environment !== 108 || info.players !== 0 || info.bots !== 0 || info.password !== 0 || info.name !== (edited ? 'Validator ReHLDS edited' : 'Validator ReHLDS') || info.map !== (edited ? 'de_dust' : 'de_dust2') || info.maxplayers !== (edited ? 6 : 8)) throw Error('CS1.6 native query identity/name/map/slots mismatch');
  const version = await rcon(ctx, 'version');
  await ctx.artifact('rehlds-version-' + Date.now() + '.txt', version);
  if (!/Protocol version 48/.test(version) || !/ReHLDS version: 3\.14\.0\.857-dev/.test(version) || !/\(cstrike\)/.test(version)) throw Error('Exact CS1.6 ReHLDS native version missing');
  const time = await rcon(ctx, 'mp_timelimit');
  const value = time.match(/"mp_timelimit"\s+is\s+"([0-9.]+)"/)?.[1];
  await ctx.artifact('rehlds-timelimit-' + Date.now() + '.txt', time);
  if (value === undefined || ctx.rehlds?.typed && value !== '23') throw Error('ReHLDS native timelimit readback missing/mismatched');
  return { query: info, protocol: 48, rehldsVersion: '3.14.0.857-dev', timelimit: value, authenticatedRCON: true };
}

// The frozen supervisor returns its child's status unchanged. Accept container
// exit as engine exit only when hlds_run has exec'd the engine itself. A shell
// wrapper can mask an engine failure; it is never accepted as numeric proof.
async function engineProof(ctx, c, container) {
  const hashes = await chain(ctx, c);
  const script = String.raw`
import os,json,hashlib
from pathlib import Path
def args(pid):return Path('/proc',str(pid),'cmdline').read_bytes().split(b'\0')[:-1]
def parent(pid):return int(next(x.split()[1] for x in Path('/proc',str(pid),'status').read_text().splitlines() if x.startswith('PPid:')))
found=[]
for p in list(Path('/proc').iterdir())[:65536]:
 if not p.name.isdigit():continue
 try:
  pid=int(p.name)
  if os.readlink(p/'exe')!='/home/container/hlds_linux':continue
  pp=parent(pid); a=args(pid); supervisor=args(pp)
  direct=(supervisor[1:]==[b'.voltra/counterstrike_preflight.py',b'rehlds'] or supervisor[1:]==[b'/home/container/.voltra/counterstrike_preflight.py',b'rehlds']) and os.readlink(Path('/proc',str(pp),'exe'))==str(Path('/home/container/.voltra/python/bin/python3').resolve())
  found.append(dict(pid=pid,ppid=pp,startTicks=Path(p/'stat').read_text().rsplit(')',1)[1].split()[19],directSupervisor=direct,norestart=b'-norestart' in a,cstrike=b'-game' in a and a[a.index(b'-game')+1:a.index(b'-game')+2]==[b'cstrike'],noDebug=not any(x in a for x in [b'-debug',b'-debugger']),sha256=hashlib.sha256((p/'exe').read_bytes()).hexdigest()))
 except (FileNotFoundError,ProcessLookupError,PermissionError):pass
print(json.dumps(dict(engines=found)))
`;
  let result;
  try { result = JSON.parse(await docker(['exec', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', container.id, '/home/container/.voltra/python/bin/python3', '-c', script], ctx.signal, 10000)); }
  catch { throw Error('ReHLDS sanitized process probe failed'); }
  await ctx.artifact('rehlds-process-' + Date.now() + '.json', result);
  const engine = result.engines?.[0], current = await native(ctx);
  if (result.engines?.length !== 1 || !engine.directSupervisor || !engine.norestart || !engine.cstrike || !engine.noDebug || engine.sha256 !== '70ac07a3e600dabdff98c71c144a9df1929a786c5430963df8e0622b9a8d9641') throw Error('ReHLDS direct engine exit chain unproved: shell-wrapped/masked exits or binary drift require root review');
  if (!current?.state.Running || current.id !== container.id || current.state.StartedAt !== container.state.StartedAt || JSON.stringify(await chain(ctx, c)) !== JSON.stringify(hashes)) throw Error('ReHLDS process/helper identity changed during probe');
  const proof = { containerId: container.id, startedAt: container.state.StartedAt, engine, hashes };
  proofs.set(ctx, proof); return proof;
}
export async function ready(ctx, c) {
  supported(ctx);
  const container = await native(ctx), state = container?.state;
  if (!state || Date.parse(state.StartedAt) < ctx.startRequestedAt) return false;
  if (!state.Running) throw Error('ReHLDS exited before readiness: ' + state.ExitCode);
  const text = await logs(ctx, state.StartedAt);
  if (!/^VOLTRA_GOLDSRC_READY\r?$/m.test(text) || await c.state() !== 'running') return false;
  return { startedAt: state.StartedAt, native: await readback(ctx), processProof: await engineProof(ctx, c, container), scope };
}
async function cleanStop(ctx, c) {
  const container = await native(ctx), proof = proofs.get(ctx), state = container?.state;
  if (!proof || container?.id !== proof.containerId || state.StartedAt !== proof.startedAt || state.Running || state.ExitCode !== 0 || state.OOMKilled || state.Dead || await c.state() !== 'offline') throw Error('ReHLDS genuine engine exit 0 unproved');
  const text = await logs(ctx, state.StartedAt);
  if (!/^quit\r?$/m.test(text) || /Native process exited:|grace expired|escalating owned process/i.test(text)) throw Error('ReHLDS native console quit failed or escalated');
  if (JSON.stringify(await chain(ctx, c)) !== JSON.stringify(proof.hashes)) throw Error('ReHLDS stopped helper chain changed');
  return { ...proof, engineNumericExit: 0, engineExitProven: true, nativeConsoleQuit: true };
}

// Root retention hashes these trees with metadata. The adapter also takes an
// independent bounded binary manifest before/after normal restart.
export function retentionPaths(ctx) {
  supported(ctx);
  return [markerFile, '/cstrike/server.cfg', '/cstrike/banned.cfg', '/cstrike/listip.cfg', '/cstrike/liblist.gam', '/cstrike/reunion.cfg', '/cstrike/addons', '/cstrike/voltra_managed.cfg', '/cstrike/voltra_server.cfg', '/cstrike/voltra_bootstrap.cfg', ...(ctx.rehlds?.typed ? ['/cstrike/voltra_gameplay.cfg'] : [])];
}
async function operatorManifest(ctx) {
  const container = await native(ctx);
  if (!container) throw Error('ReHLDS fixture container missing');
  const script = String.raw`
import hashlib,json,stat
from pathlib import Path
r=Path('/home/container'); paths=[]
for name in ['server.cfg','banned.cfg','listip.cfg','liblist.gam','reunion.cfg']:
 paths.append(r/'cstrike'/name)
a=r/'cstrike/addons'
if a.is_symlink() or not a.is_dir():raise ValueError('Missing regular addon tree')
paths+=list(a.rglob('*'))
if len(paths)>20000:raise ValueError('Oversized addon tree')
out={};total=0
for p in sorted(paths):
 s=p.lstat()
 if stat.S_ISLNK(s.st_mode) or not (stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode)):raise ValueError('Unsupported operator entry')
 total+=s.st_size
 if total>256*1024*1024:raise ValueError('Oversized operator tree')
 # AMXX writes native runtime logs on startup. Only this observed log directory
 # is excluded from restart equality; canonical reinstall still retains it.
 if p==a/'amxmodx/logs' or a/'amxmodx/logs' in p.parents:continue
 out['/'+str(p.relative_to(r))]=dict(mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,sha256=hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None)
print(json.dumps(out,sort_keys=True))
`;
  const manifest = JSON.parse(await docker(['exec', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', container.id, '/home/container/.voltra/python/bin/python3', '-c', script], ctx.signal, 10000));
  await ctx.artifact('rehlds-operator-' + Date.now() + '.json', manifest);
  return manifest;
}
export async function settings(ctx, c) {
  supported(ctx);
  const baseline = await operatorManifest(ctx);
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'ReHLDS settings stop'); await cleanStop(ctx, c);
  ctx.rehlds = { marker: randomUUID(), edited: true, typed: false, baseline };
  await c.write(markerFile, ctx.rehlds.marker);
  const url = '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent('/cstrike/voltra_gameplay.cfg');
  // This exact module variant is not the vanilla typed-authority recipe. Read
  // its actual discovery response; missing optional fields do not block setup.
  const discovery = (await h.api('/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?inventory=all')).attributes;
  if (!Array.isArray(discovery?.documents)) throw Error('Malformed ReHLDS settings inventory');
  const documents = discovery.documents;
  let typedScope = 'No editable typed gameplay authority advertised; operator files and startup controls tested separately';
  if (Array.isArray(documents) && documents.some(d => (typeof d === 'string' ? d : d.file ?? d.path) === '/cstrike/voltra_gameplay.cfg')) {
    const before = (await h.api(url)).attributes;
    if (before.fields?.some(f => f.key === 'mp_timelimit' && f.type === 'number' && f.readonly === false)) {
      if (!before.revision) throw Error('Typed ReHLDS revision missing');
      await h.api(url, 'PUT', { revision: before.revision, settings: { mp_timelimit: '23' } });
      const after = (await h.api(url)).attributes;
      if (String(after.fields?.find(f => f.key === 'mp_timelimit')?.value) !== '23') throw Error('Typed ReHLDS readback mismatch');
      ctx.rehlds.typed = true; typedScope = 'Revisioned typed mp_timelimit edit to string 23 with native RCON reload readback';
    } else typedScope = 'Gameplay document is read-only for this exact module recipe; preserved without edits';
  }
  await ctx.artifact('rehlds-settings-authority.json', { discovery, typedScope });
  const environment = { HOSTNAME: 'Validator ReHLDS edited', SRCDS_MAP: 'de_dust', SRV_SLOTS: '6' };
  for (const [key, value] of Object.entries(environment)) await h.api('/api/client/servers/' + ctx.fixture.server.uuid + '/startup/variable', 'PUT', { key, value });
  const actual = (await h.api('/api/client/servers/' + ctx.fixture.server.uuid + '/startup')).data;
  for (const [key, value] of Object.entries(environment)) if (actual?.find(v => v.attributes?.env_variable === key)?.attributes.server_value !== value) throw Error('ReHLDS startup readback mismatch: ' + key);
  ctx.startRequestedAt = Date.now(); await c.power('start');
  const fresh = await wait(ctx, () => ready(ctx, c), 'ReHLDS edited readiness');
  const after = await operatorManifest(ctx);
  if (JSON.stringify(after) !== JSON.stringify(baseline)) {
    const changed = [...new Set([...Object.keys(baseline), ...Object.keys(after)])].filter(path => JSON.stringify(baseline[path]) !== JSON.stringify(after[path]));
    await ctx.artifact('rehlds-operator-delta.json', { before: baseline, after, changed });
    throw Error('ReHLDS operator/module tree changed: ' + changed.join(', '));
  }
  return { environment, typedScope, native: fresh, scope };
}
export function restoreContext(ctx, saved) {
  supported(ctx);
  if (!/^[a-f0-9-]{36}$/.test(saved?.marker ?? '') || typeof saved.typed !== 'boolean' || !saved.baseline || !saved.processProof?.engine || saved.engineNumericExit !== 0 || saved.engineExitProven !== true) throw Error('Missing ReHLDS retained context/engine proof');
  ctx.rehlds = { marker: saved.marker, typed: saved.typed, baseline: saved.baseline, edited: true };
}
export async function saved(ctx, c) {
  const processProof = await cleanStop(ctx, c), state = ctx.rehlds;
  if (!state?.baseline || await c.read(markerFile) !== state.marker) throw Error('ReHLDS retained marker/baseline missing');
  const hashes = {};
  for (const path of retentionPaths(ctx).filter(p => p !== '/cstrike/addons')) hashes[path] = hash(await c.read(path));
  return { marker: state.marker, typed: state.typed, baseline: state.baseline, hashes, processProof, engineNumericExit: 0, engineExitProven: true, scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  for (const [path, digest] of Object.entries(saved.hashes ?? {})) if (hash(await c.read(path)) !== digest) throw Error('ReHLDS retained file changed: ' + path);
  if (await c.read(markerFile) !== saved.marker || JSON.stringify(await operatorManifest(ctx)) !== JSON.stringify(saved.baseline)) throw Error('ReHLDS operator/module retention mismatch');
  const fresh = await ready(ctx, c);
  if (!fresh || fresh.processProof.startedAt === saved.processProof.startedAt) throw Error('ReHLDS fresh engine reload missing');
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'ReHLDS reload quit');
  return { native: fresh, nativeStop: await cleanStop(ctx, c), retainedOperatorTree: true, scope };
}
