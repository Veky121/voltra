/** Canonical Together setup only. Historical native evidence is not current acceptance. */
import { resolve } from 'node:path';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { hash } from './runner.mjs';
export const TOGETHER_BUILD='f78390ea7a4ab8d11352ba1698255879ddf46794a84545a792a1249ad31e4b45';
export const TOGETHER_SNAPSHOT=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-21/build-input-1793674979520');
export const togetherIdentity=(id,build)=>id==='rimworld_together-canonical'&&build===TOGETHER_BUILD;
export const togetherRecipe='rimworld/together/egg-rimworld-together.json';
const historical=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/rimworld-together-native-acceptance.json');
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
export function verifyTogetherPrior(ctx,report,raw,pin,frozen){
 const profile=h.profileFromRuntime(togetherRecipe,receipt);
 if(!togetherIdentity(ctx.game.id,ctx.build)||receipt?.binary_sha256!==TOGETHER_BUILD||resolve(receipt.snapshot)!==TOGETHER_SNAPSHOT
  ||resolve(pin.path)!==historical||pin.sha256!=='e31f8e39732b8d5da3f0b9c1c30360bbd44ca26b02e9b345c8a15f4fdcf47949'||hash(raw)!==pin.sha256||report.game!==togetherRecipe||report.version!=='26.10.20.1_(1)'
  ||report.native_protocol?.response!=='Handshake.Deny'||report.native_stop?.exit_code!==0||report.native_stop.forced_kill_used!==false
  ||report.engine_binary_sha256!=='c46c3b6a83e884eb6156bdd3acc897c35768644e69fa905f057cb4fe647d237c'
  ||report.publisher_release?.archive?.sha256!=='f4ede1e26d574e83cfdda91d441d1f3e204abea700db5dede8ac4fc35c3fd324'
  ||frozen?.nativeCurrentPending!==true||frozen.historicalSourceEquivalent!==false
  ||hash(JSON.stringify(sorted(profile)))!==frozen.profileSHA256||hash(profile.egg.scripts.installation.script)!==frozen.scriptSHA256)
  throw Error('Exact Together historical research/current-pending source boundary required');
}
export function verifyTogetherConfig(text,port){
 const c=JSON.parse(text.replace(/^\uFEFF/,''));
 if(c.IP!=='0.0.0.0'||c.Port!==port||c.MaxPlayers!==100||c.Name!=='RimWorld Together Server'||c.Verbosity!==0||c.EnableServerBrowser!==false||c.EnableServerTelemetry!==false||c.UseUPnP!==false)throw Error('Together canonical native configuration differs');
 return {defaultConfigConfirmed:true,privateListing:true,telemetry:false,upnp:false,scope:'Generated canonical settings only; fresh protocol/native retention pending'};
}
export function verifyTogetherExposure(body){
 if(!body.revision)throw Error('Together native settings revision missing');
 for(const [key,type] of Object.entries({'/MaxPlayers':'number','/Verbosity':'number','/Name':'text','/EnableServerBrowser':'boolean','/EnableServerTelemetry':'boolean','/IP':'readonly','/Port':'readonly','/UseUPnP':'readonly'})){
  const rows=body.fields?.filter(f=>f.key===key);
  if(rows?.length!==1||rows[0].type!==type||(type==='readonly'?rows[0].readonly!==true:rows[0].readonly===true))throw Error('Together exact existing typed authority differs: '+key);
 }
}
export async function verifyTogetherInstalled(ctx){
 const f=ctx.fixture;
 if(!togetherIdentity(ctx.game.id,ctx.build)||!f.canonicalBootstrap?.complete)throw Error('Together exact21 stopped bootstrap required');
 const ids=(await docker(['ps','-aq','--filter','name='+f.server.uuid],ctx.signal)).trim().split(/\s+/).filter(Boolean);
 if(ids.length!==1)throw Error('Together stopped container ambiguous');
 const [n]=JSON.parse(await docker(['inspect',ids[0]],ctx.signal));
 const source='/var/lib/voltra-parity-20261029/volumes/'+f.server.uuid;
 if(n.Name!=='/'+f.server.uuid||n.State.Running||n.Config.Image!==f.intent.request.image||n.Mounts.filter(m=>m.Destination==='/home/container'&&m.Source===source).length!==1||n.Mounts.some(m=>m.Destination.startsWith('/home/container/')))throw Error('Together exact stopped volume differs');
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
proof=digest('RimworldTogether/RTServer');digest('.voltra/together/release.json')
release=json.loads((r/'.voltra/together/release.json').read_text())
print(json.dumps(dict(binarySHA256=proof,release=release)))`;
 const result=JSON.parse(await docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--cap-drop','ALL','--security-opt','no-new-privileges','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib','--mount','type=bind,src='+source+',dst=/home/container,readonly','--entrypoint','/home/container/.voltra/python/bin/python3',n.Image,'-B','-c',script],ctx.signal,30000));
 const release=result.release;
 if(result.binarySHA256!=='c46c3b6a83e884eb6156bdd3acc897c35768644e69fa905f057cb4fe647d237c'||release.game!=='together'||release.version!=='26.10.20.1_(1)'||release.archive?.sha256!=='f4ede1e26d574e83cfdda91d441d1f3e204abea700db5dede8ac4fc35c3fd324'||release.archive.bytes!==31679969||release.binary_sha256!==result.binarySHA256)throw Error('Together installed official binary/release differs');
 return {...result,scope:'Exact installed publisher binary/source only; fresh native protocol/settings/retention remain pending'};
}
