import {createHash} from 'node:crypto';
import {campaign as h,docker} from './campaign-session.mjs';
import {native,logs,wait} from './campaign-adapter.mjs';
import {recipe,installedSource,archiveSHA,binarySHA,pins as lacPins} from './lac-canonical-check.mjs';
export {installedSource};
export {verifyBuild} from './game-checks.mjs';
export const registration={lac:{recipe,ports:1,environment:{VER:'1.9.7',PUBLIC_SERVER:'false',LAC_ARCHIVE_SHA256:'',MAX_PLAYERS:'7',MAP_NAME:'TrainFacility',SERVER_LANGUAGE:'German',SERVER_PASSWORD:'none',ADMIN_CODE:''}}};
export const budgets={memoryMiB:1536,diskMiB:2048,startupMs:180000,stopMs:90000};
export const retentionRequiredPath='/.config/unity3d/MA/LAC/ServerConfig.txt';
const helper='sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8',proofs=new WeakMap(),contexts=new WeakMap();
const sha=x=>createHash('sha256').update(x).digest('hex');
const scope='Idle native LAC1.9.7 Unity2022.3.62f3: Startup controls applied to publisher-loaded config, allocated UDP binding, native SIGTERM teardown/exit0, initialized preferences/config/skins retention. No independent query protocol, writable gameplay document, cap enforcement, external player, gameplay/editor-world, public listing or WAN claim.';
function owned(ctx){const f=ctx.fixture;if(ctx.game.family!=='lac'||ctx.game.recipe!==recipe||f?.recipe!==recipe||f.server?.uuid!==ctx.game.serverUUID||f.server.name!=='validator-'+ctx.game.id||f.ports?.length!==1||ctx.game.testStartup)throw Error('Exact owned isolated LAC fixture required');return f;}
async function observe(ctx,process=false){
 const f=owned(ctx),n=await native(ctx);if(!n)throw Error('Owned LAC container absent');const [d]=JSON.parse(await docker(['inspect',n.id],ctx.signal)),source='/var/lib/voltra-parity-20261029/volumes/'+f.server.uuid;
 if(d.Name!=='/'+f.server.uuid||d.Mounts.filter(m=>m.Source===source&&m.Destination==='/home/container').length!==1||d.Mounts.some(m=>m.Destination.startsWith('/home/container/'))||ctx.game.offlineHelperImage!==helper)throw Error('Exact LAC readonly observer boundary differs');
 const script=String.raw`import pathlib,json,hashlib,stat,os,re
r=pathlib.Path('/source')
def safe(p):
 for q in [p,*p.parents]:
  if q==r.parent:break
  assert not q.is_symlink(),'symlink publisher/state refused'
def meta(p,limit=268435456):
 safe(p);a=p.stat();assert stat.S_ISREG(a.st_mode) and a.st_size<=limit
 with p.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
 b=p.stat();assert (a.st_ino,a.st_size,a.st_mtime_ns)==(b.st_ino,b.st_size,b.st_mtime_ns),'file changed during observation'
 return dict(sha256=digest,bytes=b.st_size,mode=stat.S_IMODE(b.st_mode),uid=b.st_uid,gid=b.st_gid)
publication=r/'.voltra/open-world-lac/release.json';safe(publication);assert publication.stat().st_size<1048576;release=json.loads(publication.read_text())
assert release['game']=='open-world-lac' and release['version']=='1.9.7' and release['sha256']=='85a2592a3fafc3d92bb1021f860f29c7b4debb0869fd313cf16ce3db7f96eb8e' and release['bytes']==159821766
assert release['url']=='https://www.lacrimesonline.com/builds/LAC_Linux_v1.9.7.zip'
assert len(release['files'])<5000 and release['binary_sha256']=='2f4534b3534d61c843a7f20cbd5df7c2deef9fb0211d60ea362cda7bdecdeabc'
publisher={}
for name,expected in release['files'].items():
 assert not pathlib.PurePosixPath(name).is_absolute() and '..' not in pathlib.PurePosixPath(name).parts
 p=r/name;item=meta(p);assert item['sha256']==expected,'installed publisher file differs';publisher[name]=item['sha256']
assert publisher.get('LAC_Linux_v1.9.7.x86_64')==release['binary_sha256'] and 'UnityPlayer.so' in publisher
directory=r/'.config/unity3d/MA/LAC';safe(directory);assert directory.is_dir();paths=list(directory.rglob('*'));assert len(paths)<=2000
for p in paths:safe(p)
manifest={str(p.relative_to(r)):meta(p,16777216) for p in paths if p.is_file()};config=directory/'ServerConfig.txt';raw=config.read_text(encoding='utf-8-sig');values={}
for line in raw.splitlines():
 if '=' in line and not line.lstrip().startswith('#'):
  key,value=line.split('=',1);key=key.strip().lower();assert key not in values;values[key]=value.strip()
public={k:values[k] for k in ['starting port','max players','map name','share to community','server language']}
# Diagnostic only: all raw prefs bytes remain part of strict retention.
# No session field is excluded until its exact publisher writer is proved.
prefs=None
prefsFile=directory/'prefs'
if prefsFile.exists():
 import xml.etree.ElementTree as ET,base64
 safe(prefsFile);prefsRaw=prefsFile.read_bytes();assert len(prefsRaw)<=1048576 and b'<!DOCTYPE' not in prefsRaw.upper() and b'<!ENTITY' not in prefsRaw.upper(),'unsafe/oversized Unity prefs XML'
 unity=r/'UnityPlayer.so';assert publisher['UnityPlayer.so']=='98c1fd2f5eca3ba743f3c4648172b98245dc2f6fe445eb442e6153a4f909a83e','reviewed Unity session binary differs';unityBytes=unity.read_bytes();assert all(unityBytes.count(key)==1 for key in [b'unity.player_session_count',b'unity.player_sessionid']),'Unity-owned session keys absent/ambiguous';del unityBytes
 tree=ET.fromstring(prefsRaw);assert tree.tag=='unity_prefs' and len(tree)<=512,'unsupported prefs XML root/count'
 fields=[];seen=set();sessionCounter=None;sessionIdSHA=None;sessionIdValid=False
 for item in tree:
  key=item.attrib.get('name');kind=item.attrib.get('type');assert item.tag=='pref' and isinstance(key,str) and len(key)<=256 and key not in seen and kind in ['string','int','float'] and len(item)==0,'unsafe/duplicate prefs entry'
  seen.add(key);encoded=item.text or '';assert len(encoded)<=65536
  value=base64.b64decode(encoded,validate=True) if kind=='string' else encoded.encode();digest=hashlib.sha256(value).hexdigest()
  fields.append(dict(key=key,type=kind,valueSHA256=digest,valueBytes=len(value),encodedTextSHA256=hashlib.sha256(encoded.encode()).hexdigest(),attributesSHA256=hashlib.sha256(json.dumps(item.attrib,sort_keys=True,separators=(',',':')).encode()).hexdigest()))
  if key=='unity.player_session_count':
   number=value.decode('ascii');assert number.isdigit() and len(number)<=16;sessionCounter=int(number)
  if key=='unity.player_sessionid':
   sessionIdSHA=digest;sessionIdText=value.decode('ascii');sessionIdValid=bool(re.fullmatch(r'-?[0-9]{1,20}',sessionIdText)) and -9223372036854775808<=int(sessionIdText)<=9223372036854775807 and int(sessionIdText)!=0
 maskedNames=[]
 def maskSession(m):maskedNames.append(m[2]);return m[1]+b'UNITY_SESSION_VALUE'+m[3]
 maskedPrefs=re.sub(rb'(<pref\b[^>]*\bname="(unity\.player_session_count|unity\.player_sessionid)"[^>]*>)[^<]*(</pref>)',maskSession,prefsRaw)
 assert sorted(maskedNames)==[b'unity.player_session_count',b'unity.player_sessionid'],'session XML value spans missing/ambiguous'
 fields.sort(key=lambda x:x['key']);prefs=dict(maskedRawSHA256=hashlib.sha256(maskedPrefs).hexdigest(),unityPlayerSHA256=publisher['UnityPlayer.so'],sessionIdValidSigned64=sessionIdValid,rawSHA256=hashlib.sha256(prefsRaw).hexdigest(),metadata=manifest[str(prefsFile.relative_to(r))],fields=fields,sessionCounter=sessionCounter,sessionIdSHA256=sessionIdSHA,semanticSHA256=hashlib.sha256(json.dumps(fields,sort_keys=True,separators=(',',':')).encode()).hexdigest(),scope='Only exact Unity-owned session counter/id may vary at native reload under separate strict semantic checks; installer bytes remain raw-strict')
engines=[];bound=False
if ${process ? 'True' : 'False'}:
 for p in pathlib.Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   if os.readlink(p/'exe')!='/home/container/LAC_Linux_v1.9.7.x86_64':continue
   args=(p/'cmdline').read_bytes().split(b'\0')[:-1];pp=int(next(x.split()[1] for x in (p/'status').read_text().splitlines() if x.startswith('PPid:')));parent=pathlib.Path('/proc')/str(pp);pargs=(parent/'cmdline').read_bytes().split(b'\0')[:-1]
   with (p/'exe').open('rb') as f:exeSHA=hashlib.file_digest(f,'sha256').hexdigest()
   sockets=set()
   for fd in list((p/'fd').iterdir())[:65536]:
    try:
     value=os.readlink(fd)
     if value.startswith('socket:['):sockets.add(value[8:-1])
    except FileNotFoundError:pass
   for table in ['udp','udp6']:
    for row in (p/'net'/table).read_text().splitlines()[1:]:
     fields=row.split()
     if fields[9] in sockets and int(fields[1].split(':')[1],16)==${f.ports[0]}:bound=True
   engines.append(dict(pid=int(p.name),ppid=pp,executableSHA256=exeSHA,direct=pargs[1:]==[b'.voltra/open_world_servers.py',b'run',b'lac'] and args==[b'/home/container/LAC_Linux_v1.9.7.x86_64'],cwd=os.readlink(p/'cwd')))
  except (FileNotFoundError,ProcessLookupError):pass
else:
 for name,item in manifest.items():assert meta(r/name,16777216)==item,'offline initialized state changed'
print(json.dumps(dict(prefs=prefs,publicationSHA256=meta(publication)['sha256'],publisher=publisher,manifest=manifest,config=public,configSHA256=manifest['.config/unity3d/MA/LAC/ServerConfig.txt']['sha256'],engines=engines,allocatedUdpBound=bound)))`;
 const args=['run','--rm','--pull','never','--network','none','--read-only','--user','0:0','--memory','256m','--cap-drop','ALL','--cap-add','DAC_READ_SEARCH','--cap-add','SYS_PTRACE'];if(d.State.Running)args.push('--pid','container:'+n.id);args.push('--mount','type=bind,src='+source+',dst=/source,readonly','--entrypoint','python3',helper,'-B','-c',script);
 const observation=JSON.parse(await docker(args,ctx.signal,60000)),[after]=JSON.parse(await docker(['inspect',n.id],ctx.signal));if(!d.State.Running&&(after.State.Running||after.State.StartedAt!==d.State.StartedAt||after.State.FinishedAt!==d.State.FinishedAt))throw Error('Offline LAC process changed');return observation;
}
async function startup(ctx,environment){owned(ctx);const s=(await h.api('/api/application/servers/'+ctx.fixture.server.id)).attributes;if(s.uuid!==ctx.fixture.server.uuid)throw Error('LAC Startup identity differs');await ctx.artifact('lac-startup-intent-'+Date.now()+'.json',{uuid:s.uuid,environment,scope:'Supported native Startup controls only; no gameplay-document PUT'});await h.api('/api/application/servers/'+s.id+'/startup','PATCH',{environment});const actual=(await h.api('/api/application/servers/'+s.id)).attributes;if(actual.uuid!==s.uuid||Object.entries(environment).some(([k,v])=>actual.container.environment[k]!==v))throw Error('LAC Startup readback differs');}
export async function prerequisites(ctx,c){owned(ctx);if(await c.state()!=='offline')throw Error('Parked LAC test fixture required');const source=await installedSource(ctx,c);await startup(ctx,{MAX_PLAYERS:'7',MAP_NAME:'TrainFacility',SERVER_LANGUAGE:'German',PUBLIC_SERVER:'false'});contexts.set(ctx,{edited:false});return {source,typedGameplayDocument:false,scope};}
export async function ready(ctx,c){const n=await native(ctx);if(!n?.state||Date.parse(n.state.StartedAt)<ctx.startRequestedAt)return false;if(!n.state.Running)throw Error('LAC exited before readiness');const text=await logs(ctx,n.state.StartedAt);if(!text.includes('[NetworkManager] Server Started.')||await c.state()!=='running')return false;if(!text.includes('ServerConfig.txt Loaded.')||!text.includes('2022.3.62f3'))throw Error('Native publisher config/Unity identity missing');const source=await installedSource(ctx,c),disk=await observe(ctx,true),edited=contexts.get(ctx)?.edited;if(disk.engines.length!==1||!disk.engines[0].direct||disk.engines[0].executableSHA256!==binarySHA||disk.engines[0].cwd!=='/home/container'||!disk.allocatedUdpBound)throw Error('LAC direct native engine/allocated UDP binding unproved');if(disk.config['starting port']!==String(ctx.fixture.ports[0])||disk.config['max players']!==(edited?'9':'7')||disk.config['map name']!==(edited?'Garage':'TrainFacility')||disk.config['share to community']!=='false'||disk.config['server language']!=='German')throw Error('LAC native loaded configuration differs');if(!text.includes(edited?'Garage':'TrainingFacility'))return false;const proof={containerId:n.id,startedAt:n.state.StartedAt,engine:disk.engines[0],source,publisher:disk.publisher};proofs.set(ctx,proof);await ctx.artifact('lac-process-'+Date.now()+'.json',{...proof,allocatedUdpBound:true,config:disk.config});return {...proof,scope};}
export function lacTeardown(text){
 const signals=[...text.matchAll(/Caught fatal signal - signo:([0-9]+)/g)].map(m=>Number(m[1])),signal=text.indexOf('Caught fatal signal - signo:15'),progress=text.indexOf('Input System module state changed to: ShutdownInProgress.',signal),thread=text.indexOf('Input System polling thread exited.',progress),complete=text.indexOf('Input System module state changed to: Shutdown.',thread);
 return signals.length>0&&signals.every(n=>n===15)&&signal>=0&&progress>signal&&thread>progress&&complete>thread&&!/grace expired|escalating owned process/i.test(text);
}
async function clean(ctx,c){const proof=proofs.get(ctx),n=await native(ctx);if(!proof||!n||n.id!==proof.containerId||n.state.StartedAt!==proof.startedAt||n.state.Running||n.state.ExitCode!==0||n.state.OOMKilled||n.state.Dead||await c.state()!=='offline')throw Error('LAC exact native exit0 unproved');const text=await logs(ctx,n.state.StartedAt),source=await installedSource(ctx,c),teardown=lacTeardown(text),sourceMatches=JSON.stringify(source)===JSON.stringify(proof.source);
 await ctx.artifact('lac-native-stop-'+Date.now()+'.json',{containerId:n.id,state:n.state,logSHA256:sha(text),teardown,sourceMatches,source,scope:'Pinned launcher translates Panel SIGINT to native SIGTERM; publisher emits signo15 then ordered Unity shutdown and raw child exit0. OnApplicationQuit stack text is optional, not an acknowledgement.'});
 if(!teardown||!sourceMatches)throw Error('LAC native SIGTERM teardown/source unproved');return {...proof,engineNumericExit:0,engineExitProven:true,nativeStop:n.state};}
export async function settings(ctx,c){await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','LAC settings stop',budgets.stopMs);await clean(ctx,c);await startup(ctx,{MAX_PLAYERS:'9',MAP_NAME:'Garage'});contexts.set(ctx,{edited:true});ctx.startRequestedAt=Date.now();await c.power('start');const fresh=await wait(ctx,()=>ready(ctx,c),'LAC Startup/native config reload',budgets.startupMs);return {changes:{MAX_PLAYERS:'9',MAP_NAME:'Garage'},fresh,typedGameplayDocument:false,capacityEnforcementClaim:false,scope};}
export function retentionPaths(ctx){owned(ctx);return ['/.config/unity3d/MA/LAC','/.voltra/open-world-lac/release.json',...Object.keys(lacPins).map(p=>'/'+p),'/LAC_Linux_v1.9.7.x86_64','/UnityPlayer.so'];}
export function restoreContext(ctx,saved){owned(ctx);if(!saved?.baseline?.manifest||!saved.processProof?.engine?.direct||saved.engineNumericExit!==0||!saved.engineExitProven)throw Error('LAC saved native proof missing');contexts.set(ctx,{edited:true});proofs.set(ctx,saved.processProof);}
export async function saved(ctx,c){if(!contexts.get(ctx)?.edited)throw Error('LAC consumed Startup settings proof absent');const stop=await clean(ctx,c),baseline=await observe(ctx);await ctx.artifact('lac-saved-prefs-'+Date.now()+'.json',{prefs:baseline.prefs,nativeStop:stop.nativeStop});return {...stop,processProof:stop,baseline,worldGameplaySaveClaimed:false,scope};}
export function unitySessionReload(before,after){
 const path='.config/unity3d/MA/LAC/prefs',a=before.prefs,b=after.prefs,all=[...new Set([...Object.keys(before.manifest),...Object.keys(after.manifest)])],changed=all.filter(k=>JSON.stringify(before.manifest[k])!==JSON.stringify(after.manifest[k]));
 if(changed.length!==1||changed[0]!==path||!a||!b||a.unityPlayerSHA256!=='98c1fd2f5eca3ba743f3c4648172b98245dc2f6fe445eb442e6153a4f909a83e'||b.unityPlayerSHA256!==a.unityPlayerSHA256||!a.maskedRawSHA256||a.maskedRawSHA256!==b.maskedRawSHA256)throw Error('Unapproved LAC native prefs/publisher byte delta');
 const oldMeta=before.manifest[path],newMeta=after.manifest[path];if(['mode','uid','gid'].some(k=>oldMeta[k]!==newMeta[k])||a.rawSHA256!==oldMeta.sha256||b.rawSHA256!==newMeta.sha256||!Number.isSafeInteger(a.sessionCounter)||b.sessionCounter!==a.sessionCounter+1||!a.sessionIdValidSigned64||!b.sessionIdValidSigned64||!a.sessionIdSHA256||a.sessionIdSHA256===b.sessionIdSHA256)throw Error('Unity session advance/identity/metadata differs');
 const oldFields=new Map(a.fields.map(f=>[f.key,f])),newFields=new Map(b.fields.map(f=>[f.key,f]));if(oldFields.size!==a.fields.length||newFields.size!==b.fields.length||JSON.stringify([...oldFields.keys()].sort())!==JSON.stringify([...newFields.keys()].sort()))throw Error('Prefs key identity changed');
 const allowed=['unity.player_session_count','unity.player_sessionid'];for(const [key,field]of oldFields){const next=newFields.get(key);if(allowed.includes(key)){if(field.type!=='string'||next.type!==field.type||next.attributesSHA256!==field.attributesSHA256)throw Error('Unity session field type/attributes changed');}else if(JSON.stringify(field)!==JSON.stringify(next))throw Error('Operator prefs changed: '+key);}if(allowed.some(k=>!oldFields.has(k)))throw Error('Unity session fields absent');if(oldFields.get(allowed[0]).valueSHA256!==sha(String(a.sessionCounter))||newFields.get(allowed[0]).valueSHA256!==sha(String(b.sessionCounter))||oldFields.get(allowed[1]).valueSHA256!==a.sessionIdSHA256||newFields.get(allowed[1]).valueSHA256!==b.sessionIdSHA256)throw Error('Unity session projection/hash inconsistent');
 const encodedLength=(fields,key)=>{const n=fields.get(key)?.valueBytes;if(!Number.isSafeInteger(n)||n<1||n>32)throw Error('Invalid Unity session value length');return 4*Math.ceil(n/3);};
 const expectedSizeDelta=allowed.reduce((n,key)=>n+encodedLength(newFields,key)-encodedLength(oldFields,key),0);if(newMeta.bytes-oldMeta.bytes!==expectedSizeDelta)throw Error('Unexpected prefs byte length delta');
 return {rawBeforeSHA256:a.rawSHA256,rawAfterSHA256:b.rawSHA256,maskedRawSHA256:a.maskedRawSHA256,counterBefore:a.sessionCounter,counterAfter:b.sessionCounter,sessionIdBeforeSHA256:a.sessionIdSHA256,sessionIdAfterSHA256:b.sessionIdSHA256,unityPlayerSHA256:a.unityPlayerSHA256,unchangedOtherKeys:oldFields.size-2,attribution:'Inference from exact pinned UnityPlayer binary owning both key strings, official Unity2022.3 AnalyticsSessionInfo semantics and issue UUM-82600; native proprietary writer was not reverse-engineered',sources:['https://docs.unity3d.com/2022.3/Documentation/ScriptReference/Analytics.AnalyticsSessionInfo-sessionCount.html','https://docs.unity3d.com/2022.3/Documentation/ScriptReference/Analytics.AnalyticsSessionInfo-sessionId.html','https://issuetracker.unity3d.com/issues/analyticssessioninfo-dot-sessionfirstrun-value-is-not-affected-when-the-corresponding-data-file-is-removed']};
}
export async function loaded(ctx,c,saved){restoreContext(ctx,saved);const fresh=await ready(ctx,c);if(!fresh||fresh.startedAt===saved.startedAt)throw Error('Fresh native LAC reload absent');await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','LAC reload stop',budgets.stopMs);const stop=await clean(ctx,c),after=await observe(ctx),keys=[...new Set([...Object.keys(saved.baseline.manifest),...Object.keys(after.manifest)])];await ctx.artifact('lac-reload-prefs-'+Date.now()+'.json',{before:saved.baseline.prefs??null,after:after.prefs,nativeStop:stop.nativeStop,strictByteComparison:true});if(keys.some(k=>JSON.stringify(saved.baseline.manifest[k])!==JSON.stringify(after.manifest[k]))){let session;try{session=unitySessionReload(saved.baseline,after);}catch{}if(session){await ctx.artifact('lac-native-unity-session-'+Date.now()+'.json',{session,beforeManifest:saved.baseline.manifest,afterManifest:after.manifest,beforePrefs:saved.baseline.prefs,afterPrefs:after.prefs,stop});return {fresh,stop,initializedFilesRetained:true,unitySession:session,worldGameplaySaveClaimed:false,scope};}await ctx.artifact('lac-reload-state-delta-'+Date.now()+'.json',{before:saved.baseline.manifest,after:after.manifest,stop});throw Error('LAC initialized config/preferences/skins changed across reload');}return {fresh,stop,initializedFilesRetained:true,worldGameplaySaveClaimed:false,scope};}
