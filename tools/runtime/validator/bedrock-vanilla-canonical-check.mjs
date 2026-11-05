/** BDS-specific canonical assertions; importing never opens a session.
 * Native19 PASS and failed retention are historical only; native21 acceptance is pending.
 */
import { resolve } from 'node:path';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { hash } from './runner.mjs';
export const bedrockVanillaRecipe = 'minecraft/bedrock/bedrock/egg-vanilla-bedrock.json';
export const BDS_CANONICAL_BUILD = 'f78390ea7a4ab8d11352ba1698255879ddf46794a84545a792a1249ad31e4b45';
const currentBuild = BDS_CANONICAL_BUILD;
export const bedrockVanillaIdentity = (id,build) => id === 'bedrock_vanilla-canonical' && /^[a-f0-9]{64}$/.test(currentBuild) && build === currentBuild;
const nativeBuild = '248f83a9ae1acc2db8248993823d07e427ff26954e2549c89143c1470dacd0e7';
const snapshot = resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-21/build-input-1793674979520');
const archive = 'f6348d84fa714d04ca194f207e89453ca6bba0a1359396475271a52a150471c6';
const binary = '0a490c711d4a2ce075debcd979e8862b7eaba008373f9970f0edbb67f98f9207';
const historicalLauncher = 'edc63609aa2b1a0430c2382bf264cd857fb3bd7bf1115bf1f5e757583ffd3852';
const launcher = '61526a2ab3cfb772724bb2a1dcf7300922584355a39eb31c4564aefc345c3d24';
const supervisor = 'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5';
export function materializeBedrockDefaults(variables, request) {
  const environment = Object.fromEntries(variables.map(v => [v.env_variable, String(v.default_value)]));
  if (!Object.hasOwn(environment, 'BEDROCK_TERMS_ACCEPTED') || environment.BEDROCK_TERMS_ACCEPTED !== 'false' || environment.ONLINE_MODE !== 'true' || environment.BEDROCK_TRANSPORT !== 'nethernet' || environment.BEDROCK_VERSION !== 'latest' || !request.environment || JSON.stringify(Object.keys(environment).sort()) !== JSON.stringify(Object.keys(request.environment).sort())) throw Error('Exact canonical BDS default set required');
  environment.BEDROCK_TERMS_ACCEPTED = 'true';
  for (const [key, value] of Object.entries(environment)) if (request.environment[key] !== value) throw Error('Unexpected BDS canonical override: ' + key);
  return { ...request, environment };
}
export function bedrockTermsAuthorization() {
  return { accepted: true, environment: 'BEDROCK_TERMS_ACCEPTED', value: 'true', originalDefault: 'false', terms: 'https://www.minecraft.net/eula', usage: 'https://www.minecraft.net/usage-guidelines', at: new Date().toISOString(), authority: 'User explicitly authorized accepting game EULAs in this session', ownershipOrLicensePurchaseClaim: false };
}
export function verifyBedrockVanillaPrior(report, kind) {
  if (!['native', 'retention'].includes(kind)) throw Error('Unknown BDS evidence kind');
  if (kind === 'retention') {
    if (report.status !== 'FAIL' || report.game !== 'bedrock_vanilla' || report.build !== nativeBuild || report.checks?.find(c=>c.name==='canonical-reinstall')?.status !== 'PASS' || report.checks?.find(c=>c.name==='reinstall-retained-bytes')?.status !== 'FAIL') throw Error('Exact historical candidate19 known retention failure required');
    return;
  }
  if (report.build !== nativeBuild || report.game !== 'bedrock_vanilla' || report.status !== 'PASS' || report.fixture?.recipe !== bedrockVanillaRecipe || !Array.isArray(report.checks) || report.checks.some(c => c.status !== 'PASS')) throw Error('Exact current BDS native19 PASS required');
  const saved = report.checks.find(c => c.name === 'saved')?.evidence;
  const reloaded = report.checks.find(c => c.name === 'reinstall-native-reload')?.evidence;
  const stop = kind === 'native' ? saved : reloaded?.stop;
  const hashes = kind === 'native' ? saved?.hashes : reloaded?.fresh?.hashes;
  if (stop?.engineExitProven !== true || stop.engineNumericExit !== 0 || hashes?.['/.voltra/bedrock_family.py'] !== historicalLauncher || hashes?.['/.voltra/native_console.py'] !== supervisor) throw Error('BDS direct native exit/helper evidence differs');
  if (kind === 'native') {
    const ready = report.checks.find(c => c.name === 'start-ready')?.evidence;
    if (saved.baseline?.manifest?.['/bedrock_server']?.sha256 !== binary || ready?.capability?.status !== 200 || ready.capability.serverMetadataClaim !== false || ready.capability.sdpOfferSent !== false || ready.nativeList?.capacity !== 10 || !saved.processProof?.engine?.direct) throw Error('BDS exact native publication/capability boundary differs');
  } else {
    const retained = report.checks.find(c => c.name === 'reinstall-retained-bytes')?.evidence;
    if (!retained?.identical || retained.ownershipAndModes !== true || !(retained.files > 0) || reloaded.nativeIdentityRetained !== true) throw Error('BDS canonical retention/native reload evidence missing');
  }
}
export async function verifyBedrockVanillaInstalled(ctx) {
  const f = ctx.fixture;
  if (ctx.game.id !== 'bedrock_vanilla-canonical' || ctx.build !== currentBuild || receipt?.binary_sha256 !== currentBuild || resolve(receipt.snapshot) !== snapshot || f?.recipe !== bedrockVanillaRecipe || f.server?.name !== 'validator-' + ctx.game.id || f.intent?.build !== currentBuild || f.intent.request.memory !== 2048 || f.intent.ownerId !== ctx.game.ownerId) throw Error('Exact sealed candidate21 canonical BDS fixture required');
  const canonical = materializeBedrockDefaults(h.profileFromRuntime(bedrockVanillaRecipe, receipt).egg.variables, f.intent.request);
  const server = (await h.api('/api/application/servers/' + f.server.id)).attributes;
  if (server.uuid !== f.server.uuid || server.name !== f.name || server.external_id !== f.intent.externalId || server.egg !== f.egg.id || Number(server.node) !== f.intent.request.node_id || Number(server.user) !== f.intent.ownerId || Number(server.limits?.memory) !== 2048 || server.container?.image !== f.intent.request.image) throw Error('Canonical BDS identity/resources differ');
  for (const [key, value] of Object.entries(canonical.environment)) if (server.container.environment?.[key] !== value) throw Error('Canonical BDS actual startup default differs: ' + key);
  const profile = h.profileFromRuntime(bedrockVanillaRecipe, receipt), helpers = {};
  if (f.intent.scriptHash !== hash(profile.egg.scripts.installation.script) || server.container.startup_command !== profile.egg.startup) throw Error('Canonical BDS frozen source/startup differs');
  for (const m of profile.egg.scripts.installation.script.matchAll(/cat > (\.voltra\/[a-zA-Z0-9_.-]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)) helpers[m[1]] = hash(m[3] + '\n');
  if (helpers['.voltra/bedrock_family.py'] !== launcher || helpers['.voltra/native_console.py'] !== supervisor) throw Error('Canonical BDS launcher/supervisor changed');
  const ids = (await docker(['ps', '-aq', '--filter', 'name=' + f.server.uuid], ctx.signal)).trim().split(/\s+/).filter(Boolean);
  if (ids.length !== 1) throw Error('Canonical BDS container/installer ambiguous');
  const [id] = JSON.parse(await docker(['inspect', ids[0]], ctx.signal));
  const source = '/var/lib/voltra-parity-20261029/volumes/' + f.server.uuid;
  if (id.Name !== '/' + f.server.uuid || id.State.Running || !/^sha256:[a-f0-9]{64}$/.test(id.Image) || id.Mounts.filter(m => m.Destination === '/home/container' && m.Source === source).length !== 1 || id.Mounts.some(m => m.Destination.startsWith('/home/container/'))) throw Error('Canonical BDS readonly volume boundary differs');
  const script = String.raw`
import json,hashlib,stat
from pathlib import Path
r=Path('/home/container');expected=${JSON.stringify(helpers)}
def digest(name,maximum=536870912):
 p=r/name
 for ancestor in [p,*p.parents]:
  if ancestor==r.parent:break
  if ancestor.is_symlink():raise ValueError('Symlink native publication')
 s=p.stat()
 if not stat.S_ISREG(s.st_mode) or s.st_size>maximum:raise ValueError('Invalid native publication')
 h=hashlib.sha256()
 with p.open('rb') as stream:
  for block in iter(lambda:stream.read(1048576),b''):h.update(block)
 return h.hexdigest()
actual={name:digest(name,8388608) for name in expected}
if actual!=expected:raise ValueError('Installed frozen BDS helpers differ')
release=json.loads((r/'.voltra/bds/release.json').read_text());properties={}
for line in (r/'server.properties').read_text().splitlines():
 if '=' in line and not line.lstrip().startswith(('#','!')):
  key,value=line.split('=',1)
  if key in ['online-mode','transport','server-port','server-udp-ports','max-players']:properties[key]=value.strip()
print(json.dumps(dict(helpers=actual,release={k:release.get(k) for k in ['game','version','sha256','bytes','url','binary_sha256']},binarySHA256=digest('bedrock_server'),properties=properties)))`;
  const python = '/home/container/.voltra/python/bin/python3';
  const observed = JSON.parse(await docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--user', id.Config.User, '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', '--mount', 'type=bind,src=' + source + ',dst=/home/container,readonly', '--entrypoint', python, id.Image, '-B', '-c', script], ctx.signal, 30000));
  // Current latest is independently reviewed; historical metadata/cache pins above remain unchanged.
  if (observed.binarySHA256 !== 'd75212f20511eac3e3a1a45c5b57646d697a33038d5e41fa92113e1fbc14efab' || observed.release.version !== '1.26.61.1' || observed.release.sha256 !== 'b54095267d55fd401de42f71ac4daf2c1747a49515ad41810781f1f9bafde26e' || observed.release.binary_sha256 !== 'd75212f20511eac3e3a1a45c5b57646d697a33038d5e41fa92113e1fbc14efab' || observed.release.bytes !== 98093051 || observed.release.url !== 'https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-1.26.61.1.zip' || observed.properties['online-mode'] !== 'true' || observed.properties.transport !== 'nethernet' || observed.properties['server-port'] !== String(f.ports[0]) || observed.properties['server-udp-ports'] !== f.ports[0] + ':' + f.ports[0]) throw Error('Canonical latest BDS publication differs; fresh native evidence required for a new release');
  await ctx.artifact('bedrock-vanilla-canonical-source.json', { ...observed, scope: 'Exact installed source and offline configuration; prior native evidence is separately pinned. No new player/media/native lifecycle claim.' });
  return observed;
}
export function verifyBedrockVanillaExposure(body, properties) {
  const max = body.fields?.filter(f => f.key === 'max-players');
  if (!body.revision || max?.length !== 1 || max[0].type !== 'number' || max[0].readonly || max[0].read_only || !/^max-players\s*=\s*\d+\s*$/m.test(properties)) throw Error('Canonical BDS existing editable capacity field missing');
  for (const key of ['server-name', 'server-port', 'server-udp-ports', 'online-mode', 'transport']) {
    const f = body.fields?.find(f => f.key === key);
    if (f && f.readonly !== true && f.read_only !== true) throw Error('Canonical BDS startup-owned field unexpectedly editable: ' + key);
  }
  return { maxPlayers: max[0], startupOwnedFieldsChecked: true, nativeSettingsClaim: false };
}
export const bedrockCacheRecoveryBoundary = Object.freeze({
  archiveSHA256: archive, bytes: 94927522, destination: '.voltra/public-cache/' + archive,
  rule: 'No pre-POST cache race: preserve failed first canonical install, verify original canonical identity/script, require server and installer stopped, independently verify and copy public blob, then explicitly reviewed API reinstall on that same fixture. Keep raw first failure; do not claim cold download.',
  metadataBoundary: 'Default latest still queries official metadata; archive cache does not bypass that request.',
});

export function verifyBedrockVanillaGate(ctx,report,raw,pin,frozen,kind) {
 if(!bedrockVanillaIdentity(ctx.game.id,ctx.build) || hash(raw)!==pin.sha256 || frozen?.nativeCurrentPending!==true || frozen.historicalSourceEquivalent!==false) throw Error('BDS21 reviewed current-pending gate required');
 const profile=h.profileFromRuntime(bedrockVanillaRecipe,receipt);
 const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
 if(hash(JSON.stringify(sorted(profile)))!==frozen.profileSHA256 || hash(profile.egg.scripts.installation.script)!==frozen.scriptSHA256) throw Error('BDS21 exact frozen profile differs');
 verifyBedrockVanillaPrior(report,kind);
}

export async function verifyBedrockCacheRetry(ctx) {
 const f=ctx.fixture, review=ctx.game.bedrockFailedInstallCacheRetry, sha=archive;
 if(!bedrockVanillaIdentity(ctx.game.id,ctx.build) || !review || review.serverUUID!==f.server.uuid || review.firstFailureSHA256!==hash(JSON.stringify(f.install)) || review.originalScriptSHA256!==f.intent.scriptHash || review.archiveSHA256!==sha || f.install.rawExit==='0' || !/^\d+$/.test(f.install.rawExit??'') || !f.install.logsFollowed || !f.install.removed || !f.install.memoryValid || !f.install.callback || f.bedrockCacheRetry) throw Error('Exact reviewed failed canonical install/cache retry required');
 const image=f.intent.request.image;
 const source='/var/lib/voltra-parity-20261029/volumes/'+f.server.uuid;
 const script=String.raw`
import hashlib,json,stat
from pathlib import Path
r=Path('/home/container');p=r/'.voltra/public-cache/${sha}'
for x in [p,*p.parents]:
 if x==r.parent:break
 if x.is_symlink():raise ValueError('Symlink cache refused')
s=p.stat()
if not stat.S_ISREG(s.st_mode) or s.st_size!=94927522:raise ValueError('Wrong public cache size')
h=hashlib.sha256()
with p.open('rb') as f:
 for b in iter(lambda:f.read(1048576),b''):h.update(b)
if h.hexdigest()!='${sha}':raise ValueError('Wrong public cache hash')
print(json.dumps(dict(sha256=h.hexdigest(),bytes=s.st_size)))`;
 const result=JSON.parse(await docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--cap-drop','ALL','--security-opt','no-new-privileges','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib','--mount','type=bind,src='+source+',dst=/home/container,readonly','--entrypoint','/home/container/.voltra/python/bin/python3',image,'-B','-c',script],ctx.signal,30000));
 if(result.sha256!==sha||result.bytes!==94927522)throw Error('BDS public cache readback differs');
 return {...result,firstFailureSHA256:review.firstFailureSHA256,serverUUID:f.server.uuid,coldDownloadClaim:false};
}
