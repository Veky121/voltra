/** Canonical OpenWorld setup only. Historical native evidence is not current acceptance. */
import { resolve } from 'node:path';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { hash } from './runner.mjs';
export const OPENWORLD_BUILD='f78390ea7a4ab8d11352ba1698255879ddf46794a84545a792a1249ad31e4b45';
export const OPENWORLD_SNAPSHOT=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-21/build-input-1793674979520');
export const openworldIdentity=(id,build)=>id==='rimworld_openworld-canonical'&&build===OPENWORLD_BUILD;
export const openworldRecipe='rimworld/open_world/egg-rimworld-open-world.json';
const historical=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/rimworld-openworld-native-acceptance.json');
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
export function verifyOpenWorldPrior(ctx,report,raw,pin,frozen){
 const profile=h.profileFromRuntime(openworldRecipe,receipt);
 if(!openworldIdentity(ctx.game.id,ctx.build)||receipt?.binary_sha256!==OPENWORLD_BUILD||resolve(receipt.snapshot)!==OPENWORLD_SNAPSHOT
  ||resolve(pin.path)!==historical||pin.sha256!=='1e2cfaa8a0a51b5c62687b4e72b9c3df0cc75805eaf062c8eca6a55bd39d1bd5'||hash(raw)!==pin.sha256||report.game!==openworldRecipe||report.version!=='v1.0.4'
  ||report.native_protocol?.response!=='WrongVersionPacket'||report.native_stop?.exit_code!==0||report.native_stop.forced_kill_used!==false
  ||report.engine_binary_sha256!=='c20b6e98674a339bff4ffa3f4a729672338c23ee68755a7cceab63b21a7dc83c'
  ||report.publisher_release?.archive?.sha256!=='dba0571b82ea2df2762d1b7640d58ee64be1290d0b22248d606c729ac1347d22'
  ||frozen?.nativeCurrentPending!==true||frozen.historicalSourceEquivalent!==false
  ||hash(JSON.stringify(sorted(profile)))!==frozen.profileSHA256||hash(profile.egg.scripts.installation.script)!==frozen.scriptSHA256)
  throw Error('Exact OpenWorld historical research/current-pending source boundary required');
}
export function verifyOpenWorldConfig(text,port){
 const c=JSON.parse(text.replace(/^\uFEFF/,''));
 if(c.LocalAddress!=='0.0.0.0'||c.ServerPort!==port||c.MaxPlayers!==10||c.PlayerVersion!=='1.3'||['EnforceMods','UseModBlacklist','UseCustomDifficulty','UseWhitelist','AllowCustomScenarios'].some(k=>c[k]!==false))throw Error('OpenWorld exact canonical defaults differ');
 return {defaultConfigConfirmed:true,scope:'Generated standalone mod configuration only; native protocol/settings/retention pending'};
}
export function verifyOpenWorldExposure(body){
 if(!body.revision)throw Error('OpenWorld settings revision missing');
 for(const [key,type] of Object.entries({'/MaxPlayers':'number','/EnforceMods':'boolean','/UseModBlacklist':'boolean','/UseCustomDifficulty':'boolean','/UseWhitelist':'boolean','/AllowCustomScenarios':'boolean','/LocalAddress':'readonly','/ServerPort':'readonly','/PlayerVersion':'readonly'})){
  const rows=body.fields?.filter(f=>f.key===key);
  if(rows?.length!==1||rows[0].type!==type||(type==='readonly'?rows[0].readonly!==true:rows[0].readonly===true))throw Error('OpenWorld existing typed authority differs: '+key);
 }
}
export async function verifyOpenWorldInstalled(ctx){
 const f=ctx.fixture;
 if(!openworldIdentity(ctx.game.id,ctx.build)||!f.canonicalBootstrap?.complete)throw Error('OpenWorld exact21 stopped bootstrap required');
 const ids=(await docker(['ps','-aq','--filter','name='+f.server.uuid],ctx.signal)).trim().split(/\s+/).filter(Boolean);
 if(ids.length!==1)throw Error('OpenWorld stopped container ambiguous');
 const [n]=JSON.parse(await docker(['inspect',ids[0]],ctx.signal));
 const source='/var/lib/voltra-parity-20261029/volumes/'+f.server.uuid;
 if(n.Name!=='/'+f.server.uuid||n.State.Running||n.Config.Image!==f.intent.request.image||n.Mounts.filter(m=>m.Destination==='/home/container'&&m.Source===source).length!==1||n.Mounts.some(m=>m.Destination.startsWith('/home/container/')))throw Error('OpenWorld exact stopped volume differs');
 const script=String.raw`
import hashlib,json,stat
from pathlib import Path
r=Path('/home/container')
def digest(name):
 p=r/name
 for x in [p,*p.parents]:
  if x==r.parent:break
  if x.is_symlink():raise ValueError('Symlink publication')
 s=p.stat()
 if not stat.S_ISREG(s.st_mode) or s.st_size>536870912:raise ValueError('Invalid publication')
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
proof=digest('OpenWorldServer');digest('.voltra/openworld/release.json')
release=json.loads((r/'.voltra/openworld/release.json').read_text())
digest('.voltra/dotnet-8/voltra-release.json')
runtime=json.loads((r/'.voltra/dotnet-8/voltra-release.json').read_text())
print(json.dumps(dict(binarySHA256=proof,managedDLLSHA256=digest('OpenWorldServer.dll'),runtime=runtime,release=release)))`;
 const result=JSON.parse(await docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--cap-drop','ALL','--security-opt','no-new-privileges','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib','--mount','type=bind,src='+source+',dst=/home/container,readonly','--entrypoint','/home/container/.voltra/python/bin/python3',n.Image,'-B','-c',script],ctx.signal,30000));
 if(result.managedDLLSHA256!=='e68fb71532f745511452f7982304cf098a9f91855e1f7f202268c5dfeae7ee7a'||result.runtime?.version!=='8.0.32'||result.runtime.sha256!=='bde0bb08f1f10d6dd60d0c3d8a220e33d7ce6d1c74c7098cf7f6a4e1a1ef5137')throw Error('OpenWorld managed DLL/runtime publication differs');
 const release=result.release;
 if(result.binarySHA256!=='c20b6e98674a339bff4ffa3f4a729672338c23ee68755a7cceab63b21a7dc83c'||release.game!=='openworld'||release.version!=='v1.0.4'||release.archive?.sha256!=='dba0571b82ea2df2762d1b7640d58ee64be1290d0b22248d606c729ac1347d22'||release.archive.bytes!==329666||release.binary_sha256!==result.binarySHA256)throw Error('OpenWorld installed official binary/release differs');
 return {...result,scope:'Exact installed publisher binary/source only; fresh native protocol/settings/retention remain pending'};
}
