import { createHash, randomUUID } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

const recipe = 'vintage_story/egg-vintage-story.json';
export const registration = { vintagestory: { recipe, ports: 1, environment: {
  FILES_BRANCH: 'stable', RELEASE_VERSION: '1.22.7', MAX_CLIENTS: '17', OPTIONS: '',
} } };
// Admission estimates only; do not reserve/cap the game's idle memory to these values.
export const budgets = { memoryMiB: 4096, diskMiB: 8192, startupMs: 180000, stopMs: 90000 };
const file = '/data/serverconfig.json', markerFile = '/validator-vintagestory-persistence.txt';
const values = { '/ServerName': 'Validator Vintage literal $safe', '/ServerDescription': 'Owned idle native validation' };
const hash = value => createHash('sha256').update(value).digest('hex');
const pins = {
  '.voltra/vintage-story-install.py': 'cd220c3bcf19fab88169a5a207ff6581beb7e02bac0a3f190d5184b067f700d1',
  '.voltra/native_console.py': 'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5',
  '.voltra/vintage-story-runtime.py': 'd267ffdd279fe135864754c72019adbb8c7e62653c08576650718f0ab792fead',
};
const scope = 'Idle native lifecycle only; no players, world edits, client join or WAN claim. SQLite identity is initialized database path/schema, not a proven world seed.';
export const retentionRequiredPath = file;
export function retentionPaths() {
  return [markerFile, file, '/data/servermagicnumbers.json', '/data/Saves', '/data/Mods', '/data/ModConfig', '/data/Playerdata'];
}
function owned(ctx) {
  const s = ctx.fixture?.server;
  if (!s || !/^[a-f0-9-]{36}$/.test(s.uuid) || s.uuid !== ctx.game.serverUUID ||
      s.name !== 'validator-' + ctx.game.id || ctx.game.family !== 'vintagestory' ||
      ctx.fixture.recipe !== recipe || ctx.game.recipe !== recipe) throw Error('Exact owned Vintage Story fixture required');
  return s;
}
async function authority(ctx, c) {
  const s = owned(ctx), p = h.profileFromRuntime(recipe, receipt);
  if (p.egg.startup !== 'exec python3 .voltra/vintage-story-runtime.py' || p.egg.config.stop !== '/stop' || ctx.game.testStartup)
    throw Error('Unreviewed Vintage Story launch');
  const expected = pins, seen = {};
  for (const m of p.egg.scripts.installation.script.matchAll(/^cat > (\.voltra\/[\w.-]+) <<'([A-Z0-9_]+)'\r?\n([\s\S]*?)^\2\r?$/gm)) {
    if (seen[m[1]]) throw Error('Duplicate Vintage helper');
    seen[m[1]] = hash(m[3].replaceAll('\r\n', '\n'));
  }
  for (const [path, sha] of Object.entries(expected))
    if (seen[path] !== sha || hash(await c.read('/' + path)) !== sha) throw Error('Vintage helper authority differs: ' + path);
  const actual = (await h.api('/api/application/servers/' + s.id)).attributes;
  if (actual.uuid !== s.uuid || actual.egg !== ctx.fixture.egg.id || actual.name !== s.name || actual.container?.startup_command !== p.egg.startup)
    throw Error('Vintage canonical server authority changed');
  return expected;
}
export async function prerequisites(ctx, c) {
  owned(ctx);
  if (await c.state() !== 'offline' || (await native(ctx))?.state.Running) throw Error('Vintage prerequisites require offline fixture');
  for (const [k, v] of Object.entries(registration.vintagestory.environment))
    if (ctx.game.environment?.[k] !== v) throw Error('Unexpected Vintage startup setting: ' + k);
  if (ctx.fixture.ports?.length !== 1) throw Error('Vintage requires one canonical allocation');
  await authority(ctx, c);
  ctx.vintagestory = { marker: randomUUID() };
  await c.write(markerFile, ctx.vintagestory.marker);
  return { scope, helperPins: pins, budgets };
}
async function command(ctx, command, response) {
  const since = new Date().toISOString();
  await h.api('/api/client/servers/' + owned(ctx).uuid + '/command', 'POST', { command });
  return wait(ctx, async () => {
    const text = (await logs(ctx, since)).replace(/\x1b\[[0-9;]*m/g, '').replaceAll('\r', '');
    await ctx.artifact('vintagestory-' + command.split(' ').at(-1) + '.log', text);
    // Only native response lines qualify; command echo/handling never qualifies.
    return text.split('\n').some(line => line.endsWith('[Server Notification] ' + response)) && { command, response };
  }, 'Vintage native command response: ' + command, 45000);
}
async function readback(ctx) {
  const name = await command(ctx, '/serverconfig name', 'Current Server name is ' + values['/ServerName']);
  const description = await command(ctx, '/serverconfig description', 'Current Server description is ' + values['/ServerDescription']);
  // Actual pinned1.22.7 native reply observed in the owned fixture.
  const maxclients = await command(ctx, '/serverconfig maxclients', 'Current Max Clients is overridden by command line supplied max clients with a value of  17');
  return { name, description, maxclients: { ...maxclients, value: 17, source: 'native command-line precedence readback' } };
}
export async function ready(ctx, c) {
  owned(ctx);
  const n = await native(ctx);
  if (!Number.isFinite(ctx.startRequestedAt)) throw Error('Missing Vintage start boundary');
  if (!n || Date.parse(n.state.StartedAt) < ctx.startRequestedAt) return false;
  const text = await logs(ctx, n.state.StartedAt);
  if (!n.state.Running) { await ctx.artifact('vintagestory-startup-failure.log', text); throw Error('Vintage exited before readiness: ' + n.state.ExitCode); }
  if (!text.includes('Dedicated Server now running on Port ' + ctx.fixture.ports[0]) || await c.state() !== 'running') return false;
  await authority(ctx, c);
  const process = JSON.parse(await docker(['exec', n.id, 'python3', '-c', `import json,os
from pathlib import Path
rows=[]
for p in Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  args=(p/'cmdline').read_bytes().split(b'\\0')
  if len(args)>1 and args[1]==b'/home/container/.voltra/vintage-story/current/VintagestoryServer.dll':
   assert Path('/proc/'+p.name+'/exe').resolve().name=='dotnet'
   parent=int(next(x.split()[1] for x in (p/'status').read_text().splitlines() if x.startswith('PPid:')))
   parentargs=(Path('/proc')/str(parent)/'cmdline').read_bytes().split(b'\\0')
   assert len(parentargs)>1 and parentargs[1]==b'.voltra/vintage-story-runtime.py','native parent is not canonical wrapper'
   assert b'--maxclients=17' in args and b'--port=${ctx.fixture.ports[0]}' in args
   rows.append(int(p.name))
 except FileNotFoundError:pass
assert len(rows)==1,'exact native dotnet process missing'
print(json.dumps({'pid':rows[0],'nativeDotnet':True,'maxclientsArg':17}))`], ctx.signal));
  ctx.vintagestory = { ...ctx.vintagestory, processContainerId: n.id, processStartedAt: n.state.StartedAt, process, restoredStop: undefined };
  await ctx.artifact('vintagestory-startup.log', text);
  return { startedAt: n.state.StartedAt, nativeReady: true, scope };
}
async function clean(ctx, c) {
  const n = await native(ctx), state = n?.state;
  if (await c.state() !== 'offline' || !state || state.Running || state.Dead || state.OOMKilled || state.ExitCode !== 0 ||
      !Number.isFinite(ctx.startRequestedAt) || Date.parse(state.StartedAt) < ctx.startRequestedAt) throw Error('Vintage fresh native clean stop missing');
  const text = await logs(ctx, state.StartedAt);
  await ctx.artifact('vintagestory-stop.log', text);
  if (ctx.vintagestory?.processStartedAt !== state.StartedAt || ctx.vintagestory.processContainerId !== n.id || !ctx.vintagestory.process?.nativeDotnet) throw Error('Vintage native process stop boundary missing');
  if (ctx.vintagestory.restoredStop && JSON.stringify(state) !== JSON.stringify(ctx.vintagestory.restoredStop)) throw Error('Vintage restored stopped state differs from persisted original observation');
  // Exact pinned direct supervisor returns child status; zero is silent.
  // A fresh observed native process plus container exit0 is the status proof.
  await authority(ctx, c);
  return state;
}
async function stop(ctx, c) {
  await c.power('stop');
  await wait(ctx, async () => await c.state() === 'offline', 'Vintage stop', budgets.stopMs);
  return clean(ctx, c);
}
async function typed(ctx) {
  const doc = (await h.api('/api/client/servers/' + owned(ctx).uuid + '/game-settings?file=' + encodeURIComponent(file))).attributes;
  for (const [key, value] of Object.entries(values))
    if (doc.fields?.find(f => f.key === key)?.value !== value) throw Error('Vintage typed readback mismatch: ' + key);
  return { file, values, revision: doc.revision };
}
export async function settings(ctx, c) {
  await stop(ctx, c);
  const url = '/api/client/servers/' + owned(ctx).uuid + '/game-settings';
  const before = (await h.api(url + '?file=' + encodeURIComponent(file))).attributes;
  await h.api(url, 'PUT', { file, revision: before.revision, settings: values });
  const result = await typed(ctx);
  ctx.startRequestedAt = Date.now(); await c.power('start');
  await wait(ctx, () => ready(ctx, c), 'Vintage edited readiness', budgets.startupMs);
  return { typed: result, native: await readback(ctx), scope };
}

// Read only the verified stopped mount in a root-reviewed, already present helper.
// Never open a live SQLite database, discard WAL, or force a checkpoint.
async function snapshot(ctx) {
  const s = owned(ctx), [container] = JSON.parse(await docker(['inspect', s.uuid], ctx.signal));
  const source = '/var/lib/voltra-parity-20261029/volumes/' + s.uuid;
  if (container.Name !== '/' + s.uuid || container.State.Running || container.State.ExitCode !== 0 || container.State.OOMKilled ||
      container.Mounts.filter(m => m.Destination === '/home/container' && m.Type === 'bind' && m.Source === source).length !== 1 ||
      container.Mounts.some(m => m.Destination.startsWith('/home/container/'))) throw Error('Vintage snapshot owned mount mismatch');
  const image = ctx.game.offlineHelperImage;
  if (image !== 'sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8') throw Error('Root-reviewed immutable Python SQLite helper image required');
  await docker(['exec', 'voltra-validator-monitor', 'sh', '-ec', 'for p in /data /data/volumes /data/volumes/' + s.uuid + '; do test -d "$p" && test ! -L "$p" || exit 1; done'], ctx.signal);
  const program = String.raw`import os,stat,json,hashlib,sqlite3
from pathlib import Path
r=Path('/source')
def digest(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def observe():
 rows=[]
 for base in ['validator-vintagestory-persistence.txt','data/serverconfig.json','data/servermagicnumbers.json','data/Saves','data/Mods','data/ModConfig','data/Playerdata']:
  p=r/base
  for ancestor in [p,*p.parents]:
   if ancestor==r:break
   assert not ancestor.is_symlink(),'symlink ancestor'
  if not p.exists():continue
  entries=[p,*p.rglob('*')] if p.is_dir() else [p]
  for f in entries:
   assert not f.is_symlink(),'symlink retained entry'
   st=f.stat()
   assert stat.S_ISREG(st.st_mode) or stat.S_ISDIR(st.st_mode),'special retained entry'
   if f.is_file():rows.append(dict(file='/'+str(f.relative_to(r)),sha256=digest(f),bytes=st.st_size,mode=stat.S_IMODE(st.st_mode),uid=st.st_uid,gid=st.st_gid))
 return sorted(rows,key=lambda x:x['file'])
before=observe();p=r/'data/Saves/default.vcdbs'
assert p.is_file() and p.stat().st_size>=4096,'missing initialized native save'
assert not Path(str(p)+'-wal').exists() or Path(str(p)+'-wal').stat().st_size==0,'nonempty WAL: preserve for root'
c=sqlite3.connect('file:'+str(p)+'?mode=ro&immutable=1',uri=True)
assert c.execute('pragma quick_check').fetchall()==[('ok',)],'SQLite integrity'
schema=c.execute('select type,name,tbl_name,sql from sqlite_master order by type,name,tbl_name,sql').fetchall()
tables=[x[0] for x in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")]
assert set(tables)=={'chunk','mapchunk','mapregion','gamedata','playerdata'},'unexpected native1.22.7 schema'
counts=[c.execute('select count(*) from "'+t.replace('"','""')+'"').fetchone()[0] for t in tables]
by_table=dict(zip(tables,counts))
assert by_table['gamedata']==1 and by_table['playerdata']==0 and all(by_table[k]>0 for k in ['chunk','mapchunk','mapregion']),'native world initialization or idle boundary missing'
assert sum(counts)>0,'empty native database'
c.close();after=observe();assert before==after,'stopped snapshot changed'
print(json.dumps(dict(hashes=before,database='/data/Saves/default.vcdbs',quickCheck='ok',tables=len(tables),rows=sum(counts),schemaSHA256=hashlib.sha256(json.dumps(schema,separators=(',',':')).encode()).hexdigest())))`;
  const helper = 'validator-vintage-snapshot-' + randomUUID();
  // Root must preserve/clean this exact name on a Docker CLI interruption.
  await ctx.artifact('vintagestory-snapshot-helper.json', { helper, source, image });
  const result = JSON.parse(await docker(['run', '--rm', '--pull=never', '--name', helper, '--network', 'none', '--read-only', '--memory', '256m', '--cpus', '1', '--pids-limit', '32', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--mount', 'type=bind,src=' + source + ',dst=/source,readonly', '--entrypoint', 'python3', image, '-c', program], ctx.signal, 60000));
  const [after] = JSON.parse(await docker(['inspect', s.uuid], ctx.signal));
  if (after.Id !== container.Id || after.State.Running || after.State.StartedAt !== container.State.StartedAt || after.State.FinishedAt !== container.State.FinishedAt) throw Error('Vintage snapshot process boundary changed');
  return result;
}
export async function saved(ctx, c) {
  const state = await clean(ctx, c);
  if (!ctx.vintagestory?.marker || await c.read(markerFile) !== ctx.vintagestory.marker) throw Error('Vintage fixture marker changed');
  await authority(ctx, c);
  const disk = await snapshot(ctx);
  await ctx.artifact('vintagestory-offline-snapshot.json', disk);
  return { fixture: owned(ctx).uuid, marker: ctx.vintagestory.marker, ...disk, nativeStop: state, nativeProcessProof: processEvidence(ctx), typed: await typed(ctx), scope };
}
function processEvidence(ctx) {
  const v = ctx.vintagestory;
  if (!v?.process?.nativeDotnet || !Number.isInteger(v.process.pid) || v.process.pid < 1 || !/^[a-f0-9]{64}$/.test(v.processContainerId ?? '') || !Number.isFinite(ctx.startRequestedAt) || !Number.isFinite(Date.parse(v.processStartedAt)) || Date.parse(v.processStartedAt) < ctx.startRequestedAt) throw Error('Vintage observed native process evidence missing');
  return { fixture: owned(ctx).uuid, containerId: v.processContainerId, startedAt: v.processStartedAt, startRequestedAt: ctx.startRequestedAt, process: v.process };
}
export function restoreContext(ctx, saved) {
  if (saved.fixture !== owned(ctx).uuid || !/^[a-f0-9-]{36}$/.test(saved.marker ?? '') || !/^[a-f0-9]{64}$/.test(saved.schemaSHA256 ?? '')) throw Error('Vintage saved identity missing');
  ctx.vintagestory = { ...ctx.vintagestory, marker: saved.marker };
  // A new runner may adopt only the exact stopped observation persisted by the
  // prior native run. Never manufacture a fresh request boundary with Date.now.
  if (!ctx.vintagestory.processStartedAt) {
    const p = saved.nativeProcessProof, s = saved.nativeStop;
    if (p?.fixture !== saved.fixture || !/^[a-f0-9]{64}$/.test(p.containerId ?? '') || !Number.isFinite(p.startRequestedAt) || !Number.isFinite(Date.parse(p.startedAt)) || Date.parse(p.startedAt) < p.startRequestedAt || !p.process?.nativeDotnet || !Number.isInteger(p.process.pid) || p.process.pid < 1
      || !s || s.Status !== 'exited' || s.Running !== false || s.Dead !== false || s.OOMKilled !== false || s.ExitCode !== 0 || s.Pid !== 0 || s.StartedAt !== p.startedAt || !Number.isFinite(Date.parse(s.FinishedAt)) || Date.parse(s.FinishedAt) < Date.parse(s.StartedAt)) throw Error('Vintage original stopped native process evidence missing');
    // Keep an already requested new start boundary intact. ready() will observe
    // its process and replace this restored context before loaded() accepts it.
    if (!Number.isFinite(ctx.startRequestedAt)) ctx.startRequestedAt = p.startRequestedAt;
    ctx.vintagestory = { ...ctx.vintagestory, processContainerId: p.containerId, processStartedAt: p.startedAt, process: p.process, restoredStop: s };
  }
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  if (await c.read(markerFile) !== saved.marker) throw Error('Vintage fixture marker changed on reload');
  await wait(ctx, () => ready(ctx, c), 'Vintage retained reload', budgets.startupMs);
  await typed(ctx);
  const read = await readback(ctx);
  const nativeStop = await stop(ctx, c), nativeProcessProof = processEvidence(ctx);
  const disk = await snapshot(ctx);
  await ctx.artifact('vintagestory-reload-snapshot.json', disk);
  if (disk.database !== saved.database || disk.schemaSHA256 !== saved.schemaSHA256) throw Error('Vintage initialized save schema changed on reload');
  await ctx.artifact('vintagestory-reload-evidence.json', { native: read, disk, nativeStop, nativeProcessProof, sameInitializedSaveSchema: true, freshStoppedBaselineRequiredForRetention: true, scope });
  return { native: read, disk, nativeStop, nativeProcessProof, sameInitializedSaveSchema: true, freshStoppedBaselineRequiredForRetention: true, scope };
}
