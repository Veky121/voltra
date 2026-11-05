import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { hash } from './runner.mjs';
const build = '2163b02c95bb62f8728e37d5ff2f1c4104cd921028badf6c608c2167c5f5e693';
const recipes = { pocketmine: 'minecraft/bedrock/pocketmine_mp/egg-pocketmine-m-p.json', gomint: 'minecraft/bedrock/gomint/egg-go-mint.json' };
const launchers = { pocketmine: 'c47a3da9cbdeef19e726082911deb8830d2e0cf610032822ffff24f8d9b50f98', gomint: 'bf8701481c3d9cbd389c2a298e82ad38546c4df9be77539d36c745239a298058' };
const supervisor = 'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5';
const pm5 = 'd8b4d87a64124d83659f629c87d6a8e0e142192f6c719fe4684272ff44105539';
const gomintJar = 'd816bc2017b7eaa7767d7dcbb6d519c1f5ab3d7ecdf254f9792cf5668955e289';
const gomintArchive = 'cafa0c1680bd000fb0b269a257906f58c7d6c88dcc9abfc559997532db8c2d7d';
export function verifyBedrockPrior(report, kind, family) {
  if (!recipes[family] || report.build !== build || report.game !== family || report.status !== 'PASS' || report.fixture?.recipe !== recipes[family]) throw Error('Current candidate13 native PASS required');
  const saved = report.checks.find(c => c.name === 'saved')?.evidence;
  const reload = report.checks.find(c => c.name === 'reinstall-native-reload')?.evidence;
  const stop = kind === 'native' ? saved : reload?.stop;
  if (!stop?.engineExitProven || stop.engineNumericExit !== 0) throw Error('Current native engine exit0 proof required');
  const hashes = kind === 'native' ? saved.hashes : reload?.fresh?.hashes;
  if (hashes?.['/.voltra/bedrock_family.py'] !== launchers[family] || hashes?.['/.voltra/native_console.py'] !== supervisor) throw Error('Current native frozen helpers differ');
  if (kind === 'native') {
    const ready = report.checks.find(c => c.name === 'start-ready')?.evidence;
    if (family === 'gomint' && (ready?.discovery?.protocol !== '422' || ready.discovery.version !== '1.16.200' || ready.discovery.players !== 0)) throw Error('Current GoMint legacy native discovery proof missing');
    const proof = saved.processProof;
    if (!proof?.engine?.direct) throw Error('Current native direct engine proof missing');
    if (family === 'pocketmine') {
      if (saved.baseline?.manifest?.['/PocketMine-MP.phar']?.sha256 !== pm5 || proof.environment?.sourceProven !== true
        || proof.environment.loadedIniObserved !== false || proof.launchArguments?.sourceProven !== true
        || JSON.stringify(proof.engine.nativeTitle) !== JSON.stringify(['PocketMine-MP 5.44.3'])) throw Error('PM5 source-bound PHP title/environment proof differs');
    } else if (saved.baseline?.manifest?.['/modules/GoMint.jar']?.sha256 !== gomintJar || saved.chunkPersistenceClaimed !== false) throw Error('GoMint core/initialized-metadata boundary differs');
  }
}
export async function verifyBedrockInstalled(ctx, processContainer) {
  const f = ctx.fixture, family = ctx.game.id.replace(/-canonical$/, ''), recipe = recipes[family], launcher = launchers[family];
  if (!recipe || ctx.game.id !== family + '-canonical' || ctx.build !== build || receipt?.binary_sha256 !== build || f?.recipe !== recipe || f.server?.name !== 'validator-' + family + '-canonical' || !/^[a-f0-9-]{36}$/.test(f.server.uuid) || f.intent?.request?.memory !== 1024) throw Error('Exact candidate13 Bedrock canonical fixture required');
  if (processContainer && f.diagnosticMemory?.confirmed !== true) throw Error('Bedrock bootstrap requires confirmed post-install memory0 release');
  const served = (await h.api('/api/application/servers/' + f.server.id)).attributes;
  if (served.uuid !== f.server.uuid || served.external_id !== f.intent.externalId || served.name !== f.name || served.egg !== f.egg.id
    || Number(served.node) !== f.intent.request.node_id || Number(served.user) !== f.intent.ownerId || served.container?.image !== f.intent.request.image
    || f.intent.request.image !== 'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'
    || Number(served.limits?.memory) !== (f.diagnosticMemory?.confirmed === true ? 0 : 1024)) throw Error('Bedrock canonical memory identity/readback differs');
  const profile = h.profileFromRuntime(recipe, receipt), expected = {};
  for (const m of profile.egg.scripts.installation.script.matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)) {
    if (!/^\.voltra\/[a-zA-Z0-9_.-]+$/.test(m[1])) throw Error('Unreviewed Bedrock helper path');
    expected[m[1]] = hash(m[3] + '\n');
  }
  if (expected['.voltra/bedrock_family.py'] !== launcher || expected['.voltra/native_console.py'] !== supervisor) throw Error('Bedrock frozen unlimited-memory/exit helper changed');
  const ids = (await docker(['ps', '-aq', '--filter', 'name=' + f.server.uuid], ctx.signal)).trim().split(/\s+/).filter(Boolean);
  if (ids.length > 1) throw Error('Bedrock canonical container ambiguous/missing');
  let id;
  if (ids.length) [id] = JSON.parse(await docker(['inspect', ids[0]], ctx.signal));
  else {
    if (processContainer) throw Error('Expected bootstrap container missing');
    const image = JSON.parse(await docker(['image', 'inspect', '--format', '{{json .Id}}', f.intent.request.image], ctx.signal));
    if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw Error('Immutable cached canonical image missing');
    id = { Image: image, State: { Running: false }, Config: { User: '0:0' } };
  }
  const source = '/var/lib/voltra-parity-20261029/volumes/' + f.server.uuid;
  if (ids.length && (id.Name !== '/' + f.server.uuid || id.Config.Labels?.ContainerType !== 'server_process' || !/^sha256:[a-f0-9]{64}$/.test(id.Image) || id.Config.Image !== f.intent.request.image || id.Mounts.filter(m => m.Destination === '/home/container' && m.Source === source && m.RW).length !== 1 || id.Mounts.some(m => m.Destination.startsWith('/home/container/')))) throw Error('Bedrock canonical container/mount differs');
  if (processContainer && (!id.State.Running || id.Id !== processContainer.id || id.State.StartedAt !== processContainer.state.StartedAt)) throw Error('Bedrock bootstrap process boundary changed');
  const script = String.raw`
import json,hashlib,os
from pathlib import Path
r=Path('/home/container');family=${JSON.stringify(family)};expected=${JSON.stringify(expected)}
def read(name):
 p=r/name
 for q in [p,*p.parents]:
  if q==r.parent:break
  if q.is_symlink():raise ValueError('Bedrock symlink path')
 if not p.is_file() or p.stat().st_size>64*1024*1024:raise ValueError('Invalid native file')
 return p.read_bytes()
actual={p:hashlib.sha256(read(p)).hexdigest() for p in expected}
if actual!=expected:raise ValueError('Bedrock installed helper drift')
binary=hashlib.sha256(read('modules/GoMint.jar' if family=='gomint' else 'PocketMine-MP.phar')).hexdigest()
raw=read('.voltra/'+family+'/release.json');release=json.loads(raw)
print(json.dumps(dict(hashes=actual,binarySHA256=binary,releaseSHA256=hashlib.sha256(raw).hexdigest(),release=release)))
`;
  const environment = ['-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib'];
  const python = '/home/container/.voltra/python/bin/python3';
  let result;
  if (id.State.Running) result = JSON.parse(await docker(['exec', ...environment, id.Id, python, '-B', '-c', script], ctx.signal, 30000));
  else result = JSON.parse(await docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--user', id.Config.User, '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', ...environment, '--mount', 'type=bind,src=' + source + ',dst=/home/container,readonly', '--entrypoint', python, id.Image, '-B', '-c', script], ctx.signal, 30000));
  if (family === 'gomint') {
    if (result.binarySHA256 !== gomintJar || result.release.files?.['GoMint.jar'] !== gomintJar
      || result.release.sha256 !== gomintArchive || result.release.version !== '1.0.0-RC6') throw Error('Canonical GoMint actual core JAR/release differs');
  } else {
    if (result.binarySHA256 !== pm5 || result.release.binary_sha256 !== pm5 || result.release.sha256 !== pm5
      || result.release.version !== '5.44.3' || result.release.game !== 'pocketmine') throw Error('Canonical PM5 publication differs');
  }
  const proof = { ...result, containerId: id.Id, startedAt: id.State.StartedAt, scope: 'Exact installed source/binary only; native process semantics reused only from current PASS receipts' };
  await ctx.artifact(family + '-canonical-source-' + Date.now() + '.json', proof);
  return proof;
}
