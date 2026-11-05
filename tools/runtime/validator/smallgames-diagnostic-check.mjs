/** Source-only bounded crash-diagnostic hook. Importing performs no operations.
 * Call only from the canonical queue after cold install and allocation readback.
 * Preserves every observation; does not claim gameplay, persistence or reinstall.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { campaign as h, receipt, settings, docker } from './campaign-session.mjs';
import { hash } from './runner.mjs';

const SNAPSHOT = resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-9/build-input-1793661350056');
const profiles = Object.freeze({
  clonehero: { recipe: 'clone_hero/egg-clone-hero.json', engine: '/home/container/clone/Server', script: '.voltra/small_games_family_runtime.py', args: ['clone'], python: 'python3', ready: 'Server running...', stopExit: 254 },
  cryofall: { recipe: 'cryofall/egg-cryo-fall.json', engine: '/home/container/.voltra/dotnet-6/dotnet', script: '.voltra/cryofall_file_authority.py', args: [], python: '/home/container/.voltra/python/bin/python3', ready: 'UDPServer: Socket-server listening on', stopExit: 0 },
});
const attrs = value => value?.attributes ?? value;
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function api(ctx, suffix, method = 'GET', body, raw = false) {
  const response = await fetch('http://127.0.0.1:18099' + suffix, { method, redirect: 'error',
    signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(30000)]), headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw Error(`Diagnostic ${method} ${suffix.split('?')[0]} HTTP ${response.status}`);
  if (response.status === 204) return null;
  return raw ? response.text() : attrs(await response.json());
}
async function until(ctx, label, fn, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { ctx.signal.throwIfAborted(); const value = await fn(); if (value) return value; await sleep(500); }
  throw Error('Diagnostic timeout: ' + label);
}
function helperPins(script) {
  const pins = {};
  const pattern = /^cat > (\.voltra\/[a-zA-Z0-9_./-]+) <<'([A-Z0-9_]+)'\r?\n([\s\S]*?)^\2\r?$/gm;
  for (const match of script.matchAll(pattern)) {
    if (pins[match[1]]) throw Error('Duplicate frozen helper');
    pins[match[1]] = hash(match[3].replaceAll('\r\n', '\n'));
  }
  if (!pins['.voltra/native_console.py']) throw Error('Frozen native console helper missing');
  return pins;
}
async function guard(ctx, p) {
  const f = ctx.fixture;
  if (!f?.server || f.name !== 'validator-' + ctx.game.id || f.recipe !== p.recipe
    || f.intent?.build !== ctx.build || f.install?.rawExit !== '0' || !f.install?.callback?.success
    || !f.install.removed || !f.install.logsFollowed) throw Error('Exact successfully cold-installed canonical fixture required');
  const current = await h.verifyRuntime();
  if (resolve(current.snapshot) !== SNAPSHOT || resolve(receipt.snapshot) !== SNAPSHOT
    || current.binary_sha256 !== ctx.build || settings.build !== ctx.build) throw Error('Active candidate 9 mismatch');
  const frozen = JSON.parse(await readFile(resolve(SNAPSHOT, 'internal/panel/game_library/overrides.json'), 'utf8'))[p.recipe];
  const active = h.profileFromRuntime(p.recipe, current);
  if (JSON.stringify(active) !== JSON.stringify(frozen)) throw Error('Frozen recipe differs from active candidate');
  const s = await api(ctx, '/api/application/servers/' + f.server.id);
  if (s.uuid !== f.server.uuid || s.name !== f.name || Number(s.user) !== f.intent.ownerId
    || Number(s.node) !== f.intent.request.node_id || s.external_id !== f.intent.externalId
    || s.container?.image !== f.intent.request.image) throw Error('Canonical server identity changed');
  const egg = await api(ctx, '/api/admin/eggs/' + s.egg);
  if (egg.uuid !== f.egg.uuid || egg.script_install !== frozen.egg.scripts.installation.script
    || egg.startup !== frozen.egg.startup) throw Error('Exact canonical egg/startup changed');
  const pins = helperPins(frozen.egg.scripts.installation.script);
  for (const [file, expected] of Object.entries(pins)) {
    const bytes = await api(ctx, '/api/client/servers/' + s.uuid + '/files/contents?file=' + encodeURIComponent('/' + file), 'GET', undefined, true);
    if (hash(bytes) !== expected) throw Error('Installed frozen helper mismatch: ' + file);
  }
  return { runtime: current, pins, server: { id: s.id, uuid: s.uuid, egg: s.egg, image: s.container.image } };
}
async function container(ctx, attempt = 0) {
  const uuid = ctx.fixture.server.uuid;
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw Error('Invalid owned UUID');
  const ids = (await docker(['ps', '-aq', '--filter', 'name=' + uuid], ctx.signal)).trim().split(/\s+/).filter(Boolean);
  let runtime;
  for (const id of ids) {
    let c;
    try { [c] = JSON.parse(await docker(['inspect', id], ctx.signal)); }
    catch (error) {
      // Wings replaces the stopped container on start. Re-enumerate ownership;
      // a disappearing old ID is not evidence that the replacement is offline.
      if (attempt < 3 && String(error).includes('No such object:')) return container(ctx, attempt + 1);
      throw error;
    }
    if (c.Name === '/' + uuid + '_installer') throw Error('Installer exists; diagnostic must not touch it');
    if (c.Name !== '/' + uuid || runtime || c.Config.Image !== ctx.fixture.intent.request.image
      || !c.Mounts.some(m => m.Destination === '/home/container' && m.Source.endsWith('/' + uuid))) throw Error('Ambiguous runtime ownership');
    runtime = c;
  }
  return runtime;
}
const probe = String.raw`
import os,sys,json,hashlib,signal
from pathlib import Path
p=json.loads(sys.argv[1]); expected=json.loads(sys.argv[2]); kill=sys.argv[3]=='kill'
def digest(path):
 with open(path,'rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()
def proc(pid):
 root=Path('/proc')/str(pid)
 stat=(root/'stat').read_text().rsplit(')',1)[1].split()
 return dict(pid=pid,ppid=int(stat[1]),startticks=stat[19],exe=os.readlink(root/'exe'),argv=(root/'cmdline').read_bytes().rstrip(b'\0').split(b'\0'))
def clean(row): return {**row,'argv':[x.decode() for x in row['argv']]}
for file,sha in p['pins'].items():
 path=Path('/home/container')/file
 assert path.is_file() and not path.is_symlink() and digest(path)==sha, 'helper mismatch'
rows=[]
for d in Path('/proc').iterdir():
 if not d.name.isdigit():continue
 try:
  r=proc(int(d.name))
  if r['exe']==p['engine']: rows.append(r)
 except (FileNotFoundError,ProcessLookupError,PermissionError): pass
assert len(rows)==1,'ambiguous native executable'
r=rows[0]; parent=proc(r['ppid'])
assert r['pid']>1 and parent['pid']>1 and r['pid']!=parent['pid']
assert parent['exe']==os.path.realpath(sys.executable),'supervisor interpreter mismatch'
a=[x.decode() for x in parent['argv']]
assert len(a)==2+len(p['args']) and a[1] in (p['script'],'/home/container/'+p['script']) and a[2:]==p['args'],'supervisor exact argv mismatch'
assert r['argv'][0].decode()==p['engine'],'native argv mismatch'
if p['family']=='cryofall': assert [x.decode() for x in r['argv'][1:]]==['/home/container/Binaries/Server/CryoFall_Server.dll','loadOrNew'],'CryoFall exact argv mismatch'
result={'native':clean(r),'supervisor':clean(parent),'nativeSHA256':digest('/proc/'+str(r['pid'])+'/exe'),'supervisorSHA256':digest('/proc/'+str(parent['pid'])+'/exe'),'helpers':p['pins']}
if p['family']=='cryofall':result['managedSHA256']=digest('/home/container/Binaries/Server/CryoFall_Server.dll')
if kill:
 assert result==expected,'native identity changed before kill'
 assert hasattr(os,'pidfd_open') and hasattr(signal,'pidfd_send_signal'),'pidfd required'
 fd=os.pidfd_open(r['pid'])
 try:
  assert proc(r['pid'])==r and proc(parent['pid'])==parent,'PID identity race'
  signal.pidfd_send_signal(fd,signal.SIGKILL)
  result['delivered']='SIGKILL'
 finally:os.close(fd)
print(json.dumps(result))
`;
async function native(ctx, p, pins, c, expected) {
  if (!c?.State.Running) throw Error('Owned runtime must be running');
  const data = { ...p, family: ctx.game.id.replace(/-canonical$/, ''), pins };
  const env = p.python.startsWith('/home/container/.voltra/python/')
    ? ['-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib'] : [];
  return JSON.parse(await docker(['exec', ...env, c.Id, p.python, '-c', probe, JSON.stringify(data), JSON.stringify(expected ?? {}), expected ? 'kill' : 'probe'], ctx.signal));
}

export async function runDiagnostic(ctx) {
  const family = ctx.game.id.replace(/-canonical$/, ''), p = profiles[family];
  if (!p || ctx.game.id !== family + '-canonical') throw Error('Only CloneHero/CryoFall canonical diagnostics allowed');
  const route = '/api/client/servers/' + ctx.fixture?.server?.uuid;
  let sequence = 0, started = false, failure;
  const evidence = { family, scope: 'Root controlled fixture; no game client joined by this adapter. No player/gameplay, world persistence, reinstall or WAN acceptance.' };
  async function capture(label, detailed = true) {
    const c = await container(ctx);
    const logs = detailed && c ? await docker(['logs', '--timestamps', '--tail', '20000', c.Id], ctx.signal) : '';
    const entry = { container: c, resources: await api(ctx, route + '/resources'), logs };
    if (detailed) await ctx.artifact(`diagnostic-${String(sequence++).padStart(4, '0')}-${label}.json`, entry);
    return entry;
  }
  async function idle(label) {
    return until(ctx, label, async () => {
      const e = await capture(label, false);
      if (e.container?.State.Running || e.resources.current_state !== 'offline') return false;
      await ctx.artifact(`diagnostic-${sequence++}-${label}.json`, e);
      return e;
    });
  }
  async function start(label, pins, previous) {
    await guard(ctx, p);
    const before = await capture(label + '-before');
    if (before.container?.State.Running || before.resources.current_state !== 'offline') throw Error('Start requires owned idle fixture');
    started = true; // Power request ambiguity still requires exact owned cleanup.
    await api(ctx, route + '/power', 'POST', { signal: 'start' });
    const ready = await until(ctx, label, async () => {
      const e = await capture(label, false);
      if (!e.container?.State.Running || e.resources.current_state !== 'running') return false;
      if (e.container.State.StartedAt === before.container?.State.StartedAt) return false;
      // Docker timestamp boundary excludes earlier starts even when container ID is reused.
      const fresh = await docker(['logs', '--timestamps', '--since', e.container.State.StartedAt, '--tail', '20000', e.container.Id], ctx.signal);
      if (!fresh.includes(p.ready)) return false;
      await ctx.artifact(`diagnostic-${sequence++}-${label}-fresh.log`, fresh);
      return { ...e, fresh, identity: await native(ctx, p, pins, e.container) };
    }, 300000);
    if (previous && ready.identity.native.pid === previous.native.pid && ready.identity.native.startticks === previous.native.startticks) throw Error('Recovery did not create a fresh native process');
    return ready;
  }
  try {
    const verified = await guard(ctx, p);
    evidence.pin = verified;
    await ctx.artifact('diagnostic-source-pin.json', verified);
    await idle('initial-offline');
    // Canonical creation validates recommendations; native idle tests use live
    // host admission instead of retaining that recommendation as a hard limit.
    const buildRoute = '/api/application/servers/' + ctx.fixture.server.id;
    const beforeLimits = (await api(ctx, buildRoute)).limits;
    if (![0, 1024].includes(beforeLimits.memory)) throw Error('Unexpected diagnostic memory limit');
    await ctx.artifact('diagnostic-memory-intent.json', { before: beforeLimits, requested: { memory: 0 }, uuid: ctx.fixture.server.uuid });
    await api(ctx, buildRoute + '/build', 'PATCH', { memory: 0 });
    const afterLimits = (await api(ctx, buildRoute)).limits;
    if (afterLimits.memory !== 0 || afterLimits.disk !== beforeLimits.disk) throw Error('Diagnostic unlimited memory readback failed');
    ctx.fixture.diagnosticMemory = { confirmed: true, before: beforeLimits, after: afterLimits, at: new Date().toISOString() };
    await ctx.own(ctx.fixture);
    const ready = await start('firstboot-readiness', verified.pins);
    evidence.firstboot = ready.identity;
    await ctx.artifact('diagnostic-native-target.json', { containerId: ready.container.Id, imageId: ready.container.Image, ...ready.identity });
    await guard(ctx, p);
    const current = await container(ctx);
    if (current.Id !== ready.container.Id || current.State.StartedAt !== ready.container.State.StartedAt) throw Error('Container identity changed before signal');
    evidence.signal = await native(ctx, p, verified.pins, current, ready.identity);
    await ctx.artifact('diagnostic-delivered-signal.json', evidence.signal);
    const crashed = await idle('crash-offline');
    const fresh = await docker(['logs', '--timestamps', '--since', ready.container.State.StartedAt, '--tail', '20000', ready.container.Id], ctx.signal);
    await ctx.artifact('diagnostic-crash-fresh.log', fresh);
    if (!fresh.includes('[ERROR] Native process exited: raw_status=-9; signal=9 (SIGKILL); stop_requested=false.')
      || crashed.container?.Id !== ready.container.Id || crashed.container.State.ExitCode !== 247 || crashed.container.State.OOMKilled !== false) throw Error('Missing actual shared ERROR/native247/offline/non-OOM crash contract');
    evidence.crash = { state: crashed.container.State, diagnostic: 'raw_status=-9; signal=9 (SIGKILL); stop_requested=false' };
    const recovery = await start('recovery-readiness', verified.pins, ready.identity);
    evidence.recovery = recovery.identity;
    await api(ctx, route + '/power', 'POST', { signal: 'stop' });
    const stopped = await idle('requested-stop');
    const stopLogs = await docker(['logs', '--timestamps', '--since', recovery.container.State.StartedAt, '--tail', '20000', recovery.container.Id], ctx.signal);
    await ctx.artifact('diagnostic-requested-stop-fresh.log', stopLogs);
    if (stopped.container?.Id !== recovery.container.Id || stopped.container.State.ExitCode !== p.stopExit || stopped.container.State.OOMKilled !== false
      || family === 'clonehero' && !stopLogs.includes('[WARN] Native process exited: raw_status=-2; signal=2 (SIGINT); stop_requested=true.')
      || family === 'cryofall' && /\[ERROR\] Native process exited:/.test(stopLogs)) throw Error('Requested stop differs from observed profile contract');
    evidence.stop = stopped.container.State;
    evidence.status = 'actual bounded diagnostic passed';
    return evidence;
  } catch (error) { failure = error; evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    ctx = { ...ctx, signal: AbortSignal.timeout(60000) };
    try {
      if (started) {
        // Never use container kill, forced stop, removal, or an unknown PID for cleanup.
        const c = await container(ctx);
        if (c?.State.Running) { await guard(ctx, p); await api(ctx, route + '/power', 'POST', { signal: 'stop' }); }
        const parked = await idle('cleanup-offline');
        evidence.cleanup = { offline: true, state: parked.container?.State, preserved: true };
      }
    } catch (error) {
      evidence.cleanup = { offline: false, error: String(error), preserved: true };
      throw new AggregateError([...(failure ? [failure] : []), error], 'Diagnostic cleanup could not prove offline; stop admission and preserve fixture');
    } finally { await ctx.artifact('diagnostic-result.json', evidence); }
  }
}
