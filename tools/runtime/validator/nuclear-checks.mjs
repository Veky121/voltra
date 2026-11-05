import dgram from 'node:dgram';
import {createHash,randomUUID} from 'node:crypto';
import {campaign as h,receipt,docker} from './campaign-session.mjs';
import {native,wait,logs} from './campaign-adapter.mjs';
export {verifyBuild} from './game-checks.mjs';

// New current publication/native execution is required. No LAN/unlisted claim.
const recipe='nuclear_option/egg-nuclear-option.json',file='/DedicatedServerConfig.json';
const image='ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8';
const startup='exec python3 .voltra/light_games_next_runtime.py nuclear';
const marker='[DedicatedServerManager] Waiting for Players before loading next map';
const testPassword='validator-nuclear-idle-only';
export const registration={nuclear:{recipe,ports:2,peakMiB:2048,installPeakMiB:3072,diskMiB:12288,environment:{SRCDS_APPID:'3930080',SERVER_NAME:'Validator Nuclear',MAX_PLAYERS:'8',AUTO_UPDATE:'1',MODDED_SERVER:'false',SERVER_PASSWORD:testPassword}}};
export const retentionRequiredPath=file;
export const nuclearEvidenceLimits=Object.freeze({players:false,missionProgress:false,worldSave:false,lanOrUnlisted:false,primaryUDPListenerClaim:false,p2pPeerSession:false,scope:'Idle native A2S/typed settings, actual clean engine stop and config/available operator mission-file retention only; password protection does not prove unlisted status'});
export const nuclearSourcePins={'.voltra/steam_template.py':'dc8ff0a9e462751878aad55da80bea8fd2a2d4ef16dbf8d37b798ea8d4c476dd','.voltra/native_config.py':'8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2','.voltra/native_console.py':'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5','.voltra/light_games_next_runtime.py':'a68150632890c8fc0238017fcacf1b3cb2f4bc28b5a3b8dbe603e73ee32b8074','.voltra/light_games_next_install.py':'9f73ffe51582d120ae72edc0dcd701da0232a9f480226250f308a1efec53dcbd'};
const pins=nuclearSourcePins;
const transportAssemblies={'NuclearOptionServer_Data/Managed/Assembly-CSharp.dll':'77273f08a13e466120f0484a79a648e33da9b92c5b66b0427a0916fbe2c2fa4c','NuclearOptionServer_Data/Managed/Mirage.SteamworksSocket.dll':'8d505f5c01897ad2ea07b6ef06845f1281e38727bf2a83d15c36fa1a9e005a21'};
export function nuclearTransportIdentity(state){
 if(state.config.SocketType!==null&&state.config.SocketType!==3)throw Error('Nuclear transport mode differs from reviewed default SteamGameServer');
 for(const [path,pin]of Object.entries(transportAssemblies))if(state.engineModules[path]?.sha256!==pin)throw Error('Nuclear publisher transport assembly changed; review current source');
 return {mode:'SteamGameServer',enumValue:3,configSocketType:state.config.SocketType,virtualListenPort:0,assemblies:transportAssemblies,physicalPrimaryUDPListenerClaim:false,p2pPeerSession:false};
}
export function nuclearTransportProof(state,text,ports){
 const identity=nuclearTransportIdentity(state);
 if(!text.includes('Setting Steam socket'))throw Error('Fresh native Steam socket factory selection log missing');
 if(!state.process?.direct||!state.process.udpPorts.includes(ports.query))throw Error('Nuclear direct native owned query UDP socket missing');
 return {identity,factoryLogObserved:true,queryPort:ports.query,queryUdpOwned:true,primaryUdpObserved:state.process.udpPorts.includes(ports.primary),scope:'Source-proven SteamGameServer P2P virtual listener0; no fixed primary UDP/P2P peer/WAN acceptance'};
}
const hash=x=>createHash('sha256').update(x).digest('hex'),contexts=new WeakMap(),processes=new WeakMap();
const attrs=x=>x?.attributes??x;
function owned(ctx){const f=ctx.fixture;if(ctx.game.family!=='nuclear'||ctx.game.recipe!==recipe||f?.recipe!==recipe||f.server.uuid!==ctx.game.serverUUID||f.server.name!=='validator-'+ctx.game.id||ctx.game.testStartup||f.ports?.length!==2||new Set(f.ports).size!==2||f.ports.some(p=>!Number.isInteger(p)||p<1025||p>65535))throw Error('Exact owned Nuclear fixture/two allocations required');return f;}
async function authority(ctx,c){
 const f=owned(ctx),p=h.profileFromRuntime(recipe,receipt),a=attrs(await h.api('/api/application/servers/'+f.server.id));
 if(!['f78390ea7a4ab8d11352ba1698255879ddf46794a84545a792a1249ad31e4b45','ff6b7d0373b206bd1c448d645620503002b218fcab9d1a8ed74d82caeb090d80'].includes(receipt?.binary_sha256)||a.uuid!==f.server.uuid||a.egg!==f.egg.id||a.name!==f.server.name||Number(a.node)===202||a.container?.image!==image||p.egg.startup!==startup||a.container.startup_command!==startup||p.egg.config.stop!=='^SIGTERM')throw Error('Nuclear exact source/image/launch differs');
 const emitted=Object.fromEntries([...p.egg.scripts.installation.script.matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>[m[1],hash(m[3]+'\n')]));
 for(const [path,pin]of Object.entries(pins))if(emitted[path]!==pin||hash(await c.read('/'+path))!==pin)throw Error('Nuclear emitted/installed helper differs: '+path);
 const env=a.container.environment,primary=f.allocation?.port??f.ports[0],query=Number(env.QUERY_PORT);
 if(!f.ports.includes(primary)||!f.ports.includes(query)||primary===query||env.SRCDS_APPID!=='3930080')throw Error('Nuclear query must select exact distinct allocated second port');
 return {primary,query,helpers:pins,automaticUpdate:['1','true'].includes(String(env.VOLTRA_STEAM_AUTO_UPDATE??env.AUTO_UPDATE??'1'))};
}
const route=ctx=>'/api/client/servers/'+owned(ctx).server.uuid+'/game-settings?file='+encodeURIComponent(file);
export async function prepareTestPassword(ctx,c){
 await authority(ctx,c);const n=await native(ctx);if(await c.state()!=='offline'||n?.state.Running)throw Error('Nuclear explicit test password requires stopped fixture');
 const before=attrs(await h.api(route(ctx)));if(!before.revision||!before.fields?.some(f=>f.key==='/Password'&&!(f.readonly||f.readOnly||f.read_only)))throw Error('Nuclear typed secret authority unavailable');
 await h.api(route(ctx),'PUT',{revision:before.revision,settings:{'/Password':testPassword}});
 if(JSON.parse(await c.read(file)).Password!==testPassword)throw Error('Nuclear test password disk readback failed');
 return {passwordConfigured:true,passwordSHA256:hash(testPassword),secretValueOmitted:true};
}
export async function prerequisites(ctx,c){const f=owned(ctx);if(f.install?.rawExit!=='0'||!f.install.callback?.success||!f.install.logsFollowed||!f.install.memoryValid||!f.install.removed)throw Error('Fresh observed publisher installer receipt required');const ports=await authority(ctx,c);const config=JSON.parse(await c.read(file));if(config.Password!==testPassword)throw Error('Run reviewed stopped prepareTestPassword before first native start; initialized config is seed-once and Startup does not overwrite its password');return {...ports,passwordConfigured:true,...nuclearEvidenceLimits};}

export function decodeNuclearInfo(data){
 if(!Buffer.isBuffer(data)||data.length<16||data.length>65507||data.readInt32LE(0)!==-1||data[4]!==73)throw Error('Invalid Nuclear A2S_INFO');
 let offset=6;const take=n=>{if(offset+n>data.length)throw Error('Truncated Nuclear A2S');const x=offset;offset+=n;return x;};const string=()=>{const end=data.indexOf(0,offset);if(end<offset||end-offset>4096)throw Error('Invalid Nuclear A2S string');const v=data.toString('utf8',offset,end);offset=end+1;return v;};
 const result={protocol:data[5],name:string(),map:string(),folder:string(),game:string()};let x=take(9);Object.assign(result,{appidLow16:data.readUInt16LE(x),players:data[x+2],maxPlayers:data[x+3],bots:data[x+4],serverType:String.fromCharCode(data[x+5]),environment:String.fromCharCode(data[x+6]),passwordRequired:!!data[x+7],vac:!!data[x+8],version:string()});
 if(offset<data.length){result.edf=data[take(1)];if(result.edf&128)result.port=data.readUInt16LE(take(2));if(result.edf&16)take(8);if(result.edf&64){take(2);string();}if(result.edf&32)result.keywords=string();if(result.edf&1)result.gameid=data.readBigUInt64LE(take(8)).toString();}
 if(offset!==data.length||result.folder!=='NuclearOption'||result.game!=='Nuclear Option Server'||result.environment!=='l'||result.serverType!=='d'||result.players!==0||result.bots!==0)throw Error('Nuclear idle publisher identity/zero-player boundary differs');return result;
}
async function query(ctx,port){
 const request=Buffer.concat([Buffer.from([255,255,255,255,84]),Buffer.from('Source Engine Query\0')]);
 const response=await new Promise((resolve,reject)=>{const socket=dgram.createSocket('udp4');let done=false,challenges=0;const finish=(error,data)=>{if(done)return;done=true;clearTimeout(timer);ctx.signal.removeEventListener('abort',abort);try{socket.close();}catch{}error?reject(error):resolve(data);};const abort=()=>finish(Error('Nuclear query aborted')),timer=setTimeout(()=>finish(Error('Nuclear A2S timeout')),5000);socket.on('error',()=>finish(Error('Nuclear UDP socket failed')));socket.on('message',(data,peer)=>{if(peer.address!=='127.0.0.1'||peer.port!==port)return;if(data.length===9&&data.readInt32LE(0)===-1&&data[4]===65){if(++challenges>2)return finish(Error('Nuclear repeated challenge'));socket.send(Buffer.concat([request,data.subarray(5)]),port,'127.0.0.1',e=>{if(e)finish(Error('Nuclear challenge send failed'));});return;}try{decodeNuclearInfo(data);finish(null,data);}catch(e){finish(e);}});ctx.signal.addEventListener('abort',abort,{once:true});if(ctx.signal.aborted)return abort();socket.send(request,port,'127.0.0.1',e=>{if(e)finish(Error('Nuclear query send failed'));});});
 return {...decodeNuclearInfo(response),packetSHA256:hash(response)};
}
async function snapshot(ctx,running=false){
 const f=owned(ctx),n=await native(ctx);if(!n||running&&!n.state.Running)throw Error('Nuclear native container absent');const [d]=JSON.parse(await docker(['inspect',n.id],ctx.signal));const source='/var/lib/voltra-parity-20261029/volumes/'+f.server.uuid;
 if(d.Name!=='/'+f.server.uuid||d.Config.Image!==image||d.Mounts.filter(m=>m.Destination==='/home/container'&&m.Source===source).length!==1||d.Mounts.some(m=>m.Destination.startsWith('/home/container/')))throw Error('Nuclear owned volume differs');
 const program=String.raw`import os,json,stat,hashlib,re,shutil
from pathlib import Path
r=Path('/home/container');pins=${JSON.stringify(pins)}
def observe(name,limit=536870912):
 p=r/name
 for x in [p,*p.parents]:
  if x==r.parent:break
  if x.is_symlink():raise ValueError('symlink native state')
 a=p.stat()
 if not stat.S_ISREG(a.st_mode) or a.st_size>limit:raise ValueError('invalid native state')
 h=hashlib.sha256()
 with p.open('rb') as stream:
  for b in iter(lambda:stream.read(1048576),b''):h.update(b)
 b=p.stat()
 if (a.st_ino,a.st_mtime_ns,a.st_size)!=(b.st_ino,b.st_mtime_ns,b.st_size):raise ValueError('native file changed')
 return dict(sha256=h.hexdigest(),bytes=b.st_size,mode=stat.S_IMODE(b.st_mode),uid=b.st_uid,gid=b.st_gid)
for name,pin in pins.items():
 if observe(name,8388608)['sha256']!=pin:raise ValueError('frozen helper differs')
observe('DedicatedServerConfig.json',4194304);config=json.loads((r/'DedicatedServerConfig.json').read_text(encoding='utf-8-sig'));releasePath='.voltra/steam-template-release.json';observe(releasePath,8388608);release=json.loads((r/releasePath).read_text())
if release.get('appid')!=3930080 or release.get('StateFlags')!=4 or release.get('platform')!='linux' or not isinstance(release.get('buildid'),int):raise ValueError('complete fresh Steam publication required')
observe('steamapps/appmanifest_3930080.acf',8388608);raw=(r/'steamapps/appmanifest_3930080.acf').read_text()
for key,value in [('appid','3930080'),('StateFlags','4'),('buildid',str(release['buildid']))]:
 matches=re.findall('"'+key+'"'+r'\s+"([^"]+)"',raw)
 if matches!=[value]:raise ValueError('Steam manifest differs')
manifest={name:observe(name) for name in ['DedicatedServerConfig.json','NuclearOptionServer.x86_64','.voltra/steam-template-release.json',*pins]}
engineModules={}
for name in ['UnityPlayer.so','GameAssembly.so','NuclearOptionServer_Data/Managed/Assembly-CSharp.dll','NuclearOptionServer_Data/Managed/Mirage.SteamworksSocket.dll']:
 if (r/name).exists():engineModules[name]=observe(name)
if not engineModules:raise ValueError('publisher engine module identity missing')
mission=r/'NuclearOption-Missions';missionFiles={}
if mission.exists():
 if mission.is_symlink() or not mission.is_dir():raise ValueError('invalid mission directory')
 paths=list(mission.rglob('*'))
 if len(paths)>10000:raise ValueError('oversized operator mission inventory')
 for p in sorted(paths):
  if p.is_symlink():raise ValueError('symlink operator mission')
  if p.is_file():missionFiles[str(p.relative_to(r))]=observe(str(p.relative_to(r)),67108864)
state=dict(manifest=manifest,engineModules=engineModules,publication=release,missionDirectoryExists=mission.exists(),missionFiles=missionFiles,config={**{k:config[k] for k in ['ServerName','MaxPlayers','ModdedServer','Port','QueryPort','MissionDirectory']},'SocketType':config.get('SocketType')},passwordSHA256=hashlib.sha256(config['Password'].encode()).hexdigest())
if ${running?'True':'False'}:
 found=[]
 for p in Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   if os.readlink(p/'exe')!=str(r/'NuclearOptionServer.x86_64'):continue
   a=[x.decode() for x in (p/'cmdline').read_bytes().split(b'\0') if x];parent=int(next(x.split()[1] for x in (p/'status').read_text().splitlines() if x.startswith('PPid:')));q=Path('/proc')/str(parent);pa=[x.decode() for x in (q/'cmdline').read_bytes().split(b'\0') if x]
   expected=[str(r/'NuclearOptionServer.x86_64'),'-batchmode','-nographics','-logFile','-','-DedicatedServer',str(r/'DedicatedServerConfig.json'),'-limitframerate','30']
   if a!=expected or os.readlink(p/'cwd')!=str(r) or len(pa)!=3 or pa[1] not in ['.voltra/light_games_next_runtime.py',str(r/'.voltra/light_games_next_runtime.py')] or pa[2]!='nuclear' or os.readlink(q/'exe')!=str(Path(shutil.which('python3')).resolve()):raise ValueError('direct native launch differs')
   if hashlib.sha256((p/'exe').read_bytes()).hexdigest()!=manifest['NuclearOptionServer.x86_64']['sha256']:raise ValueError('actual native executable differs')
   inodes=set()
   for fd in (p/'fd').iterdir():
    try:link=os.readlink(fd)
    except FileNotFoundError:continue
    if link.startswith('socket:['):inodes.add(link[8:-1])
   ports=set()
   for name in ['udp','udp6']:
    for line in (Path('/proc/net')/name).read_text().splitlines()[1:]:
     fields=line.split()
     if len(fields)>9 and fields[9] in inodes:ports.add(int(fields[1].split(':')[-1],16))
   mapped=(p/'maps').read_text();mappedModules=[name for name in engineModules if name.endswith('.so') and str(r/name) in mapped]
   if any(name.endswith('.so') and name not in mappedModules for name in engineModules):raise ValueError('publisher native module not actually loaded')
   birth=int((p/'stat').read_text().rsplit(')',1)[1].split()[19])
   found.append(dict(pid=int(p.name),parentPID=parent,startTicks=birth,direct=True,udpPorts=sorted(ports),mappedEngineModules=mappedModules,binarySHA256=manifest['NuclearOptionServer.x86_64']['sha256']))
  except (FileNotFoundError,ProcessLookupError,PermissionError):continue
 if len(found)!=1:raise ValueError('unique direct native process missing')
 state['process']=found[0]
print(json.dumps(state))`;
 const args=running?['exec',n.id,'python3','-B','-c',program]:['run','--rm','--pull','never','--network','none','--read-only','--user','0:0','--memory','256m','--memory-swap','256m','--cpus','1','--cap-drop','ALL','--cap-add','DAC_READ_SEARCH','--security-opt','no-new-privileges','--mount','type=bind,src='+source+',dst=/home/container,readonly','--entrypoint','python3',d.Image,'-B','-c',program];
 const result=JSON.parse(await docker(args,ctx.signal,30000));return {...result,containerId:n.id,startedAt:n.state.StartedAt};
}
export async function ready(ctx,c){
 const ports=await authority(ctx,c),n=await native(ctx);if(!n||!n.state.Running||!Number.isFinite(ctx.startRequestedAt)||Date.parse(n.state.StartedAt)<ctx.startRequestedAt)return false;
 const text=await logs(ctx,n.state.StartedAt);if(!text.includes(marker))return false;if(ports.automaticUpdate&&!/Success! App '3930080' (?:fully installed|already up to date)\./.test(text))throw Error('Nuclear automatic startup update publisher success unproved');
 const state=await snapshot(ctx,true),config=state.config;
 await ctx.artifact('nuclear-native-start-observation.json',{containerId:state.containerId,startedAt:state.startedAt,publication:state.publication,expectedPorts:{primary:ports.primary,query:ports.query},portConfig:config.Port,queryPortConfig:config.QueryPort,socketType:config.SocketType,factoryLogObserved:text.includes('Setting Steam socket'),transportAssemblyHashes:Object.fromEntries(Object.keys(transportAssemblies).map(path=>[path,state.engineModules[path]?.sha256])),missionDirectoryMatches:config.MissionDirectory==='/home/container/NuclearOption-Missions',passwordMatchesControlledTest:state.passwordSHA256===hash(testPassword),process:state.process,configSHA256:state.manifest['DedicatedServerConfig.json'].sha256,secretValuesOmitted:true});
 if(config.Port?.IsOverride!==true||config.Port.Value!==ports.primary||config.QueryPort?.IsOverride!==true||config.QueryPort.Value!==ports.query||config.MissionDirectory!=='/home/container/NuclearOption-Missions'||state.passwordSHA256!==hash(testPassword))throw Error('Nuclear exact allocation/config/password readback differs');
 const transport=nuclearTransportProof(state,text,ports);state.transportSelection=transport.identity;
 const info=await query(ctx,ports.query);if(info.name!==config.ServerName||info.maxPlayers!==config.MaxPlayers||info.passwordRequired!==true)throw Error('Nuclear native config consumption differs');
 processes.set(ctx,{containerId:n.id,startedAt:n.state.StartedAt,process:state.process,publication:state.publication,transport});contexts.set(ctx,{...contexts.get(ctx),state});return {startedAt:n.state.StartedAt,process:state.process,publication:state.publication,query:info,transport,configConsumed:true,consumedReadbacks:['ServerName','MaxPlayers','password-protection boolean','owned QueryPort UDP'],startupUpdatePublisherSuccess:ports.automaticUpdate,...nuclearEvidenceLimits};
}
async function stopped(ctx,c){
 const proof=processes.get(ctx),n=await native(ctx);if(!proof?.process.direct||!n||n.id!==proof.containerId||n.state.StartedAt!==proof.startedAt||n.state.Running||n.state.ExitCode!==0||n.state.OOMKilled||n.state.Dead||await c.state()!=='offline'||Date.parse(n.state.FinishedAt)<Date.parse(n.state.StartedAt))throw Error('Nuclear exact observed engine clean exit0 required');
 if(/Native process exited:|grace expired|escalating owned process/.test(await logs(ctx,n.state.StartedAt)))throw Error('Nuclear native stop nonzero/escalated');return {...proof,finishedAt:n.state.FinishedAt,engineExitProven:true,engineNumericExit:0};
}
// game_settings_documents.go keeps number inputs as strings on the wire;
// boolean inputs alone use JSON booleans. Native readback remains numeric.
// Current pinned publisher DedicatedServerKeyValues.BuildTagsString appends char + value + comma.
// Historical m=1 receipts use an older grammar and are not current native proof.
export function nuclearCurrentTags(keywords){
 const tags={};for(const item of String(keywords??'').split(',').filter(Boolean)){
  if(!/^[a-z]/.test(item)||item[1]==='='||Object.hasOwn(tags,item[0]))throw Error('Nuclear current publisher tag grammar differs');
  tags[item[0]]=item.slice(1);
 }return tags;
}
async function observedModdedQuery(ctx,ports,artifact){
 const q=await query(ctx,ports.query);
 // Password-derived short-password tags are intentionally omitted from receipts.
 const moddedTokens=String(q.keywords??'').split(',').filter(x=>x.startsWith('m'));
 await ctx.artifact(artifact,{observedAt:new Date().toISOString(),queryPort:ports.query,name:q.name,maxPlayers:q.maxPlayers,players:q.players,passwordProtected:q.visibility,version:q.version,moddedTokens,keywordSHA256:hash(q.keywords??''),publisherAssemblySHA256:transportAssemblies['NuclearOptionServer_Data/Managed/Assembly-CSharp.dll'],secretValuesOmitted:true});
 return nuclearCurrentTags(q.keywords).m==='1'?q:false;
}
export function nuclearSettingChanges(name,players=7,modded=true){
 if(typeof name!=='string'||name.length<1||Buffer.byteLength(name)>30||!Number.isInteger(players)||players<1||players>1024||typeof modded!=='boolean')throw Error('Invalid Nuclear typed setting choice');
 return {'/ServerName':name,'/MaxPlayers':String(players),'/ModdedServer':modded};
}
export async function settings(ctx,c){
 await c.power('stop');await wait(ctx,async()=>await c.state()==='offline'&&!(await native(ctx))?.state.Running,'Nuclear stopped edit');await stopped(ctx,c);await authority(ctx,c);
 const before=attrs(await h.api(route(ctx))),original=await c.read(file),changes=nuclearSettingChanges('Nuclear '+randomUUID().slice(0,8));
 for(const key of Object.keys(changes)){const f=before.fields?.filter(x=>x.key===key);if(f?.length!==1||f[0].readonly||f[0].readOnly||f[0].read_only)throw Error('Nuclear supported typed field unavailable');}if(!before.revision)throw Error('Nuclear revision absent');
 await h.api(route(ctx),'PUT',{revision:before.revision,settings:changes});const after=attrs(await h.api(route(ctx))),patched=await c.read(file);if(after.revision===before.revision)throw Error('Nuclear edit revision unchanged');
 const strip=text=>{for(const key of ['ServerName','MaxPlayers','ModdedServer']){let count=0;text=text.replace(new RegExp('("'+key+'"\\s*:\\s*)("(?:\\\\.|[^"\\\\])*"|-?\\d+|true|false)','g'),(_m,p)=>{count++;return p+'VALUE';});if(count!==1)throw Error('Ambiguous native config span');}return text;};if(strip(original)!==strip(patched))throw Error('Nuclear opaque config bytes changed');
 const refuse=async settings=>{let refused=false;try{await h.api(route(ctx),'PUT',{revision:after.revision,settings});}catch(e){if(!/: (?:400|422) /.test(e.message))throw e;refused=true;}if(!refused||await c.read(file)!==patched)throw Error('Nuclear unsupported edit changed bytes');};await refuse({'/MaxPlayers':'0'});await refuse({'/Port/Value':'1'});
 let stale=false;try{await h.api(route(ctx),'PUT',{revision:before.revision,settings:changes});}catch(e){if(!/: 409 /.test(e.message))throw e;stale=true;}if(!stale||await c.read(file)!==patched)throw Error('Nuclear stale refusal failed');
 ctx.startRequestedAt=Date.now();await c.power('start');const fresh=await wait(ctx,()=>ready(ctx,c),'Nuclear typed native restart');const ports=await authority(ctx,c);const moddedQuery=await wait(ctx,async()=>{return observedModdedQuery(ctx,ports,'nuclear-typed-native-query.json');},'Nuclear native modded EDF keyword',30000);fresh.query=moddedQuery;const flags=nuclearCurrentTags(fresh.query.keywords);
 if(fresh.query.name!==changes['/ServerName']||fresh.query.maxPlayers!==7||flags.m!=='1')throw Error('Nuclear typed name/capacity/modded native A2S consumption unproved');contexts.set(ctx,{...contexts.get(ctx),edited:true});return {query:fresh.query,revisionChanged:true,staleRefused:true,invalidAndManagedRefused:true,opaqueBytesPreserved:true,moddedNativeKeyword:'m1',...nuclearEvidenceLimits};
}
export function retentionPaths(ctx){owned(ctx);return [file,...Object.keys(pins).map(x=>'/'+x),'/.voltra/steam-template-release.json',...(contexts.get(ctx)?.state?.missionDirectoryExists?['/NuclearOption-Missions']:[])];}
export function restoreContext(ctx,saved){owned(ctx);if(!saved?.baseline||JSON.stringify(nuclearTransportIdentity(saved.baseline))!==JSON.stringify(saved.baseline.transportSelection)||JSON.stringify(saved.baseline.transportSelection)!==JSON.stringify(saved.stop?.transport?.identity)||saved.stop?.engineExitProven!==true||saved.stop.engineNumericExit!==0||!saved.stop.process?.direct||saved.baseline.passwordSHA256!==hash(testPassword))throw Error('Nuclear original native/config proof missing');contexts.set(ctx,{state:saved.baseline,edited:true});processes.set(ctx,saved.stop);}
export async function saved(ctx,c){if(!contexts.get(ctx)?.edited)throw Error('Nuclear meaningful native typed settings proof absent');const stop=await stopped(ctx,c),baseline=await snapshot(ctx);baseline.transportSelection=nuclearTransportIdentity(baseline);if(JSON.stringify(baseline.transportSelection)!==JSON.stringify(stop.transport?.identity))throw Error('Nuclear stopped transport identity differs');return {baseline,stop,...nuclearEvidenceLimits};}
export async function loaded(ctx,c,saved){restoreContext(ctx,saved);const fresh=await ready(ctx,c);if(!fresh||fresh.startedAt===saved.stop.startedAt||fresh.process.pid===saved.stop.process.pid&&fresh.process.startTicks===saved.stop.process.startTicks)throw Error('Nuclear fresh direct native restart missing');const actual=contexts.get(ctx).state;for(const key of ['manifest','engineModules','missionFiles','publication','transportSelection'])if(JSON.stringify(actual[key])!==JSON.stringify(saved.baseline[key]))throw Error('Nuclear retained native/config/publication differs: '+key);const ports=await authority(ctx,c);fresh.query=await wait(ctx,async()=>{return observedModdedQuery(ctx,ports,'nuclear-retained-native-query.json');},'Nuclear retained native EDF modded keyword',30000);const flags=nuclearCurrentTags(fresh.query.keywords);if(flags.m!=='1')throw Error('Nuclear retained native modded setting missing');await c.power('stop');await wait(ctx,async()=>await c.state()==='offline'&&!(await native(ctx))?.state.Running,'Nuclear final clean park');return {fresh,stop:await stopped(ctx,c),nativeConfigIdentityRetained:true,missionProgressClaim:false};}

export {authority as nuclearInstalledSource};

export {snapshot as nuclearReadOnlySnapshot};
