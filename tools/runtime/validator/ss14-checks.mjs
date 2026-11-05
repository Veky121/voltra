import { randomUUID } from 'node:crypto';
import { campaign as h, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

export const registration = {
  ss14: { recipe: 'spacestation_14/egg-spacestation14.json', ports: 1, environment: { SERVER_NAME: 'Validator SS14', SERVER_TICK: '30', SERVER_MAX_PLAYERS: '8', PUBLIC_SERVER: '0' } },
};
const config = '/ss14/server_config.toml';
const database = '/ss14/data/preferences.db';
const markerFile = '/validator-ss14-persistence.txt';
const values = { 'game/hostname': 'Validator SS14 retained', 'net/tickrate': '25', 'game/soft_max_players': '10', 'net/max_connections': '10' };
const scope = 'Idle native operator checks only. No authenticated preference mutation, connected-player capacity enforcement, round gameplay, persistent world save or WAN claim.';
const plain = text => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
function owned(ctx) {
  const s = ctx.fixture?.server;
  if (ctx.game.family !== 'ss14' || ctx.game.recipe !== registration.ss14.recipe || ctx.fixture?.recipe !== registration.ss14.recipe || !s || !/^[a-f0-9-]{36}$/.test(s.uuid) || s.uuid !== ctx.game.serverUUID || s.name !== 'validator-' + ctx.game.id) throw Error('Exact owned SS14 fixture required');
  return s;
}
export function retentionPaths(ctx) {
  owned(ctx);
  return [config, database, markerFile];
}
export function restoreContext(ctx, saved) {
  owned(ctx);
  if (saved?.fixture !== ctx.fixture.server.uuid || !/^[a-f0-9-]{36}$/.test(saved?.marker ?? '') || !Array.isArray(saved.hashes) || saved.hashes.length !== retentionPaths(ctx).length) throw Error('Invalid retained SS14 identity');
  for (const file of retentionPaths(ctx)) {
    const rows = saved.hashes.filter(x => x.file === file);
    if (rows.length !== 1 || !/^[a-f0-9]{64}$/.test(rows[0].sha256) || !Number.isSafeInteger(rows[0].bytes) || rows[0].bytes <= 0) throw Error('Invalid SS14 checksum array');
  }
  validatePreferences(saved.preferences);
  ctx.ss14 = { marker: saved.marker, fixture: saved.fixture, preferences: saved.preferences };
}
export async function prerequisites(ctx) {
  owned(ctx);
  if (!Array.isArray(ctx.fixture.ports) || ctx.fixture.ports.length !== 1 || !Number.isInteger(ctx.fixture.ports[0]) || ctx.fixture.ports[0] < 1 || ctx.fixture.ports[0] > 65535) throw Error('SS14 requires one owned HTTP/game allocation');
  return { required: false, port: ctx.fixture.ports[0], scope };
}
async function protocol(ctx) {
  owned(ctx);
  const responses = {};
  for (const route of ['status', 'info']) {
    const r = await fetch('http://127.0.0.1:' + ctx.fixture.ports[0] + '/' + route, { signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(5000)]), redirect: 'error' });
    if (!r.ok) throw Error('SS14 /' + route + ' HTTP ' + r.status);
    const body = await r.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Invalid SS14 protocol object');
    responses[route] = body;
  }
  const { status, info } = responses;
  if (typeof status.name !== 'string' || !Number.isInteger(status.players) || status.players < 0 || info.auth?.mode !== 'Required' || typeof info.build?.version !== 'string' || !info.build.version || !/^[a-f0-9]{64}$/i.test(info.build.hash ?? '')) throw Error('SS14 native protocol identity missing');
  // Whitelist public scalar evidence. Never retain auth keys, URLs or raw responses.
  return { status: { name: status.name, players: status.players, soft_max_players: status.soft_max_players, tickrate: status.tickrate, max_connections: status.max_connections }, info: { authMode: info.auth.mode, version: info.build.version, clientSHA256: info.build.hash.toLowerCase() } };
}
export async function ready(ctx, c) {
  owned(ctx);
  const process = await native(ctx);
  if (!process?.state.Running) {
    if (process && Date.parse(process.state.StartedAt) >= ctx.startRequestedAt && process.state.ExitCode !== 0) throw Error('Native SS14 startup exited ' + process.state.ExitCode);
    return false;
  }
  if (!Number.isFinite(ctx.startRequestedAt) || Date.parse(process.state.StartedAt) < ctx.startRequestedAt) return false;
  const text = plain(await logs(ctx));
  const line = text.split('\n').find(x => /root: Server Version \S+ -> Ready\s*$/.test(x));
  if (!line) return false;
  await c.state();
  return { startedAt: process.state.StartedAt, nativeReady: line.trim(), protocol: await protocol(ctx), scope };
}
async function clean(ctx, c) {
  owned(ctx);
  const state = (await native(ctx))?.state;
  const text = plain(await logs(ctx));
  if (await c.state() !== 'offline' || !state || state.Running || state.OOMKilled || state.ExitCode !== 0 || !/srv: VoltraStop, shutting down\.\.\./.test(text) || !/root: Goodbye\./.test(text) || !/^VOLTRA_SS14_EXIT 0\s*$/m.test(text)) throw Error('SS14 clean native shutdown markers missing');
  return { exitCode: state.ExitCode, goodbye: true, nativeExitMarker: true };
}
async function tickrate(ctx) {
  const since = new Date().toISOString();
  await h.api('/api/client/servers/' + owned(ctx).uuid + '/command', 'POST', { command: 'cvar net.tickrate' });
  return wait(ctx, async () => {
    const text = plain(await logs(ctx, since));
    if (/Unknown command|Invalid argument|Unknown CVar|not found/i.test(text)) throw Error('SS14 native cvar query rejected');
    // An echoed command, startup TickRate line, or terminal prompt cannot satisfy this.
    const reply = text.split('\n').filter(x => !x.includes('>') && !/^\s*cvar net\.tickrate\s*$/.test(x)).find(x => /(?:^|\s)["']?net\.tickrate["']?\s*(?:=|:|is)\s*["']?25(?:["']|\s|$)/.test(x));
    if (reply || /^\s*25\s*$/m.test(text)) await ctx.artifact('ss14-native-tickrate.log', text);
    return (reply || /^\s*25\s*$/m.test(text)) ? { command: 'cvar net.tickrate', value: 25, nativeValueResponse: true } : false;
  }, 'SS14 native tickrate value response (echo is insufficient)', 45000);
}
async function readback(ctx) {
  const result = await protocol(ctx);
  if (result.status.name !== values['game/hostname'] || result.status.soft_max_players !== 10) throw Error('SS14 HTTP hostname/capacity mismatch');
  for (const [key, expected] of [['tickrate', 25], ['max_connections', 10]]) if (result.status[key] !== undefined && result.status[key] !== expected) throw Error('SS14 HTTP ' + key + ' mismatch');
  const text = plain(await logs(ctx));
  if (!/srv: TickRate: 25\(40\.00ms\)/.test(text) || !/srv: Max players: 10\s*$/m.test(text) || !/cfg: Configuration loaded from file/.test(text)) throw Error('SS14 native configuration consumption missing');
  return { protocol: result, tickrate: await tickrate(ctx), nativeConfigLoaded: true, maxConnections: result.status.max_connections === undefined ? 'Not exposed by HTTP; typed config retained, enforcement unproved' : 10, scope };
}
// Only observe SQLite after clean shutdown. Never emit schema names or row content.
async function preferences(ctx, phase) {
  const uuid = owned(ctx).uuid;
  const helper = 'validator-ss14-snapshot-' + uuid + '-' + randomUUID();
  const token = randomUUID();
  const evidence = { phase, fixture: uuid, helper, ok: false };
  let attempted = false;
  const inspectStopped = async () => {
    const [container] = JSON.parse(await docker(['inspect', uuid], ctx.signal));
    const source = '/var/lib/voltra-parity-20261029/volumes/' + uuid;
    const mounts = container?.Mounts?.filter(m => m.Destination === '/home/container');
    if (container?.Name !== '/' + uuid || container.State?.Running || container.State?.Paused || container.State?.Restarting || container.State?.Status !== 'exited' || container.State?.ExitCode !== 0 || container.State?.OOMKilled || !/^sha256:[a-f0-9]{64}$/.test(container.Image ?? '') || mounts?.length !== 1 || mounts[0].Type !== 'bind' || mounts[0].Source !== source || container.Mounts.some(m => m.Destination.startsWith('/home/container/'))) throw Error('SS14 stopped container/image/exact owned mount verification failed');
    // The monitor exposes the same owned volume root. Reject symlinked
    // fixture ancestors before Docker resolves the host bind source.
    await docker(['exec', 'voltra-validator-monitor', 'sh', '-ec', 'for p in /data /data/volumes /data/volumes/' + uuid + '; do test -d "$p" && test ! -L "$p" || exit 1; done'], ctx.signal, 10000);
    return { id: container.Id, image: container.Image, source };
  };
  const script = String.raw`import sqlite3,json,os,stat,hashlib
root='/home/container'
p=root+'/ss14/data/preferences.db'
e={'ok':False}
def digest(b): return hashlib.sha256(b).hexdigest()
def safe(path):
    current='/'
    for part in path.strip('/').split('/'):
        current=os.path.join(current,part)
        if os.path.islink(current): raise ValueError('symlink rejected')
def observe(path):
    safe(path)
    try:
        st=os.lstat(path)
    except FileNotFoundError: return {'present':False,'bytes':0,'sha256':None}
    if not stat.S_ISREG(st.st_mode): raise ValueError('nonregular SQLite file')
    with open(path,'rb') as f:
        h=hashlib.sha256()
        for block in iter(lambda:f.read(1048576),b''): h.update(block)
    return {'present':True,'bytes':st.st_size,'sha256':h.hexdigest()}
def files(): return {'database':observe(p),'wal':observe(p+'-wal')}
c=None
try:
    safe(root+'/.voltra/python/bin/python3')
    e['before']=files()
    if not e['before']['database']['present'] or e['before']['database']['bytes']<=0: raise ValueError('missing database')
    if e['before']['wal']['bytes']>0: raise ValueError('nonempty WAL rejected; no checkpoint attempted')
    c=sqlite3.connect('file:'+p+'?mode=ro&immutable=1',uri=True,timeout=5)
    if c.execute('PRAGMA quick_check').fetchall()!=[('ok',)]: raise ValueError('quick_check failed')
    e['quickCheck']='ok'
    schema=c.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name,tbl_name,sql').fetchall()
    e['schemaSHA256']=digest(json.dumps(schema,ensure_ascii=True,separators=(',',':')).encode())
    tables=[r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    if not tables: raise ValueError('empty schema')
    e['tables']=[]
    for t in tables:
        quoted='"'+t.replace('"','""')+'"'
        columns=len(c.execute('PRAGMA table_info('+quoted+')').fetchall())
        rows=c.execute('SELECT * FROM '+quoted+' ORDER BY '+','.join(str(i+1) for i in range(columns))).fetchall()
        encode=lambda value: json.dumps(value,ensure_ascii=True,separators=(',',':'),default=lambda b:{'bytes':b.hex()}).encode()
        e['tables'].append({'nameSHA256':digest(t.encode()),'rowCount':len(rows),'contentSHA256':digest(encode(rows)),'withoutLastSHA256':digest(encode(rows[:-1]))})
    e['tables'].sort(key=lambda t:t['nameSHA256'])
    e['tableCount']=len(tables)
    e['rowCount']=sum(t['rowCount'] for t in e['tables'])
    e['readOnlyImmutable']=True
    e['ok']=True
except Exception as error:
    e['error']=str(error) if isinstance(error,ValueError) else type(error).__name__
finally:
    if c is not None: c.close()
    try:
        e['after']=files()
        if e.get('before')!=e['after']:
            e['ok']=False
            e['error']='SQLite files changed during observation'
    except Exception:
        e['ok']=False
        e['error']='SQLite after observation failed'
    print(json.dumps(e,separators=(',',':')))
`;
  try {
    const identity = await inspectStopped();
    Object.assign(evidence, identity);
    attempted = true;
    const output = await docker(['run', '--rm', '--pull=never', '--name', helper, '--label', 'voltra.ss14.snapshot=' + token, '--network', 'none', '--read-only', '--memory', '256m', '--memory-swap', '256m', '--cpus', '0.5', '--pids-limit', '32', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--mount', 'type=bind,src=' + identity.source + ',dst=/home/container,readonly', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', '--entrypoint', '/home/container/.voltra/python/bin/python3', identity.image, '-c', script], ctx.signal, 60000);
    Object.assign(evidence, JSON.parse(output));
    const after = await inspectStopped();
    if (after.id !== identity.id || after.image !== identity.image || after.source !== identity.source) throw Error('SS14 native identity changed during observation');
    validatePreferences(evidence);
    return evidence;
  } catch (error) {
    evidence.ok = false;
    evidence.failure = error.message;
    throw error;
  } finally {
    try {
      if (attempted) {
        // An aborted docker client can leave the helper running. Cleanup uses an
        // independent bounded call and verifies both the exact name and token.
        const ids = (await docker(['ps', '-aq', '--filter', 'name=^/' + helper + '$'], undefined, 10000)).trim();
        if (ids) {
          const [container] = JSON.parse(await docker(['inspect', helper], undefined, 10000));
          if (container.Name !== '/' + helper || container.Config?.Labels?.['voltra.ss14.snapshot'] !== token) throw Error('SS14 helper cleanup ownership mismatch');
          await docker(['rm', '-f', container.Id], undefined, 10000);
        }
      }
    } catch (error) {
      evidence.ok = false;
      evidence.cleanupFailure = error.message;
      throw error;
    } finally {
      await ctx.artifact('ss14-preferences-' + phase + '.json', JSON.stringify(evidence, null, 2));
    }
  }
}
function validatePreferences(db) {
  const files = db?.before;
  if (!files?.database?.present || !Number.isSafeInteger(files.database.bytes) || files.database.bytes <= 0 || !/^[a-f0-9]{64}$/.test(files.database.sha256 ?? '') || !files.wal || files.wal.bytes !== 0 || JSON.stringify(files) !== JSON.stringify(db.after)) throw Error('Missing stable DB/WAL observation boundary');
  if (!db?.ok || db.quickCheck !== 'ok' || db.readOnlyImmutable !== true || !/^[a-f0-9]{64}$/.test(db.schemaSHA256 ?? '') || !Array.isArray(db.tables) || !db.tables.length || db.tableCount !== db.tables.length || db.tables.some(t => !/^[a-f0-9]{64}$/.test(t.nameSHA256 ?? '') || !Number.isSafeInteger(t.rowCount) || t.rowCount < 0) || new Set(db.tables.map(t => t.nameSHA256)).size !== db.tables.length || db.rowCount !== db.tables.reduce((n, t) => n + t.rowCount, 0)) throw Error('Missing stable offline SS14 preferences evidence');
}
async function checksums(ctx) {
  const uuid = owned(ctx).uuid, hashes = [];
  for (const file of retentionPaths(ctx)) {
    const path = '/data/volumes/' + uuid + file;
    const sha256 = (await docker(['exec', 'voltra-validator-monitor', 'sha256sum', path], ctx.signal)).trim().split(/\s/)[0];
    const bytes = Number((await docker(['exec', 'voltra-validator-monitor', 'stat', '-c', '%s', path], ctx.signal)).trim());
    if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(bytes) || bytes <= 0) throw Error('Missing native SS14 retained disk file');
    hashes.push({ file, sha256, bytes });
  }
  return hashes;
}
export async function settings(ctx, c) {
  owned(ctx);
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'SS14 settings stop');
  await clean(ctx, c);
  const route = '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent(config);
  const before = (await h.api(route)).attributes;
  for (const key of Object.keys(values)) if (!before.fields?.some(f => f.key === key && !f.readonly)) throw Error('Missing editable typed SS14 setting: ' + key);
  await h.api(route, 'PUT', { revision: before.revision, settings: values });
  const after = (await h.api(route)).attributes;
  for (const [key, value] of Object.entries(values)) if (String(after.fields?.find(f => f.key === key)?.value) !== value) throw Error('SS14 typed readback mismatch: ' + key);
  ctx.ss14 = { marker: randomUUID(), fixture: ctx.fixture.server.uuid };
  await c.write(markerFile, ctx.ss14.marker);
  ctx.startRequestedAt = Date.now(); await c.power('start'); await wait(ctx, () => ready(ctx, c), 'SS14 settings readiness');
  const consumed = await readback(ctx);
  return { file: config, settings: values, native: consumed, scope };
}
export async function saved(ctx, c) {
  const stopped = await clean(ctx, c);
  if (ctx.ss14?.fixture !== owned(ctx).uuid || await c.read(markerFile) !== ctx.ss14.marker) throw Error('Missing owned SS14 persistence evidence');
  ctx.ss14.preferences = await preferences(ctx, 'saved');
  return { fixture: ctx.ss14.fixture, marker: ctx.ss14.marker, hashes: await checksums(ctx), preferences: ctx.ss14.preferences, stopped, scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  const readiness = await ready(ctx, c);
  if (!readiness) throw Error('Missing fresh SS14 reload readiness');
  const consumed = await readback(ctx);
  await c.power('stop');
  await wait(ctx, async () => await c.state() === 'offline', 'SS14 reload snapshot stop');
  const stopped = await clean(ctx, c);
  const db = await preferences(ctx, 'loaded');
  const current = await checksums(ctx);
  for (const row of current) {
    const prior = saved.hashes.find(x => x.file === row.file);
    if (row.file !== database && (row.sha256 !== prior.sha256 || row.bytes !== prior.bytes)) throw Error('SS14 retained disk bytes changed: ' + row.file);
  }
  if (await c.read(markerFile) !== saved.marker) throw Error('SS14 retained owned marker missing');
  if (db.schemaSHA256 !== saved.preferences.schemaSHA256 || db.tables.length !== saved.preferences.tables.length) throw Error('SS14 preferences schema changed');
  const changes = [];
  for (const table of db.tables) {
    const prior = saved.preferences.tables.find(t => t.nameSHA256 === table.nameSHA256);
    if (!prior?.contentSHA256) throw Error('Missing offline table content baseline');
    if (table.rowCount === prior.rowCount && table.contentSHA256 === prior.contentSHA256) continue;
    if (table.nameSHA256 !== 'a97b0931730e83fbf9284ff00a4c5f7a4eef2189dddb89319a6dfa5871e28923' || table.rowCount !== prior.rowCount + 1 || table.withoutLastSHA256 !== prior.contentSHA256) throw Error('SS14 changed existing preferences or unexpected database rows');
    changes.push({ table: 'round', appendedRows: 1, allPriorRowsUnchanged: true });
  }
  await ctx.artifact('ss14-native-database-delta.json', { schemaUnchanged: true, changes, otherTablesUnchanged: true });
  return { readiness, native: consumed, stopped, hashes: current, preferences: db, markerRetained: true, scope };
}
