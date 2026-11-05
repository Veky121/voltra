import { createHash, randomUUID } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait, command } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

const recipe = 'rising_world/legacy/egg-rising-world-legacy.json';
export const registration = { 'rising-legacy': { recipe, ports: 7, environment: {
  SRCDS_BETAID: 'java', AUTO_UPDATE: '0',
  SERVER_NAME: 'Validator Rising Java', MAX_PLAYERS: '6', LD_LIBRARY_PATH: './linux64',
} } };
export const budgets = { memoryMiB: 3072, diskMiB: 8192, startupMs: 240000, stopMs: 90000 };
export const rconSource = { file: 'tools/game-query/RisingWorldRcon.java', sha256: 'e7f8bf2705f49c7bbe7d5240bdf7f443c94c7728c033127c0e6f8026070d55e9' };
const editedSettings = { server_name: 'Validator Rising typed $safe', settings_max_players: '7' };
const markerFile = '/validator-rising-legacy-persistence.txt';
const sha = x => createHash('sha256').update(x).digest('hex');
const pins = {
  '.voltra/steam_template.py': '7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897',
  '.voltra/bundle_debian_python.py': '16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0',
  '.voltra/native_config.py': '8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2',
  '.voltra/native_console.py': 'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5',
  '.voltra/java_games_runtime.py': 'eeb230d77ba00d6bd566859acb505d8bb84ff65ec0561793336b83c31aee3925',
  '.voltra/java_games_install.py': '7d9bc8c64b8eae88e1cabbc3ed65f90bb0d4e09577d00a95789b4796c0fbfb3c',
};
const scope = 'Fresh isolated idle Java legacy fixture. No node202 access, players, gameplay or WAN. Typed properties require actual A2S and publisher RCON consumption before success.';
export const retentionRequiredPath = '/server.properties';
export function retentionPaths() { return [markerFile, '/server.properties', '/Worlds', '/plugins']; }
function owned(ctx) {
  const s = ctx.fixture?.server;
  if (!s || !/^[a-f0-9-]{36}$/.test(s.uuid) || s.uuid !== ctx.game.serverUUID || s.name !== 'validator-' + ctx.game.id ||
    ctx.game.family !== 'rising-legacy' || ctx.fixture.recipe !== recipe || ctx.game.recipe !== recipe) throw Error('Exact isolated Rising legacy fixture required');
  return s;
}
async function authority(ctx, c) {
  const s = owned(ctx), p = h.profileFromRuntime(recipe, receipt);
  const actual = (await h.api('/api/application/servers/' + s.id)).attributes;
  if (actual.node === 202 || actual.uuid !== s.uuid || actual.egg !== ctx.fixture.egg.id || actual.name !== s.name ||
    actual.container?.startup_command !== p.egg.startup || ctx.game.testStartup || p.egg.config.stop !== 'shutdown') throw Error('Rising canonical launch/node authority mismatch');
  const found = {};
  for (const m of p.egg.scripts.installation.script.matchAll(/^cat > (\.voltra\/[\w.-]+) <<'([A-Z0-9_]+)'\r?\n([\s\S]*?)^\2\r?$/gm)) {
    if (found[m[1]]) throw Error('Duplicate Rising helper');
    found[m[1]] = sha(m[3].replaceAll('\r\n', '\n'));
  }
  for (const [path, hash] of Object.entries(pins))
    if (found[path] !== hash || sha(await c.read('/' + path)) !== hash) throw Error('Rising helper mismatch: ' + path);
  return p;
}
function ports(ctx) {
  const all = ctx.fixture.ports, primary = ctx.fixture.allocation?.port ?? ctx.game.risingPrimaryPort;
  if (!Array.isArray(all) || all.length !== 7 || new Set(all).size !== 7 || !Number.isInteger(primary) ||
    primary < 2 || primary > 65531 || all.some(x => !Number.isInteger(x) || x < 1 || x > 65535) ||
    !Array.from({ length: 6 }, (_, i) => primary - 1 + i).every(x => all.includes(x))) throw Error('Canonical gameplay-1..gameplay+4 and separate RCON allocations required');
  return { primary, rcon: all.find(x => x < primary - 1 || x > primary + 4) };
}
async function execPython(ctx, program) {
  const n = await native(ctx);
  if (!n?.state.Running) throw Error('Rising probe requires running owned native container');
  return JSON.parse(await docker(['exec', '--workdir', '/home/container', n.id, '.voltra/python/bin/python3', '-c', program], ctx.signal, 45000));
}
export async function prerequisites(ctx, c) {
  owned(ctx); ports(ctx); await authority(ctx, c);
  if (await c.state() !== 'offline' || (await native(ctx))?.state.Running) throw Error('Rising prerequisites require offline fixture');
  const observer = ctx.game.risingRconObserver;
  if (!observer || observer.sourceSHA256 !== rconSource.sha256 || !/^[a-f0-9]{64}$/.test(observer.classSHA256 ?? '') ||
    !observer.publisherJars || !Object.keys(observer.publisherJars).length) throw Error('Root must compile reviewed RisingWorldRcon.java against exact installed publisher jars and provide source/class/jar hashes; no adapter download or compile');
  for (const [path, hash] of Object.entries(observer.publisherJars))
    if (!/^lib\/[A-Za-z0-9_.-]+\.jar$/.test(path) || !/^[a-f0-9]{64}$/.test(hash)) throw Error('Invalid reviewed publisher jar identity');
  ctx.risingLegacy = { marker: randomUUID() };
  await c.write(markerFile, ctx.risingLegacy.marker);
  return { ports: ports(ctx), scope, rconObserver: 'Root-prepared .voltra/validator-rcon/RisingWorldRcon.class; password stays inside container', budgets };
}
async function probe(ctx) {
  const { primary, rcon } = ports(ctx), observer = ctx.game.risingRconObserver;
  if (!observer) throw Error('RCON observer identity absent');
  return execPython(ctx, `import json,os,hashlib,socket,struct,subprocess,secrets
from pathlib import Path
r=Path('/home/container')
def safe(p):
 for a in [p,*p.parents]:
  if a==r:break
  assert not a.is_symlink(),'symlink in observer authority'
 assert p.is_file()
def digest(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
for path,want in ${JSON.stringify(pins)}.items():
 p=r/path;safe(p);assert digest(p)==want,'canonical helper changed'
jar=r/'server.jar';safe(jar);assert digest(jar)=='b0d507b90b80846d5bdac97a146e2486b0b2b290d82e205e854debdd7235f5d4','unreviewed publisher properties schema'
cl=r/'.voltra/validator-rcon/RisingWorldRcon.class';safe(cl)
assert digest(cl)==${JSON.stringify(observer.classSHA256)},'RCON observer changed'
assert {str(p.relative_to(r)) for p in (r/'lib').glob('*.jar')}==set(${JSON.stringify(observer.publisherJars)}),'publisher classpath set changed'
for path,want in ${JSON.stringify(observer.publisherJars)}.items():
 p=r/path;safe(p);assert digest(p)==want,'publisher jar changed'
native=[]
for p in Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  args=(p/'cmdline').read_bytes().split(b'\\0')
  if b'/home/container/server.jar' in args and b'-jar' in args:
   assert (p/'exe').resolve()==(r/'.voltra/java8/bin/java').resolve(),'native Java executable differs'
   assert b'+serverport=${primary}' in args and b'+rconport=${rcon}' in args
   assert b'-Xmx2048M' in args,'reviewed unlimited-memory fallback heap differs'
   parent=int(next(x.split()[1] for x in (p/'status').read_text().splitlines() if x.startswith('PPid:')))
   parentargs=(Path('/proc')/str(parent)/'cmdline').read_bytes().split(b'\\0')
   assert b'.voltra/java_games_runtime.py' in parentargs and b'rising-world-java' in parentargs
   native.append(int(p.name))
 except FileNotFoundError:pass
assert len(native)==1,'native Java process missing'
# Historical accepted probe consumes ordinary password values. Refuse escaped
# syntax rather than guess Java Properties decoding or risk sending wrong data.
config=r/'server.properties';safe(config);entries={}
for line in config.read_text().splitlines():
 if not line.strip() or line.lstrip().startswith(('#','!')):continue
 if '=' not in line:continue
 k,v=line.split('=',1);k=k.strip()
 if k in ('rcon_password','rcon_enabled'):
  assert k not in entries and '\\\\' not in v,'ambiguous private RCON property';entries[k]=v.strip()
assert entries.get('rcon_enabled')=='true' and len(entries.get('rcon_password',''))>=6
java=r/'.voltra/java8/bin/java'
version=subprocess.run([str(java),'-version'],capture_output=True,timeout=10)
assert version.returncode==0 and b'1.8.0_' in version.stderr,'Java8 required'
def auth(password):
 result=subprocess.run([str(java),'-cp','.voltra/validator-rcon:lib/*','RisingWorldRcon','127.0.0.1','${rcon}'],input=password+'\\n',text=True,capture_output=True,timeout=18)
 assert result.returncode==0,'publisher RCON probe failed; private output withheld'
 rows=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{"authenticated":')]
 assert len(rows)==1,'publisher RCON result missing'
 return rows[0]
positive=auth(entries['rcon_password']);negative=auth(secrets.token_hex(24))
assert positive.get('authenticated') is True and negative=={'authenticated':False}
with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as sock:
 sock.settimeout(4);sock.connect(('127.0.0.1',${primary}))
 request=b'\\xff\\xff\\xff\\xffTSource Engine Query\\0';sock.send(request);data=sock.recv(65536)
 if data[:5]==b'\\xff\\xff\\xff\\xffA':
  assert len(data)==9;sock.send(request+data[5:]);data=sock.recv(65536)
 assert data[:5]==b'\\xff\\xff\\xff\\xffI','unexpected A2S packet';at=6
 def text():
  global at
  end=data.index(0,at);value=data[at:end].decode('utf-8');at=end+1;return value
 name=text();world=text();folder=text();game=text();appid=struct.unpack_from('<H',data,at)[0];at+=2
 players,maximum,bots=struct.unpack_from('BBB',data,at);at+=7;version=text()
 assert players==0 and bots==0 and maximum==positive['maxplayers'] and name and world
print(json.dumps({'nativePID':native[0],'java8':True,'name':name,'world':world,'maxplayers':maximum,'players':players,'bots':bots,'version':version,'rconAuthenticated':True,'rconWrongPasswordRejected':True,'responseSHA256':hashlib.sha256(data).hexdigest()}))`);
}
export async function ready(ctx, c) {
  owned(ctx);
  if (!Number.isFinite(ctx.startRequestedAt)) throw Error('Missing fresh Rising start boundary');
  const n = await native(ctx);
  if (!n || Date.parse(n.state.StartedAt) < ctx.startRequestedAt) return false;
  const text = await logs(ctx, n.state.StartedAt);
  if (!n.state.Running) throw Error('Rising native startup exited ' + n.state.ExitCode);
  if (await c.state() !== 'running' || !text.includes('Steam Query Server bind to ANY (' + ports(ctx).primary + ')')) return false;
  await authority(ctx, c);
  const result = await probe(ctx);
  ctx.risingLegacy = { ...ctx.risingLegacy, processStartedAt: n.state.StartedAt, protocol: result };
  return { startedAt: n.state.StartedAt, native: result, scope };
}
async function clean(ctx, c) {
  const state = (await native(ctx))?.state;
  if (await c.state() !== 'offline' || !state || state.Running || state.Dead || state.OOMKilled || state.ExitCode !== 0 ||
    state.StartedAt !== ctx.risingLegacy?.processStartedAt) throw Error('Rising observed native process did not stop cleanly');
  const text = await logs(ctx, state.StartedAt);
  const markers = ['SAVE ALL', 'SHUTDOWN NOW!', 'STEAM SERVER SHUTDOWN', 'DatabaseTaskManager stopped!', 'EXIT'];
  if (!markers.every(x => text.includes(x))) throw Error('Missing publisher save/shutdown markers');
  await authority(ctx, c);
  return { ...state, markers };
}
async function stop(ctx, c) {
  await command(ctx, 'saveall', /^SAVE ALL\r?$/m);
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'Rising shutdown', budgets.stopMs);
  return clean(ctx, c);
}
async function typed(ctx) {
  const url = '/api/client/servers/' + owned(ctx).uuid + '/game-settings?file=' + encodeURIComponent('/server.properties');
  const doc = (await h.api(url)).attributes;
  for (const [key, expected] of Object.entries(editedSettings)) {
    const fields = doc.fields?.filter(f => f.key === key);
    if (fields?.length !== 1 || String(fields[0].value) !== expected || fields[0].readonly === true) throw Error('Rising typed property readback mismatch: ' + key);
  }
  return { file: '/server.properties', values: editedSettings, revision: doc.revision };
}
function nativeSettings(result) {
  if (result.name !== editedSettings.server_name || result.maxplayers !== Number(editedSettings.settings_max_players) ||
      !result.rconAuthenticated || !result.rconWrongPasswordRejected) throw Error('Rising native A2S/publisher RCON did not consume typed properties');
  return result;
}
export async function settings(ctx, c) {
  await stop(ctx, c);
  const url = '/api/client/servers/' + owned(ctx).uuid + '/game-settings';
  const before = (await h.api(url + '?file=' + encodeURIComponent('/server.properties'))).attributes;
  for (const [key, type] of [['server_name', 'text'], ['settings_max_players', 'number']]) {
    const fields = before.fields?.filter(f => f.key === key);
    if (fields?.length !== 1 || fields[0].type !== type || fields[0].readonly === true)
      throw Error('Missing authoritative writable publisher property ' + key + '; preserve actual properties for root review');
  }
  await h.api(url, 'PUT', { file: '/server.properties', revision: before.revision, settings: editedSettings });
  const readback = await typed(ctx);
  ctx.startRequestedAt = Date.now(); await c.power('start');
  await wait(ctx, () => ready(ctx, c), 'Rising typed properties native reload', budgets.startupMs);
  const actual = nativeSettings(ctx.risingLegacy.protocol);
  await command(ctx, 'saveall', /^SAVE ALL\r?$/m);
  await ctx.artifact('rising-legacy-typed-native.json', { typed: readback, native: actual });
  return { typed: readback, native: actual, scope };
}
async function snapshot(ctx) {
  const uuid = owned(ctx).uuid, source = '/var/lib/voltra-parity-20261029/volumes/' + uuid;
  const [before] = JSON.parse(await docker(['inspect', uuid], ctx.signal));
  if (before.Name !== '/' + uuid || before.State.Running || before.State.ExitCode !== 0 || before.State.OOMKilled || before.State.Dead ||
    before.Mounts.filter(m => m.Destination === '/home/container' && m.Type === 'bind' && m.Source === source).length !== 1 ||
    before.Mounts.some(m => m.Destination.startsWith('/home/container/'))) throw Error('Stopped Rising snapshot volume identity failed');
  const image = ctx.game.offlineHelperImage;
  if (image !== 'sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8') throw Error('Reviewed cached Python SQLite helper required');
  await docker(['exec', 'voltra-validator-monitor', 'sh', '-ec', 'for p in /data /data/volumes /data/volumes/' + uuid + '; do test -d "$p" && test ! -L "$p" || exit 1; done'], ctx.signal);
  const program = String.raw`import json,hashlib,sqlite3,stat
from pathlib import Path
r=Path('/source')
def safe(p):
 for a in [p,*p.parents]:
  if a==r:break
  assert not a.is_symlink(),'symlink refused'
def digest(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def observe():
 rows=[]
 for base in ['validator-rising-legacy-persistence.txt','server.properties','Worlds','plugins']:
  p=r/base;safe(p)
  if not p.exists():continue
  for f in ([p,*p.rglob('*')] if p.is_dir() else [p]):
   safe(f);s=f.stat();assert stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode)
   if f.is_file():rows.append(dict(file='/'+str(f.relative_to(r)),sha256=digest(f),bytes=s.st_size,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid))
 return sorted(rows,key=lambda x:x['file'])
before=observe();worlds=[]
def q(name):return '"'+name.replace('"','""')+'"'
for p in (r/'Worlds').glob('*/*.db'):
 safe(p)
 assert not Path(str(p)+'-journal').exists() or Path(str(p)+'-journal').stat().st_size==0,'nonempty rollback journal preserved'
 assert not Path(str(p)+'-wal').exists() or Path(str(p)+'-wal').stat().st_size==0,'nonempty WAL preserved; no checkpoint'
 c=sqlite3.connect('file:'+str(p)+'?mode=ro&immutable=1',uri=True)
 assert c.execute('pragma quick_check').fetchall()==[('ok',)]
 schema=c.execute('select type,name,tbl_name,sql from sqlite_master order by type,name,tbl_name,sql').fetchall();matches=[]
 for (table,) in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'"):
  cols=[row[1] for row in c.execute('pragma table_info('+q(table)+')')]
  # Publisher WorldInfos includes an ID column beside its Key/Value pair.
  # Admit this observed exact schema, retaining legacy two-column support.
  pairs=[cols,cols[::-1]] if len(cols)==2 else [('Key','Value')] if table=='WorldInfos' and cols==['ID','Key','Value'] else []
  for key,value in pairs:
   rows=c.execute('select '+q(key)+','+q(value)+' from '+q(table)+' where '+q(key)+' in (?,?)',('Creationdate','Seed')).fetchall()
   if len(rows)==2 and {x[0] for x in rows}=={'Creationdate','Seed'}:
    identity=dict(rows)
    assert all(isinstance(v,(str,int)) and str(v).lstrip('-').isdigit() for v in identity.values()),'unexpected native identity'
    matches.append(identity)
 c.close()
 if matches:
  assert len(matches)==1,'ambiguous native identity table'
  worlds.append(dict(database='/'+str(p.relative_to(r)),identity=matches[0],schemaSHA256=hashlib.sha256(json.dumps(schema,separators=(',',':')).encode()).hexdigest(),quickCheck='ok'))
assert len(worlds)==1,'cannot derive unique actual world Creationdate/Seed; inspect publisher schema without injecting rows'
assert before==observe(),'offline database family changed'
print(json.dumps(dict(hashes=before,world=worlds[0])))`;
  const helper = 'validator-rising-snapshot-' + randomUUID();
  await ctx.artifact('rising-legacy-snapshot-helper.json', { helper, image, source });
  const result = JSON.parse(await docker(['run', '--rm', '--pull=never', '--name', helper, '--network', 'none', '--read-only', '--memory', '256m', '--cpus', '1', '--pids-limit', '32', '--user', '0:0', '--cap-drop', 'ALL', '--cap-add', 'DAC_READ_SEARCH', '--security-opt', 'no-new-privileges', '--mount', 'type=bind,src=' + source + ',dst=/source,readonly', '--entrypoint', 'python3', image, '-c', program], ctx.signal, 60000));
  const [after] = JSON.parse(await docker(['inspect', uuid], ctx.signal));
  if (before.Id !== after.Id || after.State.Running || before.State.StartedAt !== after.State.StartedAt || before.State.FinishedAt !== after.State.FinishedAt) throw Error('Rising process changed during offline snapshot');
  return result;
}
export async function saved(ctx, c) {
  const state = await clean(ctx, c);
  if (!ctx.risingLegacy?.marker || await c.read(markerFile) !== ctx.risingLegacy.marker) throw Error('Rising fixture marker missing');
  const disk = await snapshot(ctx);
  await ctx.artifact('rising-legacy-offline-snapshot.json', disk);
  return { fixture: owned(ctx).uuid, marker: ctx.risingLegacy.marker, ...disk, nativeStop: state, protocol: nativeSettings(ctx.risingLegacy.protocol), typed: await typed(ctx), scope };
}
export function restoreContext(ctx, saved) {
  if (saved.fixture !== owned(ctx).uuid || !/^[a-f0-9-]{36}$/.test(saved.marker ?? '') || !saved.world?.identity?.Creationdate || !saved.world?.identity?.Seed) throw Error('Missing Rising actual saved identity');
  if (JSON.stringify(saved.typed?.values) !== JSON.stringify(editedSettings)) throw Error('Missing proven typed Rising save baseline');
  ctx.risingLegacy = { ...ctx.risingLegacy, marker: saved.marker };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  if (await c.read(markerFile) !== saved.marker) throw Error('Rising marker changed');
  await wait(ctx, () => ready(ctx, c), 'Rising retained native reload', budgets.startupMs);
  const current = nativeSettings(ctx.risingLegacy.protocol);
  await typed(ctx);
  if (current.world !== saved.protocol.world || current.name !== saved.protocol.name || current.maxplayers !== saved.protocol.maxplayers) throw Error('Rising native configuration changed on reload');
  await stop(ctx, c);
  const disk = await snapshot(ctx);
  await ctx.artifact('rising-legacy-reload-snapshot.json', disk);
  if (JSON.stringify(disk.world) !== JSON.stringify(saved.world)) throw Error('Rising world Creationdate/Seed/schema changed on reload');
  return { native: current, world: disk.world, stoppedHashes: disk.hashes, nativeExitCode: 0, typed: await typed(ctx), freshStoppedBaselineRequiredForRetention: true, scope };
}
