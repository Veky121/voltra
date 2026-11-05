/** Canonical LAN setup only; historical native receipts are not current-helper acceptance. */
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { hash } from './runner.mjs';
export const L4D_BASE_BUILD='f78390ea7a4ab8d11352ba1698255879ddf46794a84545a792a1249ad31e4b45';
export const L4D_BUILD='ff6b7d0373b206bd1c448d645620503002b218fcab9d1a8ed74d82caeb090d80';
export const L4D_SNAPSHOT=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-21/build-input-1793674979520');
const L4D_SNAPSHOT22=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-22/build-input-1793678490224');
export const l4dSnapshot=build=>build===L4D_BASE_BUILD?L4D_SNAPSHOT:build===L4D_BUILD?L4D_SNAPSHOT22:null;
export const l4dIdentity=(id,build)=>['l4d-canonical','l4d2-canonical'].includes(id)&&!!l4dSnapshot(build);
const specs={l4d:{recipe:'left4dead/egg-left4dead.json',app:222840,folder:'left4dead',map:'l4d_hospital01_apartment'},l4d2:{recipe:'left4dead_2/egg-left4dead_2.json',app:222860,folder:'left4dead2',map:'c1m1_hotel'}};
const historicalPins={"l4d":"1c49ce250575d31d50f20288a923b5057e7fcc81c89c611fe18db8c67cd9b70f","l4d2":"931900f79c9db3c229df0ea0b68ad349ab7a5c5fd81be0975325076c8db0942e"};
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
const spec=ctx=>specs[ctx.game.id.replace(/-canonical$/,'')];
export function verifyL4DPrior(ctx,report,raw,pin,frozen){
 const s=spec(ctx),p=h.profileFromRuntime(s.recipe,receipt),family=ctx.game.id.replace(/-canonical$/,'');
 if(!l4dIdentity(ctx.game.id,ctx.build)||receipt?.binary_sha256!==ctx.build||resolve(receipt.snapshot)!==l4dSnapshot(ctx.build)
  ||resolve(pin.path)!==resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/'+family+'-live-acceptance.json')||pin.sha256!==historicalPins[family]||hash(raw)!==pin.sha256
  ||report.recipe!==s.recipe||report.release?.appid!==s.app||report.release.StateFlags!==4||report.reinstall?.all_hashes_and_posix_metadata_preserved!==true
  ||(family==='l4d'?report.restored?.exit_code:report.private_versus?.exit_code)!==0
  ||frozen?.nativeCurrentPending!==true||frozen.historicalSourceEquivalent!==false
  ||hash(JSON.stringify(sorted(p)))!==frozen.profileSHA256||hash(p.egg.scripts.installation.script)!==frozen.scriptSHA256)throw Error('Exact L4D historical research/current-pending frozen source required');
}
export function verifyL4DMetadata(actual,expected){
 if(actual.length!==expected.length)throw Error('L4D Startup control count differs');
 for(const v of expected){const rows=actual.filter(a=>a.env_variable===v.env_variable);if(rows.length!==1||['name','description','default_value','rules','user_viewable','user_editable','field_type'].some(k=>rows[0][k]!==v[k]))throw Error('L4D exact supported Startup metadata differs: '+v.env_variable);}
 const env=Object.fromEntries(expected.map(v=>[v.env_variable,String(v.default_value)]));
 if(env.PUBLIC_SERVER!=='0'||env.STEAM_GSLT!==''||env.RCON_PASSWORD!==''||env.SERVER_PASSWORD!==''||env.GAMEMODE!=='coop'||env.DIFFICULTY!=='Normal'||env.AUTO_UPDATE!=='0')throw Error('L4D canonical LAN/private controls differ');
}
export function verifyL4DExposure(body){
 if(!body.revision||!Array.isArray(body.fields))throw Error('L4D existing readonly settings document absent');
 if(body.fields.some(f=>!(f.readonly===true||f.readOnly===true||f.read_only===true)))throw Error('L4D deliberately unsupported writable file control exposed');
 return {readonlyFields:body.fields.map(f=>f.key),writableFields:[],scope:'Existing file observations only; supported configuration changes use Startup'};
}
export async function verifyL4DRefusal(ctx,api){
 const s=spec(ctx),base='/api/client/servers/'+ctx.fixture.server.uuid,file='/'+s.folder+'/cfg/server.cfg',url=base+'/game-settings?file='+encodeURIComponent(file);
 const response=await api(url),body=response.attributes??response,before=await api(base+'/files/contents?file='+encodeURIComponent(file),'GET',undefined,true);
 verifyL4DExposure(body);let status;
 try{await api(url,'PUT',{revision:body.revision,settings:{sv_alltalk:'1'}});}catch(error){if(![400,422].includes(error.status))throw error;status=error.status;}
 if(!status||await api(base+'/files/contents?file='+encodeURIComponent(file),'GET',undefined,true)!==before)throw Error('L4D readonly mutation/insertion refusal unproved');
 return {status,bytesUnchanged:true,insertedField:false,nativeSettingConsumption:false};
}
export async function verifyL4DInstalled(ctx){
 const s=spec(ctx),f=ctx.fixture,p=h.profileFromRuntime(s.recipe,receipt);
 if(!l4dIdentity(ctx.game.id,ctx.build)||!l4dIntentBuildAllowed(ctx)||!f.canonicalBootstrap?.complete)throw Error('L4D exact21 stopped bootstrap required');
 const helpers=Object.fromEntries([...p.egg.scripts.installation.script.matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>[m[1],hash(m[3]+'\n')]));
 const ids=(await docker(['ps','-aq','--filter','name='+f.server.uuid],ctx.signal)).trim().split(/\s+/).filter(Boolean);if(ids.length!==1)throw Error('L4D stopped container ambiguous');
 const [n]=JSON.parse(await docker(['inspect',ids[0]],ctx.signal)),source='/var/lib/voltra-parity-20261029/volumes/'+f.server.uuid;
 if(n.Name!=='/'+f.server.uuid||n.State.Running||n.Config.Image!==f.intent.request.image||n.Mounts.filter(m=>m.Destination==='/home/container'&&m.Source===source).length!==1||n.Mounts.some(m=>m.Destination.startsWith('/home/container/')))throw Error('L4D exact stopped owned volume differs');
 const script=String.raw`import hashlib,json,re,stat
from pathlib import Path
r=Path('/home/container');helpers=${JSON.stringify(helpers)}
def digest(name,maximum=536870912):
 p=r/name
 for x in [p,*p.parents]:
  if x==r.parent:break
  if x.is_symlink():raise ValueError('symlink native file')
 s=p.stat()
 if not stat.S_ISREG(s.st_mode) or s.st_size>maximum:raise ValueError('invalid native file')
 h=hashlib.sha256()
 with p.open('rb') as stream:
  for b in iter(lambda:stream.read(1048576),b''):h.update(b)
 return h.hexdigest()
actual={k:digest(k,8388608) for k in helpers}
if actual!=helpers:raise ValueError('frozen helpers differ')
manifest='steamapps/appmanifest_${s.app}.acf';digest(manifest,8388608);raw=(r/manifest).read_text()
def field(name):
 rows=re.findall(r'"'+name+r'"\s+"([^"]+)"',raw)
 if len(rows)!=1:raise ValueError('ambiguous Steam manifest')
 return rows[0]
if field('appid')!='${s.app}' or field('StateFlags')!='4' or not field('buildid').isdigit():raise ValueError('incomplete Steam publication')
files={p:digest(p) for p in ['srcds_linux','${s.folder}/maps/${s.map}.bsp','${s.folder}/cfg/server.cfg','${s.folder}/cfg/voltra-managed.cfg','${s.folder}/cfg/voltra-variant.cfg']}
print(json.dumps(dict(helpers=actual,files=files,appid=field('appid'),buildid=field('buildid'),complete=True)))`;
 const result=JSON.parse(await docker(['run','--rm','--pull','never','--network','none','--read-only','--user',n.Config.User||'0','--memory','256m','--memory-swap','256m','--cpus','1','--cap-drop','ALL','--security-opt','no-new-privileges','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib','--mount','type=bind,src='+source+',dst=/home/container,readonly','--entrypoint','/home/container/.voltra/python/bin/python3',n.Image,'-B','-c',script],ctx.signal,30000));
 return {...result,scope:'Fresh canonical Steam publication/map/config identity only; current native protocol/settings/reinstall acceptance pending',gameDownloadCacheClaim:false};
}

const bridgeChanges=['internal/panel/game_settings_campaign_authority.go','internal/panel/game_settings_discovery.go','internal/panel/game_settings_l4d_readonly_dispatch_test.go','internal/panel/game_settings_l4d_readonly.go'].sort();
function l4dInstallReceiptValid(f,original){return f.install?.rawExit==='0'&&f.install.callback?.success===true&&f.install.logsFollowed===true&&f.install.memoryValid===true&&f.install.removed===true&&f.install.scriptHash===hash(original)&&(!f.install.canonicalScriptSha256||f.install.canonicalScriptSha256===hash(original));}
export function l4dInstallerScriptAllowed(ctx,original,actual){
 if(actual===original)return true;
 const f=ctx.fixture;
 if(ctx.game.id!=='l4d2-canonical'||!l4dIdentity(ctx.game.id,ctx.build)||!l4dInstallReceiptValid(f,original)||f.install.canonicalScriptSha256!==hash(original)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(f.gateId??''))return false;
 return actual===h.installerGate(original,f.gateId).replace(/\n$/,'');
}
export function l4dIntentBuildAllowed(ctx){
 const f=ctx.fixture;if(f?.intent?.build===ctx.build)return true;
 const proof=ctx.l4dSourceEquivalence;
 return ctx.build===L4D_BUILD&&f?.intent?.build===L4D_BASE_BUILD&&proof?.targetBuild===ctx.build&&proof.serverUUID===f.server.uuid&&proof.serverId===f.server.id&&proof.intentSHA256===hash(JSON.stringify(sorted(f.intent)));
}
export async function verifyL4DSourceEquivalence(ctx,bridge){
 if(ctx.build!==L4D_BUILD||!ctx.fixture||bridge?.baseBuild!==L4D_BASE_BUILD||bridge.targetBuild!==L4D_BUILD||resolve(bridge.baseSnapshot)!==L4D_SNAPSHOT||resolve(bridge.targetSnapshot)!==L4D_SNAPSHOT22||bridge.baseManifestSHA256!=='0c213b4bb59ea0b1ce6073a18b8896650a66812a6ba0725526cd39536b1b771e'||bridge.targetManifestSHA256!=='1440ae7f76f256084fd50ebda562327557dd928da3eeeb27911687607d0ffd61')throw Error('Exact reviewed L4D21-to22 bridge required');
 const manifests=[];
 for(const [snapshot,pin]of [[L4D_SNAPSHOT,bridge.baseManifestSHA256],[L4D_SNAPSHOT22,bridge.targetManifestSHA256]]){
  const raw=await readFile(resolve(snapshot,'snapshot-manifest.json'),'utf8');if(hash(raw)!==pin)throw Error('L4D bridge manifest changed');const entries=JSON.parse(raw).inputs,map=new Map(entries.map(x=>[x.path,x.sha256]));if(map.size!==entries.length)throw Error('Duplicate snapshot input');manifests.push(map);
 }
 const changed=[...new Set([...manifests[0].keys(),...manifests[1].keys()])].filter(p=>manifests[0].get(p)!==manifests[1].get(p)).sort();
 if(JSON.stringify(changed)!==JSON.stringify(bridgeChanges)||JSON.stringify([...bridge.changedPaths].sort())!==JSON.stringify(bridgeChanges))throw Error('Unreviewed source delta in L4D bridge');
 const recipe=spec(ctx).recipe,profileBytes=[];
 for(const [index,snapshot]of [L4D_SNAPSHOT,L4D_SNAPSHOT22].entries()){
  const raw=await readFile(resolve(snapshot,'internal/panel/game_library/overrides.json'),'utf8');if(hash(raw)!==manifests[index].get('internal/panel/game_library/overrides.json'))throw Error('L4D bridge source bytes changed');profileBytes.push(JSON.stringify(sorted(JSON.parse(raw)[recipe])));
 }
 if(profileBytes[0]!==profileBytes[1]||profileBytes[1]!==JSON.stringify(sorted(h.profileFromRuntime(recipe,receipt))))throw Error('L4D profile/helpers/egg identity changed');
 const pin=bridge.priorFixture;if(!pin?.path||!/^[a-f0-9]{64}$/.test(pin.sha256??''))throw Error('Reviewed original L4D fixture pin required');
 const raw=await readFile(resolve(pin.path),'utf8');if(hash(raw)!==pin.sha256)throw Error('Original L4D fixture receipt changed');const old=JSON.parse(raw),f=ctx.fixture,p=h.profileFromRuntime(recipe,receipt),script=p.egg.scripts.installation.script;
 if(old.game!==ctx.game.id||old.build!==L4D_BASE_BUILD||old.fixture?.server?.id!==bridge.serverId||old.fixture.server.uuid!==bridge.serverUUID||f.server.id!==bridge.serverId||f.server.uuid!==bridge.serverUUID||f.recipe!==recipe||f.intent.build!==L4D_BASE_BUILD||JSON.stringify(sorted(old.fixture.intent))!==JSON.stringify(sorted(f.intent))||JSON.stringify(sorted(old.fixture.install))!==JSON.stringify(sorted(f.install))||old.fixture.egg.uuid!==f.egg.uuid||!l4dInstallReceiptValid(f,script))throw Error('Original L4D21 identity/installer evidence differs');
 if(ctx.game.id==='l4d-canonical'){
  if(old.status!=='FAIL'||old.checks.find(c=>c.name==='canonical-native-install')?.status!=='PASS'||old.checks.find(c=>c.name==='canonical-first-boot')?.status!=='PASS'||old.checks.find(c=>c.name==='served-game-settings')?.status!=='FAIL'||old.fixture.canonicalBootstrap?.complete!==true||old.fixture.canonicalBootstrap.parking?.state?.ExitCode!==0)throw Error('Exact L4D21 install/bootstrap PASS and metadata failure required');
 }else if(old.status!=='PASS'||old.checks.find(c=>c.name==='canonical-install-retry')?.status!=='PASS'||old.checks.find(c=>c.name==='installation-only-scope')?.status!=='PASS'||old.fixture.gateId!==f.gateId||f.install.canonicalScriptSha256!==hash(script))throw Error('Exact L4D2 observed warm reinstall-only receipt required');
 const proof={baseBuild:L4D_BASE_BUILD,targetBuild:L4D_BUILD,serverUUID:f.server.uuid,serverId:f.server.id,priorFixture:pin,changedPaths:changed,profileAndHelpersEqual:true,canonicalEggIdentityRetained:true,intentSHA256:hash(JSON.stringify(sorted(f.intent))),originalIntentPreserved:true,installerEvidenceReusedFrom21:true,new22InstallerClaim:false,nativeCurrentPending:true};ctx.l4dSourceEquivalence=proof;return proof;
}
