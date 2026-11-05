/** Nukkit-specific assertions for the shared canonical coordinator.
 * Importing performs no runtime actions. No creation, settings writes or starts.
 */
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { hash } from './runner.mjs';
const recipe = 'minecraft/bedrock/nukkit/egg-nukkit.json';
const build = '8461d22b6667d4158d72a7d96b8462b7ce3856101592e8409e2077266fe1a7a2';
const jar = '1ed570be49d694cdfd93da0174be6bba8bb7e64f3b4568eac9421159df145879';
const releaseSHA = '234e7b62a22d5c768530c63f896bc808099edf7a54f7cfbfca4f2571378c2c22';
const launcher = '352173c37b86afd6d6ff62fddbad9ef8d79961dcdf5a716f50b74d80c8e15000';
const supervisor = 'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5';
export function verifyNukkitPrior(report, kind) {
  if (report.game !== 'nukkit' || report.build !== build || report.status !== 'PASS') throw Error('Current Nukkit native proof required');
  const e = report.checks.find(c => c.name === (kind === 'native' ? 'saved' : 'reinstall-native-reload'))?.evidence;
  const saved = kind === 'native' ? e : null;
  const stop = kind === 'native' ? e : e?.stop;
  if (!stop?.engineExitProven || stop.engineNumericExit !== 0) throw Error('Nukkit direct native stop proof missing');
  if (saved && (saved.baseline?.manifest?.['/server.jar']?.sha256 !== jar || saved.hashes?.['/.voltra/nukkit/release.json'] !== releaseSHA || saved.hashes?.['/.voltra/bedrock_family.py'] !== launcher || saved.hashes?.['/.voltra/native_console.py'] !== supervisor)) throw Error('Current Nukkit source/native identity differs');
  if (kind === 'native') {
    const ready = report.checks.find(c => c.name === 'start-ready')?.evidence;
    if (ready?.discovery?.protocol !== '2225' || ready.discovery.version !== '1.26.60' || !ready.engine?.direct) throw Error('Current Nukkit protocol/direct-process proof differs');
  }
}
export async function verifyNukkitInstalled(ctx, processContainer) {
  const f = ctx.fixture;
  if (ctx.game.id !== 'nukkit-canonical' || ctx.build !== build || receipt?.binary_sha256 !== build || f?.recipe !== recipe || f.server?.name !== 'validator-nukkit-canonical' || !/^[a-f0-9-]{36}$/.test(f.server.uuid) || f.intent?.request?.memory !== 1024) throw Error('Exact candidate12 Nukkit canonical fixture required');
  if (processContainer && f.diagnosticMemory?.confirmed !== true) throw Error('Nukkit bootstrap requires confirmed post-install memory0 release');
  const served = (await h.api('/api/application/servers/' + f.server.id)).attributes;
  if (served.uuid !== f.server.uuid || Number(served.limits?.memory) !== (f.diagnosticMemory?.confirmed === true ? 0 : 1024)) throw Error('Nukkit canonical memory identity/readback differs');
  const profile = h.profileFromRuntime(recipe, receipt), expected = {};
  for (const m of profile.egg.scripts.installation.script.matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)) {
    if (!/^\.voltra\/[a-zA-Z0-9_.-]+$/.test(m[1])) throw Error('Unreviewed Nukkit helper path');
    expected[m[1]] = hash(m[3] + '\n');
  }
  if (expected['.voltra/bedrock_family.py'] !== launcher || expected['.voltra/native_console.py'] !== supervisor) throw Error('Nukkit frozen unlimited-memory/exit helper changed');
  const ids = (await docker(['ps', '-aq', '--filter', 'name=' + f.server.uuid], ctx.signal)).trim().split(/\s+/).filter(Boolean);
  if (ids.length !== 1) throw Error('Nukkit canonical container ambiguous/missing');
  const [id] = JSON.parse(await docker(['inspect', ids[0]], ctx.signal));
  const source = '/var/lib/voltra-parity-20261029/volumes/' + f.server.uuid;
  if (id.Name !== '/' + f.server.uuid || id.Config.Labels?.ContainerType !== 'server_process' || !/^sha256:[a-f0-9]{64}$/.test(id.Image) || id.Config.Image !== f.intent.request.image || id.Mounts.filter(m => m.Destination === '/home/container' && m.Source === source && m.RW).length !== 1 || id.Mounts.some(m => m.Destination.startsWith('/home/container/'))) throw Error('Nukkit canonical container/mount differs');
  if (processContainer && (!id.State.Running || id.Id !== processContainer.id || id.State.StartedAt !== processContainer.state.StartedAt)) throw Error('Nukkit bootstrap process boundary changed');
  const script = String.raw`
import json,hashlib,os
from pathlib import Path
r=Path('/home/container');expected=${JSON.stringify(expected)}
def read(name):
 p=r/name
 for q in [p,*p.parents]:
  if q==r.parent:break
  if q.is_symlink():raise ValueError('Nukkit symlink path')
 if not p.is_file() or p.stat().st_size>64*1024*1024:raise ValueError('Invalid native file')
 return p.read_bytes()
actual={p:hashlib.sha256(read(p)).hexdigest() for p in expected}
if actual!=expected:raise ValueError('Nukkit installed helper drift')
binary=hashlib.sha256(read('server.jar')).hexdigest()
raw=read('.voltra/nukkit/release.json');release=json.loads(raw)
engines=[]
if ${processContainer ? 'True' : 'False'}:
 for p in list(Path('/proc').iterdir())[:65536]:
  if not p.name.isdigit():continue
  try:
   if os.path.realpath(p/'exe')!=str((r/'.voltra/java21/bin/java').resolve()):continue
   a=(p/'cmdline').read_bytes().split(b'\0')[:-1]
   pp=int(next(x.split()[1] for x in (p/'status').read_text().splitlines() if x.startswith('PPid:')))
   parent=Path('/proc',str(pp));pa=(parent/'cmdline').read_bytes().split(b'\0')[:-1]
   engines.append(dict(pid=int(p.name),ppid=pp,direct=pa[1:]==[b'.voltra/bedrock_family.py',b'run',b'nukkit'] and os.path.realpath(parent/'exe')==str((r/'.voltra/python/bin/python3').resolve()),heap2048=b'-Xmx2048M' in a,jar=a[a.index(b'-jar')+1].decode() if b'-jar' in a else None,cwd=os.readlink(p/'cwd')))
  except (FileNotFoundError,ProcessLookupError,PermissionError):pass
print(json.dumps(dict(hashes=actual,binarySHA256=binary,releaseSHA256=hashlib.sha256(raw).hexdigest(),release=release,engines=engines)))
`;
  const environment = ['-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib'];
  const python = '/home/container/.voltra/python/bin/python3';
  let result;
  if (id.State.Running) result = JSON.parse(await docker(['exec', ...environment, id.Id, python, '-B', '-c', script], ctx.signal, 30000));
  else result = JSON.parse(await docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--user', id.Config.User, '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', ...environment, '--mount', 'type=bind,src=' + source + ',dst=/home/container,readonly', '--entrypoint', python, id.Image, '-B', '-c', script], ctx.signal, 30000));
  if (result.binarySHA256 !== jar || result.releaseSHA256 !== releaseSHA || result.release.version !== '1.0-20261027.214338-1252') throw Error('Canonical latest resolved a different Nukkit snapshot; fresh native lifecycle proof required');
  const engine = result.engines[0];
  if (processContainer && (result.engines.length !== 1 || !engine.direct || !engine.heap2048 || engine.jar !== 'server.jar' || engine.cwd !== '/home/container')) throw Error('Nukkit canonical direct Java/2048MiB heap chain unproved');
  const proof = { ...result, engine, containerId: id.Id, startedAt: id.State.StartedAt, scope: 'Exact installed source and optional direct bootstrap process only; no players, gameplay or WAN' };
  await ctx.artifact('nukkit-canonical-source-' + Date.now() + '.json', proof);
  return proof;
}
export async function verifyNukkitExposure(ctx, body, properties) {
  const hasCapacity = /^max-players=/m.test(properties);
  const fields = body.fields.filter(f => f.key === 'max-players');
  // Publisher defaults omit capacity. Do not synthesize a property merely to
  // make the canonical presentation look editable; lifecycle tested explicit20.
  if (!hasCapacity && fields.length) throw Error('Nukkit absent default capacity advertised as present');
  if (hasCapacity && (fields.length !== 1 || fields[0].type !== 'number' || fields[0].readonly === true)) throw Error('Nukkit existing optional capacity authority missing');
  if (!/^enable-query=on\r?$/m.test(properties) || !body.revision) throw Error('Nukkit native query/revision presentation missing');
  await ctx.artifact('nukkit-default-exposure.json', { hasCapacity, capacityFields: fields, optionalCapacity: 'Native default omits max-players; lifecycle explicitly added supported20 then typed edited7', nativeSettingsClaim: false });
}
