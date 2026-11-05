import { createHash, randomUUID } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Historical .NET 10 acceptance used older helpers and injected player/scenario
// state. It is research only. Every assertion below needs a fresh owned fixture.
export const registration = {
  ksp_dmp: { recipe: 'ksp/DMP/egg-k-s-p-d-m-p.json', ports: 2, environment: { SERVERNAME: 'Validator DMP', MAX_PLAYERS: '4', GAMEMODE: 'CAREER', DIFFICULTY: 'NORMAL', WARPMODE: 'SUBSPACE', MODPACKMODE: 'NONE', WHITELIST: 'False', PUBLIC_LISTING: '0' } },
  ksp_lmp: { recipe: 'ksp/LMP/egg-k-s-p--l-m-p.json', ports: 1, environment: { SERVER_NAME: 'Validator LMP', MaxPlayers: '4', GameMode: 'Career', GameDifficulty: 'Normal', LMP_VERSION: '0.29.2', PUBLIC_LISTING: '0', PASSWORD: '', ADMIN_PASSWORD: '' } },
};
const pins = { dmp: 'c26b7c8ebf40d5bc9b30f97d42d6ef21b50ccccd36085f2c2ae1786ce3ea24de', lmp: '0d91d264312c5b291c6eb499d339636ab0c67ec47ca81116986d2fbd9db601c2' };
const scope = 'Idle native HTTP/operator settings and initialized Universe/config retention only. No player joins, player/scenario/group injection, gameplay, WAN or world persistence claim. External UUID is fixture identity only.';
const markerFile = '/validator-ksp-identity.txt';
export const retentionRequiredPath = markerFile;
const digest = value => createHash('sha256').update(value).digest('hex');
const proofs = new WeakMap();
function variant(ctx) {
  const game = Object.keys(pins).find(g => ctx.game.recipe === registration['ksp_' + g].recipe);
  if (!game || ctx.game.family !== 'ksp_' + game || ctx.fixture?.recipe !== ctx.game.recipe || ctx.fixture?.server?.uuid !== ctx.game.serverUUID || ctx.fixture.server.name !== 'validator-' + ctx.game.id || ctx.game.testStartup) throw Error('Exact owned canonical KSP fixture required');
  const ports = ctx.fixture.ports;
  if (!Array.isArray(ports) || ports.length !== (game === 'dmp' ? 2 : 1) || new Set(ports).size !== ports.length || ports.some(p => !Number.isInteger(p) || p < 1025 || p > 65535)) throw Error('KSP allocation shape mismatch');
  return game;
}
const binary = game => game === 'dmp' ? '/DMPServer.dll' : '/LMPServer/Server.dll';
const config = game => game === 'dmp' ? '/Config' : '/LMPServer/Config';
const universe = game => game === 'dmp' ? '/Universe' : '/LMPServer/Universe';
const document = game => game === 'dmp' ? '/Config/Settings.txt' : '/LMPServer/Config/GeneralSettings.xml';
async function chain(ctx, c) {
  const game = variant(ctx), profile = h.profileFromRuntime(ctx.game.recipe, receipt);
  const startup = 'exec python3 .voltra/ksp_runtime.py ' + game;
  const served = (await h.api('/api/application/servers/' + ctx.fixture.server.id)).attributes;
  if (profile.egg.startup !== startup || served.container?.startup_command !== startup || served.uuid !== ctx.fixture.server.uuid || served.egg !== ctx.fixture.egg.id) throw Error('KSP launch authority changed');
  const hashes = {};
  for (const m of profile.egg.scripts.installation.script.matchAll(/cat > (\.voltra\/[a-z0-9_]+\.py) <<'([^']+)'\n([\s\S]*?)\n\2/g)) {
    const path = '/' + m[1], expected = digest(m[3] + '\n');
    if (digest(await c.read(path)) !== expected) throw Error('KSP frozen helper differs: ' + path);
    hashes[path] = expected;
  }
  if (hashes['/.voltra/ksp_runtime.py'] !== pins[game] || !hashes['/.voltra/native_console.py'] || !hashes['/.voltra/native_config.py'] || !hashes['/.voltra/ksp_install.py']) throw Error('KSP exact embedded helper chain missing');
  const releasePath = '/.voltra/ksp/' + game + '-release.json', raw = await c.read(releasePath), release = JSON.parse(raw);
  if (release.game !== game || release.runtime !== 'Microsoft.NETCore.App10' || release.modified_binary !== true || release.version !== (game === 'dmp' ? '0.3.8.5' : '0.29.2') || release.source_commit !== (game === 'dmp' ? '8253dc8e4f40e4519c085c3ee223abecd1a52954' : '60a2ed5dbfdddc08536a98b999c781e3c12b0649') || !/^[a-f0-9]{64}$/.test(release.binary_sha256)) throw Error('KSP current source receipt mismatch');
  hashes[releasePath] = digest(raw);
  if (game === 'dmp' && release.dependency_commits?.['External/SettingsParser'] !== '0a1c1e1666bf94a9069acf1967e64d2679dc27a2') throw Error('DMP parser source pin changed');
  return { hashes, release };
}
async function probe(ctx, process = false) {
  const game = variant(ctx), container = await native(ctx);
  if (!container) throw Error('KSP owned container missing');
  const script = String.raw`
import os,json,stat,hashlib
from pathlib import Path
r=Path('/home/container');game=${JSON.stringify(game)}
def safe(p):
 if not p.is_relative_to(r):raise ValueError('Outside owned volume')
 for q in [p,*p.parents]:
  if q==r.parent:break
  if q.is_symlink():raise ValueError('Symlink in owned path')
 return p
out={};total=0
for name in ${JSON.stringify([config(game), universe(game), binary(game), '/.voltra/ksp_runtime.py', '/.voltra/native_config.py', '/.voltra/native_console.py', '/.voltra/ksp/' + game + '-release.json']).replaceAll('"/', '"')}:
 p=safe(r/name)
 if not p.exists():raise ValueError('Missing initialized native path')
 paths=[p]+(list(p.rglob('*')) if p.is_dir() else [])
 if len(paths)>20000:raise ValueError('Oversized native tree')
 for p in sorted(paths):
  safe(p);s=p.lstat()
  if not (stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode)):raise ValueError('Unsupported native entry')
  total+=s.st_size
  if total>256*1024*1024:raise ValueError('Oversized native bytes')
  out['/'+str(p.relative_to(r))]=dict(mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,sha256=hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None)
engines=[]
if ${process ? 'True' : 'False'}:
 for p in list(Path('/proc').iterdir())[:65536]:
  if not p.name.isdigit():continue
  try:
   a=(p/'cmdline').read_bytes().split(b'\0')[:-1];target=str(r/${JSON.stringify(binary(game).slice(1))}).encode()
   if target not in a or Path(os.readlink(p/'exe')).name!='dotnet':continue
   pp=int(next(x.split()[1] for x in (p/'status').read_text().splitlines() if x.startswith('PPid:')))
   parent=Path('/proc',str(pp));pa=(parent/'cmdline').read_bytes().split(b'\0')[:-1]
   engines.append(dict(pid=int(p.name),ppid=pp,startTicks=(p/'stat').read_text().rsplit(')',1)[1].split()[19],direct=pa[1:]==[b'.voltra/ksp_runtime.py',game.encode()] and Path(os.readlink(parent/'exe')).name.startswith('python'),cwd=os.readlink(p/'cwd')))
  except (FileNotFoundError,ProcessLookupError,PermissionError):pass
print(json.dumps(dict(manifest=out,engines=engines),sort_keys=True))
`;
  let result;
  if (container.state.Running) result = JSON.parse(await docker(['exec', container.id, 'python3', '-c', script], ctx.signal, 15000));
  else {
    if (process) throw Error('Cannot inspect a stopped native process');
    const [identity] = JSON.parse(await docker(['inspect', container.id], ctx.signal));
    const uuid = ctx.fixture.server.uuid, source = '/var/lib/voltra-parity-20261029/volumes/' + uuid;
    if (identity.Name !== '/' + uuid || identity.State.Running || identity.Mounts.filter(m => m.Destination === '/home/container' && m.Source === source).length !== 1
      || identity.Mounts.some(m => m.Destination.startsWith('/home/container/')) || !/^sha256:[a-f0-9]{64}$/.test(identity.Image)) throw Error('Stopped KSP volume identity mismatch');
    result = JSON.parse(await docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--user', identity.Config.User,
      '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--mount', 'type=bind,src=' + source + ',dst=/home/container,readonly', '--entrypoint', 'python3', identity.Image, '-B', '-c', script], ctx.signal, 30000));
  }
  await ctx.artifact('ksp-probe-' + Date.now() + '.json', result);
  return result;
}
export async function prerequisites(ctx, c) {
  const game = variant(ctx), source = await chain(ctx, c);
  const server = (await h.api('/api/application/servers/' + ctx.fixture.server.id)).attributes;
  const environment = server.container?.environment;
  if (game === 'lmp' && environment?.PUBLIC_LISTING !== '0') throw Error('LMP must disable native master registration');
  if (game === 'dmp' && environment?.STATUS_PORT !== String(ctx.fixture.ports[1])) throw Error('DMP requires its separate allocated HTTP STATUS_PORT');
  return { required: false, source, scope };
}
async function query(ctx) {
  const game = variant(ctx), port = ctx.fixture.ports[game === 'dmp' ? 1 : 0];
  const response = await fetch('http://127.0.0.1:' + port + '/', { signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(5000)]), redirect: 'error' });
  if (!response.ok) throw Error('KSP native HTTP status ' + response.status);
  const reader = response.body.getReader(); let bytes = 0, chunks = [];
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 1048576) throw Error('KSP status oversized'); chunks.push(value); } } finally { await reader.cancel(); }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8')), edited = !!ctx.ksp?.edited;
  const name = 'Validator ' + game.toUpperCase() + (edited ? ' edited' : '');
  if (game === 'dmp') {
    if (data.server_name !== name || data.max_players !== (edited ? 3 : 4) || data.port !== ctx.fixture.ports[0] || data.protocol_version !== 54 || data.player_count !== 0 || data.game_mode !== 'CAREER' || data.warp_mode !== 'SUBSPACE' || edited && data.cheats !== false) throw Error('DMP native settings/idle readback mismatch');
  } else {
    const state = data[0], general = state?.GeneralSettings;
    if (!general || general.ServerName !== name || general.MaxPlayers !== (edited ? 3 : 4) || general.GameMode !== 'Career' || general.GameDifficulty !== 'Normal' || state.ServerConnectionSettings?.Port !== port || state.ServerConnectionSettings.Upnp !== false || state.ServerWebsiteSettings?.Port !== port || state.ServerMasterServerSettings?.RegisterWithMasterServer !== false || !Array.isArray(state.CurrentState?.CurrentPlayers) || state.CurrentState.CurrentPlayers.length || edited && general.Cheats !== false) throw Error('LMP native settings/private/idle readback mismatch');
  }
  await ctx.artifact('ksp-http-' + Date.now() + '.json', data);
  return data;
}
export async function ready(ctx, c) {
  const game = variant(ctx), container = await native(ctx), state = container?.state;
  if (!state || Date.parse(state.StartedAt) < ctx.startRequestedAt) return false;
  if (!state.Running) throw Error('KSP exited before readiness: ' + state.ExitCode);
  if (!(await logs(ctx, state.StartedAt)).includes(game === 'dmp' ? 'Ready!' : 'All systems up and running') || await c.state() !== 'running') return false;
  const source = await chain(ctx, c), process = await probe(ctx, true), engine = process.engines?.[0];
  if (process.engines.length !== 1 || !engine.direct || engine.cwd !== '/home/container' + (game === 'lmp' ? '/LMPServer' : '') || process.manifest[binary(game)]?.sha256 !== source.release.binary_sha256) throw Error('KSP direct engine/launcher chain unproved');
  const proof = { containerId: container.id, startedAt: state.StartedAt, engine, source };
  proofs.set(ctx, proof);
  return { startedAt: state.StartedAt, processProof: proof, native: await query(ctx), scope };
}
async function cleanStop(ctx, c) {
  const proof = proofs.get(ctx), container = await native(ctx), state = container?.state;
  if (!proof || container.id !== proof.containerId || state.StartedAt !== proof.startedAt || state.Running || state.ExitCode !== 0 || state.OOMKilled || state.Dead || await c.state() !== 'offline') throw Error('KSP fresh native engine exit 0 unproved');
  const text = await logs(ctx, state.StartedAt);
  if (/grace expired|escalating owned process|Native process exited: [1-9]/i.test(text) || JSON.stringify(await chain(ctx, c)) !== JSON.stringify(proof.source)) throw Error('KSP helper drift or forced shutdown');
  return { ...proof, engineNumericExit: 0, engineExitProven: true };
}
const settingsURL = ctx => '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent(document(variant(ctx)));
async function rejected(ctx, c, body, expected) {
  const before = await c.read(document(variant(ctx))); let failure;
  try { await h.api(settingsURL(ctx), 'PUT', body); } catch (e) { failure = e; }
  const after = await c.read(document(variant(ctx)));
  if (!failure || !expected.test(String(failure.message)) || before !== after) throw Error('KSP invalid/stale edit did not fail unchanged');
}
export async function settings(ctx, c) {
  const game = variant(ctx);
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'KSP settings stop'); await cleanStop(ctx, c);
  const before = (await h.api(settingsURL(ctx))).attributes;
  const changes = game === 'dmp' ? { serverName: 'Validator DMP edited', maxPlayers: '3', cheats: false } : { ServerName: 'Validator LMP edited', MaxPlayers: '3', Cheats: false };
  if (!before.revision) throw Error('KSP typed revision missing');
  for (const [key, type] of Object.entries(game === 'dmp' ? { serverName: 'text', maxPlayers: 'number', cheats: 'boolean' } : { ServerName: 'text', MaxPlayers: 'number', Cheats: 'boolean' })) if (!before.fields?.some(f => f.key === key && f.type === type && f.readonly === false)) throw Error('KSP editable typed field missing: ' + key);
  await rejected(ctx, c, { revision: before.revision, settings: { [game === 'dmp' ? 'cheats' : 'Cheats']: 'FALSE' } }, /400|422|Invalid|invalid/);
  await h.api(settingsURL(ctx), 'PUT', { revision: before.revision, settings: changes });
  const after = (await h.api(settingsURL(ctx))).attributes;
  if (!after.revision || after.revision === before.revision) throw Error('KSP revision did not change');
  for (const [key, value] of Object.entries(changes)) if (after.fields?.find(f => f.key === key)?.value !== value) throw Error('KSP typed string readback mismatch');
  await rejected(ctx, c, { revision: before.revision, settings: changes }, /409|revision|stale|conflict/i);
  ctx.ksp = { marker: randomUUID(), edited: true };
  await c.write(markerFile, ctx.ksp.marker);
  ctx.ksp.baseline = (await probe(ctx)).manifest;
  ctx.startRequestedAt = Date.now(); await c.power('start');
  const fresh = await wait(ctx, () => ready(ctx, c), 'KSP edited native readiness');
  await compare(ctx, ctx.ksp.baseline, (await probe(ctx)).manifest);
  return { changes, revision: after.revision, fresh, scope };
}
async function compare(ctx, before, after) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => JSON.stringify(before[p]) !== JSON.stringify(after[p]));
  await ctx.artifact('ksp-retention-delta-' + Date.now() + '.json', { before, after, changed });
  throw Error('KSP initialized native/config identity changed: ' + changed.join(', '));
}
export function retentionPaths(ctx) {
  const game = variant(ctx);
  return [markerFile, config(game), universe(game), binary(game), '/.voltra/ksp/' + game + '-release.json', '/.voltra/ksp_runtime.py', '/.voltra/native_config.py', '/.voltra/native_console.py'];
}
export function restoreContext(ctx, saved) {
  const game = variant(ctx);
  if (!/^[a-f0-9-]{36}$/.test(saved?.marker ?? '') || !saved.baseline || !saved.hashes || !saved.processProof?.engine || saved.engineNumericExit !== 0 || saved.engineExitProven !== true) throw Error('KSP retained native context missing');
  const allowed = retentionPaths(ctx).filter(p => ![config(game), universe(game), binary(game)].includes(p));
  if (Object.keys(saved.hashes).length !== allowed.length || allowed.some(p => !/^[a-f0-9]{64}$/.test(saved.hashes[p] ?? ''))) throw Error('KSP retained path/hash set mismatch');
  ctx.ksp = { marker: saved.marker, baseline: saved.baseline, edited: true };
}
export async function saved(ctx, c) {
  const processProof = await cleanStop(ctx, c), state = ctx.ksp;
  if (!state?.baseline || await c.read(markerFile) !== state.marker) throw Error('KSP fixture identity missing');
  await compare(ctx, state.baseline, (await probe(ctx)).manifest);
  const hashes = {};
  for (const path of retentionPaths(ctx).filter(p => ![config(variant(ctx)), universe(variant(ctx)), binary(variant(ctx))].includes(p))) hashes[path] = digest(await c.read(path));
  return { marker: state.marker, baseline: state.baseline, hashes, processProof, engineNumericExit: 0, engineExitProven: true, scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  for (const [path, hash] of Object.entries(saved.hashes)) if (digest(await c.read(path)) !== hash) throw Error('KSP retained helper/config changed: ' + path);
  await compare(ctx, saved.baseline, (await probe(ctx)).manifest);
  const fresh = await ready(ctx, c);
  if (!fresh || fresh.processProof.startedAt === saved.processProof.startedAt) throw Error('KSP fresh native reload missing');
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'KSP reload stop');
  const stop = await cleanStop(ctx, c);
  await compare(ctx, saved.baseline, (await probe(ctx)).manifest);
  return { fresh, stop, initializedNativeArtifactsRetained: true, scope };
}
