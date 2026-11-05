import { createHash, randomUUID } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
import { Blocked } from './runner.mjs';
export { verifyBuild } from './game-checks.mjs';

// Root integration: register this family in both lifecycle and generic
// marker/hashes retention dispatch. One canonical game allocation only. RCON is
// a private container port, never an additional/published allocation.
export const registration = {
  astroneer: { recipe: 'astroneer/egg-astroneer-dedicated-server.json', ports: 1,
    environment: { AUTO_UPDATE: '0', VOLTRA_STEAM_AUTO_UPDATE: '0' } },
};
// Root admission recommendations, not Docker/server hard limits: idle peak
// 6144 MiB, disk 20480 MiB. No player or WAN claim. Wave278 cached restoration
// after Steam timeout 0x204 does not close fresh canonical reinstall retention.
const engine = '/Astro/Saved/Config/WindowsServer/Engine.ini';
const config = '/Astro/Saved/Config/WindowsServer/AstroServerSettings.ini';
const saves = '/Astro/Saved/SaveGames';
const markerFile = '/validator-astroneer-persistence.txt';
const key = '/Script/Astro.AstroServerSettings/AutoSaveGameInterval';
const notes = ['Idle native operator evidence only; no players or WAN.',
  'Root must compare offline bytes, modes and ownership across the unmodified canonical installer.',
  'Save/reload can legitimately rewrite userdata. Refresh saved() while stopped immediately before retention; do not compare an old lifecycle hash after reload.'];
export function retentionPaths() { return [markerFile, engine, config, saves]; }
export const retentionRequiredPath = config;
function owned(ctx) {
  const s = ctx.fixture?.server;
  if (!s || !/^[a-f0-9-]{36}$/.test(s.uuid) || s.uuid !== ctx.game.serverUUID ||
      s.name !== 'validator-' + ctx.game.id || ctx.game.family !== 'astroneer' ||
      ctx.fixture.recipe !== registration.astroneer.recipe || ctx.game.recipe !== registration.astroneer.recipe)
    throw Error('Exact current owned Astroneer fixture required');
  return s;
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const installerSHA256 = 'e851f9d9f2534c1bff6cf35e998a1545a70e583f5b38236a3d45bf55cc20309a';
async function authority(ctx, c) {
  const fixture = owned(ctx), profile = h.profileFromRuntime(registration.astroneer.recipe, receipt);
  const script = profile.egg.scripts.installation.script;
  if (digest(script) !== installerSHA256 || profile.egg.startup !== 'exec python3 .voltra/astroneer-parity.py'
      || profile.egg.config.stop !== 'stop' || ctx.game.testStartup) throw Error('Unreviewed Astroneer canonical source');
  const server = (await h.api('/api/application/servers/' + fixture.id)).attributes;
  if (server.uuid !== fixture.uuid || server.name !== fixture.name || server.egg !== ctx.fixture.egg.id
      || server.container?.startup_command !== profile.egg.startup) throw Error('Astroneer launch authority changed');
  const hashes = {};
  for (const m of script.matchAll(/^cat > (\.voltra\/[a-zA-Z0-9_.-]+) <<'([A-Z0-9_]+)'\r?\n([\s\S]*?)^\2\r?$/gm)) {
    if (hashes[m[1]]) throw Error('Duplicate frozen Astroneer helper');
    const sha = digest(m[3].replaceAll('\r\n', '\n'));
    if (digest(await c.read('/' + m[1])) !== sha) throw Error('Installed Astroneer helper differs: ' + m[1]);
    hashes[m[1]] = sha;
  }
  if (Object.keys(hashes).length !== 13) throw Error('Missing Astroneer frozen helper set');
  ctx.astroneer ??= {};
  ctx.astroneer.helperHashes = hashes;
  return hashes;
}
export function restoreContext(ctx, saved) {
  owned(ctx);
  if (saved?.fixture !== ctx.fixture.server.uuid || !/^[a-f0-9-]{36}$/.test(saved?.marker ?? '') ||
      !saved.nativeIdentity?.gameList?.length || !saved.nativeIdentity?.build ||
      !saved.hashes?.some(x => x.file.startsWith(saves + '/') && x.file.endsWith('.savegame')))
    throw Error('Missing retained native Astroneer save identity');
  for (const file of [markerFile, engine, config])
    if (!saved.hashes.some(x => x.file === file && /^[a-f0-9]{64}$/.test(x.sha256))) throw Error('Missing retained hash: ' + file);
  ctx.astroneer = { marker: saved.marker, nativeIdentity: saved.nativeIdentity, stoppedStartedAt: saved.nativeStop?.StartedAt };
}

// Read through the installed canonical helper, preserving its exact newline
// authentication/JSON framing, duplicate-key rejection and bounded responses.
// Password never leaves the container. No helper installation or source rewrite.
async function probe(ctx, save = false) {
  owned(ctx);
  const n = await native(ctx);
  if (!n?.state.Running) throw Error('Astroneer native container is not running');
  if (!ctx.astroneer?.helperHashes) throw Error('Astroneer helper authority not verified');
  const mappings = JSON.parse(await docker(['inspect', '--format', '{{json .NetworkSettings.Ports}}', n.id], ctx.signal)) ?? {};
  const published = Object.entries(mappings).filter(([, bindings]) => bindings?.length).map(([port]) => Number(port.split('/')[0]));
  const script = `import importlib.util,json,os,time,hashlib
from pathlib import Path
root=Path('/home/container')
for name,sha in ${JSON.stringify(ctx.astroneer.helperHashes)}.items():
 p=root/name
 assert p.is_file() and not p.is_symlink() and not p.parent.is_symlink(), 'Unsafe installed helper'
 assert hashlib.sha256(p.read_bytes()).hexdigest()==sha, 'Installed helper changed'
s=importlib.util.spec_from_file_location('astro','.voltra/astroneer-rcon.py'); a=importlib.util.module_from_spec(s); s.loader.exec_module(a)
text=Path('Astro/Saved/Config/WindowsServer/AstroServerSettings.ini').read_text(encoding='utf-8-sig')
port=int(a.scalar(text,'ConsolePort')); password=a.scalar(text,'ConsolePassword')
assert port not in ${JSON.stringify(ctx.fixture.ports)} and port not in ${JSON.stringify(published)}, 'RCON must be private'
t=a.Transport(port,password,${ctx.fixture.ports[0]})
try:
 first=t.request('DSServerStatistics'); players=t.request('DSListPlayers')
 assert a.valid_stats(first) and a.valid_players(players)
 ${save ? "t.request('DSSaveGame',response=False)" : 'pass'}
 time.sleep(2)
 second=t.request('DSServerStatistics'); games=t.request('DSListGames')
 assert a.valid_stats(second) and second['secondsInGame']>first['secondsInGame']
 assert isinstance(games.get('gameList'),list)
 launch=[]
 for p in Path('/proc').iterdir():
  if p.name.isdigit():
   try:
    args=(p/'cmdline').read_bytes().split(b'\\0')
    if len(args)>1 and args[1]==b'.voltra/astroneer-parity.py': launch.append(int(p.name))
   except OSError: pass
 assert len(launch)==1 and a.owned_udp(launch[0],${ctx.fixture.ports[0]},t.native_binary), 'No exact shipping-owned UDP'
 assert second['playersInGame']==0, 'Idle fixture required'
 print(json.dumps({'build':second['build'],'secondsBefore':first['secondsInGame'],'secondsAfter':second['secondsInGame'],'players':second['playersInGame'],'capacity':second['maxInGamePlayers'],'gameList':games['gameList'],'privatePort':port,'ownedUDP':True},allow_nan=False))
finally: t.disconnect()
`;
  // Fail closed if any Docker mapping exposes native control.
  // Docker exec inherits the owned container's configured numeric user. The
  // pinned Wine image does not define a passwd entry named "container".
  const result = JSON.parse(await docker(['exec', '--workdir', '/home/container', n.id, 'python3', '-c', script], ctx.signal));
  if (Object.entries(mappings).some(([p, bindings]) => Number(p.split('/')[0]) === result.privatePort && bindings?.length)) throw Error('Native RCON is published');
  return result;
}
async function clean(ctx, c) {
  owned(ctx);
  const state = (await native(ctx))?.state;
  if (await c.state() !== 'offline' || !state || state.Running || state.Dead || state.OOMKilled || state.ExitCode !== 0) throw Error('Astroneer canonical stop must exit 0');
  if (Number.isFinite(ctx.startRequestedAt) ? Date.parse(state.StartedAt) < ctx.startRequestedAt
      : state.StartedAt !== ctx.astroneer?.stoppedStartedAt) throw Error('Astroneer stopped process boundary is unproved');
  await authority(ctx, c);
  return state;
}
async function stop(ctx, c) {
  const since = new Date().toISOString();
  await c.power('stop');
  await wait(ctx, async () => await c.state() === 'offline', 'Astroneer canonical stop');
  const state = await clean(ctx, c), text = await logs(ctx, since);
  await ctx.artifact('astroneer-stop.log', text);
  if (!text.includes('native primary save commit confirmed by matching independent file hashes, native identity and advancing native clock') || !text.includes('native shutdown requested; awaiting actual process exit')) throw Error('Missing native canonical save/shutdown evidence');
  return state;
}
async function start(ctx, c) {
  ctx.startRequestedAt = Date.now(); await c.power('start');
  return wait(ctx, () => ready(ctx, c), 'Astroneer native readiness');
}
export async function prerequisites(ctx, c) {
  owned(ctx);
  if (await c.state() !== 'offline' || (await native(ctx))?.state.Running) throw Error('Astroneer prerequisites require offline fixture');
  if (ctx.fixture.ports?.length !== 1 || !Number.isInteger(ctx.fixture.ports[0]) || ctx.fixture.ports[0] < 1 || ctx.fixture.ports[0] > 65535) throw Error('One canonical UDP allocation required');
  const env = ctx.game.environment ?? {};
  if (!env.PUBLIC_IP || !env.OWNER_NAME || !/^\d{1,20}$/.test(env.OWNER_GUID ?? ''))
    throw new Blocked('ASTRONEER_OPERATOR_IDENTITY', 'Supply authorized Astroneer PUBLIC_IP, OWNER_NAME and original OWNER_GUID through private startup settings; preserve fixture and logs. No invented credentials.');
  if (env.AUTO_UPDATE !== '0') throw Error('Pinned Astroneer runtime required');
  await authority(ctx, c);
  ctx.astroneer = { ...ctx.astroneer, marker: randomUUID() };
  await c.write(markerFile, ctx.astroneer.marker);
  return { allocation: ctx.fixture.ports[0], rcon: 'Native private nonallocated unpublished port', notes };
}
export async function ready(ctx, c) {
  owned(ctx);
  const n = await native(ctx);
  if (!Number.isFinite(ctx.startRequestedAt)) throw Error('Missing fresh Astroneer start boundary');
  if (!n || Date.parse(n.state.StartedAt) < ctx.startRequestedAt) return false;
  const text = await logs(ctx, n.state.StartedAt);
  if (!n.state.Running) { await ctx.artifact('astroneer-startup-failure.log', text); throw Error('Astroneer exited ' + n.state.ExitCode); }
  if (!text.includes('Astroneer native server ready (authenticated RCON, advancing native clock, owned UDP)') || await c.state() !== 'running') return false;
  await authority(ctx, c);
  const actual = await probe(ctx);
  return { startedAt: n.state.StartedAt, native: actual, notes };
}
async function typed(ctx) {
  const doc = (await h.api('/api/client/servers/' + owned(ctx).uuid + '/game-settings')).attributes;
  if (String(doc.fields?.find(f => f.key === key)?.value) !== '60') throw Error('Astroneer typed autosave readback mismatch');
  return { key, value: '60', revision: doc.revision };
}
export async function settings(ctx, c) {
  await stop(ctx, c);
  const url = '/api/client/servers/' + owned(ctx).uuid + '/game-settings';
  const before = (await h.api(url)).attributes;
  await h.api(url, 'PUT', { revision: before.revision, settings: { [key]: '60' } });
  const readback = await typed(ctx);
  await start(ctx, c);
  // Wait for native autosave, not a command echo or synthetic world marker.
  const actual = await wait(ctx, async () => {
    const p = await probe(ctx);
    return p.secondsAfter >= 65 && p.gameList.length ? p : false;
  }, 'Astroneer native autosave after typed interval', 180000);
  ctx.astroneer.nativeIdentity = actual;
  return { typed: readback, nativeAutosave: actual, notes };
}
async function disk(ctx) {
  const root = '/data/volumes/' + owned(ctx).uuid;
  const output = await docker(['exec', 'voltra-validator-monitor', 'sh', '-c',
    'set -eu; cd ' + root + '; for p in Astro Astro/Saved Astro/Saved/Config Astro/Saved/Config/WindowsServer Astro/Saved/SaveGames; do test ! -L "$p"; done; find validator-astroneer-persistence.txt Astro/Saved/Config/WindowsServer/Engine.ini Astro/Saved/Config/WindowsServer/AstroServerSettings.ini Astro/Saved/SaveGames -type l -print; find validator-astroneer-persistence.txt Astro/Saved/Config/WindowsServer/Engine.ini Astro/Saved/Config/WindowsServer/AstroServerSettings.ini Astro/Saved/SaveGames -type f -exec sha256sum {} \\;'], ctx.signal);
  const hashes = output.trim().split('\n').map(line => {
    const m = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!m || /[\r\n]/.test(m[2]) || m[2].split('/').includes('..')) throw Error('Unsafe native save snapshot');
    return { file: '/' + m[2], sha256: m[1] };
  }).sort((a, b) => a.file.localeCompare(b.file));
  if (!hashes.some(x => x.file.startsWith(saves + '/') && x.file.endsWith('.savegame') && !x.file.endsWith('.backup.savegame'))) {
    await ctx.artifact('astroneer-backup-only-save-' + Date.now() + '.json', { hashes, scope: 'Backup files alone do not prove a committed native save' });
    throw Error('No committed native savegame on disk; backup-only state preserved');
  }
  return hashes;
}
export async function saved(ctx, c) {
  const state = await clean(ctx, c), a = ctx.astroneer;
  const shutdown = await logs(ctx, state.StartedAt);
  if (!shutdown.includes('native primary save commit confirmed by matching independent file hashes, native identity and advancing native clock') ||
      !shutdown.includes('native shutdown requested; awaiting actual process exit')) throw Error('Missing canonical native save/shutdown evidence');
  if (!a?.nativeIdentity?.gameList?.length || await c.read(markerFile) !== a.marker) throw Error('Missing native save-list identity or owned marker');
  return { fixture: owned(ctx).uuid, marker: a.marker, hashes: await disk(ctx), nativeIdentity: a.nativeIdentity, typed: await typed(ctx), nativeStop: state, exitCode: state.ExitCode, notes };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  if (await c.read(markerFile) !== saved.marker) throw Error('Astroneer marker changed');
  const fresh = await ready(ctx, c);
  if (!fresh) return false;
  await typed(ctx);
  const actual = fresh.native;
  await ctx.artifact('native-save-list-reload-' + Date.now() + '.json', { before: saved.nativeIdentity, after: actual, stoppedSaveFiles: saved.hashes.filter(entry => entry.file.endsWith('.savegame')) });
  // Native shutdown saves again after the running observation. Bind its new
  // date to the exact stopped save filename, preserving every other field.
  const canonical = rows => rows.map(({ date, ...row }) => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))).sort((a, b) => a.name.localeCompare(b.name));
  const before = saved.nativeIdentity.gameList;
  if (actual.build !== saved.nativeIdentity.build || JSON.stringify(canonical(actual.gameList)) !== JSON.stringify(canonical(before))
      || new Set(actual.gameList.map(row => row.name)).size !== actual.gameList.length) throw Error('Astroneer native save identity changed across reload');
  for (const row of actual.gameList) {
    const prior = before.find(entry => entry.name === row.name);
    if (!/^\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}$/.test(row.date) || row.date < prior.date
        || !saved.hashes.some(entry => entry.file === saves + '/' + row.name + '$' + row.date + '.savegame')) throw Error('Astroneer native save date does not identify the stopped save file');
  }
  const nativeStop = await stop(ctx, c);
  const current = await disk(ctx);
  ctx.astroneer.nativeIdentity = actual;
  return { native: actual, nativeStop, stoppedHashes: current, priorHashes: saved.hashes, exitCode: 0, freshStoppedBaselineRequiredForRetention: true, notes };
}
