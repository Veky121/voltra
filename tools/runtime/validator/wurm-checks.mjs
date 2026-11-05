/** Wurm idle operator probes. Root owns admission, execution and canonical reinstall. */
import {docker} from './campaign-session.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as pause} from 'node:timers/promises';
import {native,logs,wait} from './campaign-adapter.mjs';
import {client} from './api-adapter.mjs';
import {recipe,build,image,pins,sha,sorted,installedSource,canonicalExposure} from './wurm-canonical-check.mjs';
export {verifyBuild} from './game-checks.mjs';
export {installedSource};
export const registration={wurm:{recipe,ports:2,peakMiB:4096,installPeakMiB:4096,diskMiB:8192,environment:{SRCDS_APPID:'402370',SRCDS_BETAID:'',SERVER_WORLD:'dist/Adventure'}}};
export const budgets={memoryMiB:4096,diskMiB:8192,startupMs:300000,stopMs:120000};
export const retentionRequiredPath='/LaunchConfig.ini';
export const evidenceLimits={players:false,WAN:false,gameplay:false,generatedPlayerProgress:false,globalShutdownFlush:false,scope:'Idle native query, supported Startup consumption, native clock and same-world operator retention only'};
const active=new WeakMap();
const exec=promisify(execFile);
async function probeDocker(ctx,label,args,timeout=30000){
 try{const result=await exec('docker',['--context','desktop-linux',...args],{windowsHide:true,signal:ctx.signal,timeout,maxBuffer:8*1024**2});await ctx.artifact(label+'-raw-'+Date.now()+'.json',{stdout:result.stdout,stderr:result.stderr,exit:0});return result.stdout;}
 catch(error){await ctx.artifact(label+'-failure-'+Date.now()+'.json',{stdout:error.stdout??'',stderr:error.stderr??'',exit:error.code??null,killed:error.killed??false,message:error.message});throw error;}
}
function owned(ctx){const f=ctx.fixture;if(ctx.build!==build||f?.recipe!==recipe||f.server?.uuid!==ctx.game.serverUUID||!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(f.server.uuid)||f.server.name!=='validator-'+ctx.game.id||ctx.game.testStartup||f.ports?.length!==2)throw Error('Exact owned Wurm fixture required');return f;}
export function verifyWurmPublication(publication,manifest,review){
 if(publication.appid!==402370||publication.StateFlags!==4||publication.platform!=='linux'||publication.branch!=='public'||!Number.isSafeInteger(publication.buildid)||publication.buildid<1)throw Error('Completed public Linux Wurm publication required');
 for(const [key,value]of Object.entries({appid:'402370',StateFlags:'4',buildid:String(publication.buildid)}))if(JSON.stringify([...manifest.matchAll(new RegExp('"'+key+'"\\s+"([^"\\r\\n]+)"','g'))].map(x=>x[1]))!==JSON.stringify([value]))throw Error('Wurm actual Steam manifest differs: '+key);
 if(review?.appid!==402370||review.buildid!==publication.buildid||review.publicationSHA256!==sha(JSON.stringify(sorted(publication)))||review.manifestSHA256!==sha(manifest)||review.meaningfulSourceReviewed!==true||!['WurmServerLauncher','server.jar','common.jar'].every(k=>/^[a-f0-9]{64}$/.test(review.payloadSHA256?.[k]??'')))throw Error('Root review of actual current metadata/payload required; historical build is not a binary pin');
 return {publication,review,actualCurrentPublication:true,historicalBinaryPin:false};
}
export async function prerequisites(ctx,c){
 const f=owned(ctx),source=await installedSource(ctx,c),i=f.install;
 const server=(await c.api('GET','/api/application/servers/'+f.server.id)).attributes;
 if(f.diagnosticMemory?.confirmed!==true||Number(server.limits?.memory)!==0)throw Error('ROOT_RESOURCE_PREP_REQUIRED: reviewed Panel memory0 and Wings unlimited required before native start');
 if(i?.rawExit!=='0'||i.callback?.success!==true||!i.logsFollowed||!i.memoryValid||!i.removed)throw Error('Fresh raw installer/log/callback/memory/removal evidence required');
 const publication=JSON.parse(await c.read('/.voltra/steam-template-release.json')),manifest=await c.read('/steamapps/appmanifest_402370.acf');
 return {source,publication:verifyWurmPublication(publication,manifest,ctx.game.wurmPublicationReview),...evidenceLimits};
}
// Execute only inside the exact owned running container. Never emit secret argv.
export const livePython=String.raw`import os,json,hashlib,pathlib,socket,struct,sys
r=pathlib.Path('/home/container');query=int(sys.argv[1]);engines=[];payload={}
for name in json.loads(sys.argv[2]):
 p=r/name
 if pathlib.PurePosixPath(name).is_absolute() or '..' in pathlib.PurePosixPath(name).parts or not p.resolve().is_relative_to(r):raise ValueError('unsafe payload review path')
 for q in [p,*p.parents]:
  if q==r.parent:break
  if q.is_symlink():raise ValueError('payload symlink')
 with p.open('rb') as f:payload[name]=hashlib.file_digest(f,'sha256').hexdigest()
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  if os.readlink(p/'exe')!=str(r/'WurmServerLauncher'):continue
  args=(p/'cmdline').read_bytes().split(b'\0')[:-1];parent=int(next(x.split()[1] for x in (p/'status').read_text().splitlines() if x.startswith('PPid:')));pp=pathlib.Path('/proc')/str(parent)
  values={}
  for arg in args[1:]:
   key,sep,value=arg.decode().partition('=')
   if not sep or key in values:raise ValueError('ambiguous Wurm argv')
   values[key]=value
  private={k:hashlib.sha256(v.encode()).hexdigest() for k,v in values.items() if k in ('adminpwd','serverpassword')}
  public={k:v for k,v in values.items() if k not in ('adminpwd','serverpassword')}
  sockets=set()
  for fd in (p/'fd').iterdir():
   try:
    link=os.readlink(fd)
    if link.startswith('socket:['):sockets.add(link[8:-1])
   except FileNotFoundError:pass
  listeners=[]
  for protocol in ('tcp','tcp6','udp','udp6'):
   for line in (p/'net'/protocol).read_text().splitlines()[1:]:
    fields=line.split()
    if fields[9] in sockets and (protocol.startswith('udp') or fields[3]=='0A'):listeners.append(dict(protocol=protocol,port=int(fields[1].split(':')[1],16)))
  display=[]
  for other in pathlib.Path('/proc').iterdir():
   if not other.name.isdigit():continue
   try:
    if os.readlink(other/'exe')=='/usr/bin/Xvfb' and int(next(x.split()[1] for x in (other/'status').read_text().splitlines() if x.startswith('PPid:')))==parent:display.append((other/'cmdline').read_bytes().split(b'\0')[:-1])
   except (FileNotFoundError,ProcessLookupError):pass
  environment=dict(x.split(b'=',1) for x in (p/'environ').read_bytes().split(b'\0') if b'=' in x)
  engines.append(dict(pid=int(p.name),startTicks=(p/'stat').read_text().rsplit(')',1)[1].split()[19],cwd=os.readlink(p/'cwd'),parentCwd=os.readlink(pp/'cwd'),parentArgv=(pp/'cmdline').read_bytes().split(b'\0')[:-1],binarySHA256=hashlib.sha256((p/'exe').read_bytes()).hexdigest(),argv=public,privateSHA256=private,listeners=listeners,display=environment.get(b'DISPLAY',b'').decode(),privateDisplayArgv=[[x.decode() for x in row] for row in display]))
 except (FileNotFoundError,ProcessLookupError):pass
for e in engines:e['parentArgv']=[x.decode() for x in e['parentArgv']]
request=b'\xff\xff\xff\xffTSource Engine Query\0';sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);sock.settimeout(5);sock.connect(('127.0.0.1',query));sock.send(request);data=sock.recv(65507)
if len(data)==9 and data[:5]==b'\xff\xff\xff\xffA':sock.send(request+data[5:]);data=sock.recv(65507)
sock.close()
if data[:5]!=b'\xff\xff\xff\xffI':raise ValueError('unsupported Wurm A2S frame')
offset=6
def string():
 global offset
 end=data.index(0,offset);v=data[offset:end].decode();offset=end+1;return v
info=dict(name=string(),map=string(),folder=string(),game=string());appid,players,maximum,bots,kind,platform,password,vac=struct.unpack_from('<HBBBBBBB',data,offset);offset+=9
info.update(players=players,maximum=maximum,bots=bots,password=bool(password),version=string(),packetSHA256=hashlib.sha256(data).hexdigest())
print(json.dumps(dict(engines=engines,query=info,payloadSHA256=payload)))
`;
// Source mount MUST be readonly, and native exit must already be verified by root.
// SQLite opens only independent writable copies, with every existing WAL/SHM/journal.
export const offlinePython=String.raw`import pathlib,sys,os,stat,hashlib,json,sqlite3,tempfile,shutil
r=pathlib.Path('/source');world=pathlib.PurePosixPath(sys.argv[1]);report=dict(manifest={},databases=[])
def meta(p):
 for q in [p,*p.parents]:
  if q==r.parent:break
  if q.is_symlink():raise ValueError('symlink refused')
 a=p.stat()
 if not stat.S_ISREG(a.st_mode):raise ValueError('regular file required')
 with p.open('rb') as f:d=hashlib.file_digest(f,'sha256').hexdigest()
 b=p.stat()
 if (a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)!=(b.st_ino,b.st_size,b.st_mtime_ns,b.st_ctime_ns):raise ValueError('source changed during observation')
 return dict(sha256=d,bytes=b.st_size,mode=stat.S_IMODE(b.st_mode),uid=b.st_uid,gid=b.st_gid)
try:
 if world.is_absolute() or '..' in world.parts or not world.parts:raise ValueError('unsafe world')
 root=r/str(world)
 paths=[r/'LaunchConfig.ini',r/'WurmServerLauncher']
 for tree in {root,r/'dist/Adventure',r/'dist/Creative',r/'backup'}:
  if tree.exists():
   if tree.is_symlink() or not tree.is_dir():raise ValueError('invalid preservation tree')
   paths += list(tree.rglob('*'))
 paths += list((r/'.voltra').glob('*.py'))
 for p in sorted(set(paths)):
  if p.is_symlink():raise ValueError('source symlink')
  if p.is_file():report['manifest'][str(p.relative_to(r))]=meta(p)
 dbs=sorted(root.rglob('*.db'))
 if len(dbs)!=9:raise ValueError('review changed world database inventory, expected nine')
 for p in dbs:
  with tempfile.TemporaryDirectory(prefix='wurm-independent-') as temp:
   target=pathlib.Path(temp)/p.name
   for source in [p,*[p.with_name(p.name+s) for s in ('-wal','-shm','-journal')]]:
    if source.exists():shutil.copyfile(source,pathlib.Path(temp)/source.name)
   c=sqlite3.connect(str(target))
   try:
    checks=[x[0] for x in c.execute('pragma quick_check')]
    row=dict(database=str(p.relative_to(r)),quickCheck=checks,independentCopy=True)
    tables=[x[0] for x in c.execute("select name from sqlite_master where type='table'")]
    if 'SERVERS' in tables:
     columns=[x[1] for x in c.execute('pragma table_info(SERVERS)')];wanted=['NAME','EXTERNALIP','EXTERNALPORT','MAXPLAYERS','PVP','EPIC']
     if not set(wanted).issubset(columns):raise ValueError('review changed SERVERS schema')
     row['servers']=[dict(zip(wanted,x)) for x in c.execute('select '+','.join('"'+x+'"' for x in wanted)+' from SERVERS')]
    report['databases'].append(row)
    if checks!=['ok']:raise ValueError('copied DB integrity failed')
   finally:c.close()
 for name,original in report['manifest'].items():
  if meta(r/name)!=original:raise ValueError('original bytes/metadata changed')
 report['originalsUnchanged']=True
except Exception as e:
 report['error']=type(e).__name__+': '+str(e);print(json.dumps(report));sys.exit(0)
print(json.dumps(report))
`;
export function verifyWurmLive(observation,source,expected){
 if(JSON.stringify(sorted(observation.payloadSHA256))!==JSON.stringify(sorted(expected?.payloadSHA256)))throw Error('Wurm reviewed publisher payload changed; review meaningful source before acceptance');
 const engines=observation.engines;if(engines?.length!==1)throw Error('One actual Wurm launcher required');const e=engines[0],q=observation.query,a=e.argv;
 if(e.display!==':99'||JSON.stringify(e.privateDisplayArgv)!==JSON.stringify([['/usr/bin/Xvfb',':99','-screen','0','1024x768x16','-nolisten','tcp']])||!e.listeners?.some(x=>x.protocol.startsWith('tcp')&&x.port===source.primary)||!e.listeners?.some(x=>x.protocol.startsWith('udp')&&x.port===source.query))throw Error('Wurm owned native TCP/query UDP/private display missing');
 if(e.cwd!=='/home/container'||e.parentCwd!=='/home/container'||JSON.stringify(e.parentArgv)!==JSON.stringify(['.voltra/python/bin/python3','.voltra/wurm_owner.py'])||e.binarySHA256!==expected.payloadSHA256.WurmServerLauncher||a.start!==source.world||a.externalport!==String(source.primary)||a.queryport!==String(source.query)||a.ip!=='0.0.0.0'||q.folder!=='wurmunlimitedserver'||q.game!=='Wurm Unlimited Server'||q.players!==0||q.bots!==0||q.name!==a.servername||q.maximum!==Number(a.maxplayers)||!q.map||q.password!==(e.privateSHA256.serverpassword!==sha('')))throw Error('Wurm native process/query/settings identity differs');
 return {engine:e,query:q,direct:true};
}
export async function ready(ctx,c){
 if(!Number.isFinite(ctx.startRequestedAt))throw Error('Wurm fresh start boundary required');
 const f=owned(ctx),source=await installedSource(ctx,c),n=await native(ctx);if(!n?.state.Running||Date.parse(n.state.StartedAt)<ctx.startRequestedAt-5000)return false;
 const [d]=JSON.parse(await docker(['inspect',n.id],ctx.signal)),volume='/var/lib/voltra-parity-20261029/volumes/'+f.server.uuid;
 if(d.Name!=='/'+f.server.uuid||d.Config.Image!==image||d.HostConfig.Memory!==0||d.Mounts.filter(m=>m.Destination==='/home/container'&&m.Source===volume).length!==1||d.Mounts.some(m=>m.Destination.startsWith('/home/container/')))throw Error('Wurm exact running source mount differs');
 const text=await logs(ctx,n.state.StartedAt),clock=text.match(/Using database entry for time ([0-9]+)/)?.[1];
 if(!text.includes('Wurm Server launcher finished at')||!text.includes('Server connected to steam')||!clock)return false;
 const raw=await probeDocker(ctx,'wurm-live',['exec',n.id,'env','PYTHONHOME=/home/container/.voltra/python','LD_LIBRARY_PATH=/home/container/.voltra/python/lib','/home/container/.voltra/python/bin/python3','-B','-c',livePython,String(source.query),JSON.stringify(Object.keys(ctx.game.wurmPublicationReview?.payloadSHA256??{}))]);
 const observed=JSON.parse(raw);await ctx.artifact('wurm-live-'+Date.now()+'.json',{observed,containerId:n.id,state:n.state,logSHA256:sha(text),clock,exceptionsObserved:/Exception|\bERROR\b/.test(text)});
 verifyWurmPublication(JSON.parse(await c.read('/.voltra/steam-template-release.json')),await c.read('/steamapps/appmanifest_402370.acf'),ctx.game.wurmPublicationReview);
 const proof=verifyWurmLive(observed,source,ctx.game.wurmPublicationReview);if(proof.engine.argv.servername!==ctx.game.wurmExpected?.SERVERNAME||proof.engine.argv.maxplayers!==String(ctx.game.wurmExpected?.MAX_PLAYERS)||proof.engine.argv.pvp!==ctx.game.wurmExpected?.PVP||proof.engine.argv.epicsettings!==ctx.game.wurmExpected?.EPIC)throw Error('Explicit supported Startup consumption expectation required');
 const value={...proof,source,clock,containerId:n.id,startedAt:n.state.StartedAt};active.set(ctx,value);return {...value,...evidenceLimits};
}
export function verifyWurmStop(n,proof,text){
 if(!proof?.direct||n?.id!==proof.containerId||n.state.StartedAt!==proof.startedAt||n.state.Running||n.state.ExitCode!==0||n.state.OOMKilled||n.state.Dead||n.state.Error||!n.state.FinishedAt||/Native process exited:|grace expired|escalating owned process/i.test(text))throw Error('Wurm exact native generation clean exit0 required');
 return {...proof,finishedAt:n.state.FinishedAt,engineExitProven:true,engineNumericExit:0};
}
export async function stopped(ctx,c){const n=await native(ctx),text=n?await logs(ctx,n.state.StartedAt):'';await ctx.artifact('wurm-stop-'+Date.now()+'.json',{containerId:n?.id,state:n?.state,logSHA256:sha(text)});if(await c.state()!=='offline')throw Error('Wurm panel offline required');return verifyWurmStop(n,active.get(ctx),text);}
export async function offlineSnapshot(ctx,c){
 const f=owned(ctx),stop=await stopped(ctx,c),source=await installedSource(ctx,c),world=source.world;
 if(typeof world!=='string'||!/^dist\/[A-Za-z0-9_-]+$/.test(world))throw Error('Review current frozen world path before offline probe');
 const [d]=JSON.parse(await docker(['inspect',stop.containerId],ctx.signal)),volume='/var/lib/voltra-parity-20261029/volumes/'+f.server.uuid;
 if(d.Name!=='/'+f.server.uuid||d.Config.Image!==image||d.Mounts.filter(m=>m.Destination==='/home/container'&&m.Source===volume).length!==1||d.Mounts.some(m=>m.Destination.startsWith('/home/container/')))throw Error('Wurm exact stopped source mount differs');
 const raw=await probeDocker(ctx,'wurm-db',['run','--rm','--pull','never','--network','none','--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=2147483648','--memory','512m','--mount','type=bind,source='+volume+',target=/source,readonly','python:3.13-slim','python3','-B','-c',offlinePython,world],120000);
 const observation=JSON.parse(raw);await ctx.artifact('wurm-offline-'+Date.now()+'.json',observation);if(observation.error||observation.originalsUnchanged!==true||observation.databases.length!==9)throw Error('Wurm independent copied DB proof missing');
 verifyWurmStop(await native(ctx),stop,await logs(ctx,(await native(ctx)).state.StartedAt));return {stop,observation,world,...evidenceLimits};
}
export function verifyWurmDBSettings(saved,expected,primary){
 const rows=saved.observation.databases.flatMap(x=>x.servers??[]).filter(x=>x.NAME===expected.SERVERNAME&&String(x.EXTERNALPORT)===String(primary));
 if(rows.length!==1||Number(rows[0].MAXPLAYERS)!==Number(expected.MAX_PLAYERS)||Number(rows[0].PVP)!==Number(expected.PVP==='true')||Number(rows[0].EPIC)!==Number(expected.EPIC==='true'))throw Error('Supported Startup settings not consumed by saved native SERVERS row');return {nativeDBSettings:true};
}
export function verifyWurmRetention(before,after){if(before.world!==after.world||JSON.stringify(sorted(before.observation.manifest))!==JSON.stringify(sorted(after.observation.manifest)))throw Error('Wurm canonical installer changed protected bytes/mode/UID/GID/inventory');return {strictByteMetadataRetention:true,files:Object.keys(before.observation.manifest).length};}
export function verifyWurmReload(saved,fresh){if(fresh.source.world!==saved.world||fresh.startedAt===saved.stop.startedAt||fresh.engine.pid===saved.stop.engine.pid&&fresh.engine.startTicks===saved.stop.engine.startTicks||BigInt(fresh.clock)<=BigInt(saved.stop.clock)||fresh.query.map!==saved.stop.query.map)throw Error('Wurm same-world fresh native clock progression unproved');return {sameWorld:true,nativeClockProgression:true,...evidenceLimits};}
export async function saved(ctx,c){const value=await offlineSnapshot(ctx,c);verifyWurmDBSettings(value,ctx.game.wurmExpected,value.stop.source.primary);return value;}
export function restoreContext(ctx,previous){owned(ctx);if(previous?.stop?.engineExitProven!==true||previous.stop.engineNumericExit!==0||!previous.observation?.originalsUnchanged||!previous.stop.direct)throw Error('Wurm durable original direct-engine stop/DB proof required');active.set(ctx,previous.stop);}
export async function loaded(ctx,c,previous){const fresh=await ready(ctx,c);if(!fresh)return false;verifyWurmReload(previous,fresh);await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','Wurm reload stop',budgets.stopMs);return {fresh,saved:await saved(ctx,c),...evidenceLimits};}
export async function runWurmCanonicalBoot(ctx){
 Object.assign(ctx.game,{base:'http://127.0.0.1:18099',serverUUID:ctx.fixture?.server?.uuid});const c=client(ctx);owned(ctx);
 if(!ctx.fixture.intent||ctx.fixture.intent.build!==build||ctx.fixture.intent.scriptHash!== 'b053061c632ee57926f698d722a6c6f5b50cbd835716edcbf4b17ae2db55d92a')throw Error('Wurm canonical intent required');
 if(await c.state()!=='offline'||(await native(ctx))?.state.Running)throw Error('Wurm bootstrap requires exact stopped fixture');
 await prerequisites(ctx,c);await ctx.reserve(ctx.game.peakMiB);let requested=false;
 try{
  ctx.startRequestedAt=Date.now();requested=true;await c.power('start');const fresh=await wait(ctx,()=>ready(ctx,c),'Wurm current native ready',budgets.startupMs);
  if(ctx.game.wurmIdleDiagnosticMs!==undefined){
   if(ctx.game.wurmIdleDiagnosticMs!==90000)throw Error('Only reviewed 90-second Wurm crash diagnostic admitted');
   const until=Date.now()+90000,observations=[];
   while(Date.now()<until){await pause(Math.min(5000,until-Date.now()),undefined,{signal:ctx.signal});const current=await ready(ctx,c);if(!current||current.containerId!==fresh.containerId||current.startedAt!==fresh.startedAt)throw Error('Wurm idle diagnostic lost native generation');observations.push({at:new Date().toISOString(),clock:current.clock,containerId:current.containerId});await ctx.artifact('wurm-idle-diagnostic.json',{initialClock:fresh.clock,observations,stopRequested:false});}
   // ready() reads the startup log's persisted clock, not a live ticking value.
   // Only saved/reload can establish clock progression across generations.
   await ctx.artifact('wurm-idle-diagnostic-complete.json',{observations:observations.length,clockSource:'startup-log persisted value',liveClockProgressionClaim:false,stableGeneration:true});
  }
  await ctx.artifact('wurm-stop-request.json',{at:new Date().toISOString(),containerId:fresh.containerId,startedAt:fresh.startedAt});await c.power('stop');await ctx.artifact('wurm-stop-ack.json',{at:new Date().toISOString(),containerId:fresh.containerId});await wait(ctx,async()=>await c.state()==='offline'&&!(await native(ctx))?.state.Running,'Wurm bootstrap stop',budgets.stopMs);
  const proof={fresh,saved:await saved(ctx,c),complete:true,typedMutationPending:true,...evidenceLimits};await ctx.own({...ctx.fixture,canonicalBootstrap:proof});return proof;
 }catch(error){
  const n=await native(ctx);await ctx.artifact('wurm-bootstrap-failure-'+Date.now()+'.json',{message:error.message,containerId:n?.id,state:n?.state,logSHA256:n?sha(await logs(ctx,n.state.StartedAt)):null});
  if(requested&&n?.state.Running){await c.power('stop');await wait(ctx,async()=>await c.state()==='offline'&&!(await native(ctx))?.state.Running,'Wurm failed bootstrap park',budgets.stopMs);}
  throw error;
 }
}
export function retentionPaths(ctx){owned(ctx);return [...new Set(['/LaunchConfig.ini','/WurmServerLauncher','/dist/Adventure','/dist/Creative','/backup','/'+(ctx.game.wurmExpected?.SERVER_WORLD??'dist/Adventure'),...Object.keys(pins).map(x=>'/'+x)])];}
// Exposure only. Typed mutation, refusals and native consumption remain separate pending gates.
export async function settings(ctx,c){return canonicalExposure(ctx,c);}
