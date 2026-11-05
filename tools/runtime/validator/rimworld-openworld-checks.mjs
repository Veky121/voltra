import net from 'node:net';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Historical publisher/protocol research: artifacts/rimworld-openworld-native-acceptance.json,
// .local/sonic-rimworld-protocol.mjs and openworld/reloaded-native-runtime.json.
// Fresh capacity/status and directory-backup consumption remain assertions to prove.
const recipe='rimworld/open_world/egg-rimworld-open-world.json';
export const registration={rimworld_openworld:{recipe,ports:1,environment:{VERSION:'v1.0.4',MAX_PLAYERS:'10',ENFORCE_MODS:'false',USE_MOD_BLACKLIST:'false',USE_CUSTOM_DIFF:'false',WHITELIST:'false',CUSTOM_SCEN:'false',PLAYER_VERSION:'1.3',AUTO_UPDATE:'0'}}};
export const budgets={memoryMiB:1024,diskMiB:2048,startupMs:120000,stopMs:60000};
export const retentionRequiredPath='/Data/Config.json';
const binarySHA='c20b6e98674a339bff4ffa3f4a729672338c23ee68755a7cceab63b21a7dc83c';
const archiveSHA='dba0571b82ea2df2762d1b7640d58ee64be1290d0b22248d606c729ac1347d22';
const pythonImage='sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8';
const startup='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/sonic_rimworld.py run openworld';
const pins={
 '.voltra/steam_template.py':'7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897',
 '.voltra/additional_survival_install.py':'a2c9dca09dc86279e0f154a5d1574f6e6e68d4c4260687cf6fffe7003ea55b29',
 '.voltra/native_console.py':'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5',
 '.voltra/native-release.py':'31f274542a9d0b85a7a2cf86ad48b62d9ce8a8549b3e0f631de7b8043e88f193',
 '.voltra/small-native-install.py':'a7992f28e4eff019b94c282c15aa02ece3fb81e0e912df233c721b0702c3b5ef',
 '.voltra/bundle_debian_python.py':'16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0',
 '.voltra/sonic_rimworld.py':'97abbac8a48f3bb8554ee892c836cac6a984e0911f1d4c74acca0e074a1ae4a2',
 '.voltra/sonic-rimworld-releases.json':'25fc6d6dcfab75e40dac6f2d4d8beb90804c364d2f22b6cf742386f108e579c8',
 '.voltra/sonic-rimworld-licenses.json':'7fe27e2d77a7b8a26e8cc02fdf75a2a5884749ca658affc1bed75dd14e676022'
};
const sha=x=>createHash('sha256').update(x).digest('hex');
const plain=x=>x.replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'');
const scope='Idle standalone mod server: rejected unauthenticated handshake, typed capacity consumption, native backup and initialized configuration retention. No players, generated planet, player saves, gameplay or WAN; name consumption not claimed.';
const proofs=new WeakMap(), contexts=new WeakMap();
function owned(ctx){
 const f=ctx.fixture,s=f?.server;
 if(ctx.game.family!=='rimworld_openworld'||ctx.game.recipe!==recipe||f?.recipe!==recipe||!s||s.uuid!==ctx.game.serverUUID||s.name!=='validator-'+ctx.game.id||ctx.game.testStartup||f.ports?.length!==1||!Number.isInteger(f.ports[0])||f.ports[0]<1025||f.ports[0]>65535)throw Error('Exact isolated OpenWorld fixture/allocation required');
 return s;
}
export async function installedSource(ctx,c){
 const s=owned(ctx),p=h.profileFromRuntime(recipe,receipt),actual=(await h.api('/api/application/servers/'+s.id)).attributes;
 if(actual.uuid!==s.uuid||actual.egg!==ctx.fixture.egg.id||Number(actual.node)===202||actual.name!==s.name||p.egg.startup!==startup||actual.container?.startup_command!==startup||p.egg.config.stop!=='shutdown')throw Error('OpenWorld source/launch authority differs');
 const emitted=Object.fromEntries([...p.egg.scripts.installation.script.matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>[m[1],sha(m[3]+'\n')]));
 for(const [path,hash] of Object.entries(pins))if(emitted[path]!==hash||sha(await c.read('/'+path))!==hash)throw Error('OpenWorld exact emitted helper differs: '+path);
 const rel=JSON.parse(await c.read('/.voltra/openworld/release.json'));
 // The installer publication receipt has an archive identity and actual binary identity.
 const archive=rel.archive??rel;
 if(rel.game!=='openworld'||rel.version!=='v1.0.4'||archive.sha256!==archiveSHA||archive.bytes!==329666||rel.binary_sha256!==binarySHA)throw Error('OpenWorld exact release receipt shape/version/hash differs; preserve actual receipt for review');
 return {helpers:pins,archiveSHA256:archiveSHA,binarySHA256:binarySHA,managedDLLSHA256:'e68fb71532f745511452f7982304cf098a9f91855e1f7f202268c5dfeae7ee7a'};
}
async function handshake(ctx){return new Promise((resolve,reject)=>{
 let received=Buffer.alloc(0),done=false;const socket=net.createConnection({host:'127.0.0.1',port:ctx.fixture.ports[0]});
 const finish=error=>{if(done)return;done=true;clearTimeout(timer);ctx.signal.removeEventListener('abort',abort);socket.destroy();error?reject(error):resolve({response:'WrongVersionPacket',authenticatedPlayer:false,worldCreated:false});};
 const abort=()=>finish(Error('OpenWorld probe aborted')),timer=setTimeout(()=>finish(Error('OpenWorld probe timeout')),5000);
 ctx.signal.addEventListener('abort',abort,{once:true});if(ctx.signal.aborted)return abort();socket.on('error',()=>finish(Error('OpenWorld probe socket failure')));
 socket.on('connect',()=>socket.write(Buffer.from(JSON.stringify({header:'ClientAuthPacket',contents:[JSON.stringify({clientVersion:'0.0.0-protocol-probe',clientMods:[]})]})).toString('base64')+'\n'));
 socket.on('data',part=>{try{received=Buffer.concat([received,part]);if(received.length>1048576)throw Error('Oversized native reply');const end=received.indexOf(10);if(end<0)return;const response=JSON.parse(Buffer.from(received.subarray(0,end).toString().trim(),'base64').toString());if(response.header!=='WrongVersionPacket')throw Error('Unexpected native rejection');finish();}catch(e){finish(e);}});
 socket.on('end',()=>{if(!done)finish(Error('Native reply incomplete'));});
});}
async function snapshot(ctx,process=false){
 const s=owned(ctx),n=await native(ctx);if(!n)throw Error('OpenWorld container identity absent');
 const source='/var/lib/voltra-parity-20261029/volumes/'+s.uuid;
 const [d]=JSON.parse(await docker(['inspect',n.id],ctx.signal));
 if(d.Name!=='/'+s.uuid||d.Mounts.filter(m=>m.Destination==='/home/container'&&m.Source===source).length!==1||d.Mounts.some(m=>m.Destination.startsWith('/home/container/')))throw Error('OpenWorld exact volume authority differs');
 if(process&&!d.State.Running)throw Error('OpenWorld native process missing');
 const program=String.raw`import os,json,stat,hashlib,zipfile
from pathlib import Path,PurePosixPath
r=Path('/home/container')
def safe(p):
 if not p.is_relative_to(r):raise ValueError('outside volume')
 for q in [p,*p.parents]:
  if q==r.parent:break
  if q.is_symlink():raise ValueError('symlink in native state')
 return p
def observe(p,limit=67108864):
 safe(p);a=p.stat()
 if not stat.S_ISREG(a.st_mode) or a.st_size>limit:raise ValueError('invalid native file')
 data=p.read_bytes();b=p.stat()
 if (a.st_size,a.st_mtime_ns,a.st_ino)!=(b.st_size,b.st_mtime_ns,b.st_ino):raise ValueError('native file changed during observation')
 return data,dict(sha256=hashlib.sha256(data).hexdigest(),size=len(data),mode=stat.S_IMODE(b.st_mode),uid=b.st_uid,gid=b.st_gid)
binary,identity=observe(r/'OpenWorldServer',134217728)
dll,dllIdentity=observe(r/'OpenWorldServer.dll',134217728)
assert dllIdentity['sha256']=='e68fb71532f745511452f7982304cf098a9f91855e1f7f202268c5dfeae7ee7a','publisher managed DLL differs'
assert identity['sha256']=='c20b6e98674a339bff4ffa3f4a729672338c23ee68755a7cceab63b21a7dc83c','publisher binary differs'
configraw,configmeta=observe(r/'Data/Config.json',4194304);config=json.loads(configraw)
manifest={}
for dirname in ['Data','Players','Saves','Settlements']:
 directory=safe(r/dirname)
 if not directory.exists():continue
 paths=list(directory.rglob('*'));assert len(paths)<10000,'oversized state'
 for p in paths:
  safe(p)
  if p.is_file():
   relative=str(p.relative_to(r))
   if dirname in ['Players','Saves','Settlements'] or relative.startswith('Data/WorldGenData/'):raise ValueError('unexpected player or planet data')
   data,meta=observe(p,4194304);manifest[relative]=meta
assert 'Data/Config.json' in manifest
backups={}
folder=safe(r/'Backups')
if folder.exists():
 paths=list(folder.glob('*/Data/Config.json'));assert len(paths)<1000
 for p in paths:
  data,meta=observe(p,4194304);meta['mtimeNs']=p.stat().st_mtime_ns;backups[str(p.relative_to(folder))]=meta
engines=[]
if ${process ? 'True' : 'False'}:
 for p in Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   if (p/'exe').resolve()!=(r/'.voltra/dotnet-8/dotnet').resolve():continue
   own=(p/'cmdline').read_bytes().split(b'\0')[:-1]
   if own[1:]!=[b'--roll-forward',b'Major',b'/home/container/OpenWorldServer.dll']:continue
   pp=int(next(x.split()[1] for x in (p/'status').read_text().splitlines() if x.startswith('PPid:')))
   parent=Path('/proc')/str(pp);args=(parent/'cmdline').read_bytes().split(b'\0')[:-1]
   engines.append(dict(pid=int(p.name),ppid=pp,direct=args[1:]==[b'.voltra/sonic_rimworld.py',b'run',b'openworld'] and (parent/'exe').resolve()==(r/'.voltra/python/bin/python3').resolve(),cwd=os.readlink(p/'cwd')))
  except (FileNotFoundError,ProcessLookupError):pass
if not ${process ? 'True' : 'False'}:
 for relative,meta in manifest.items():assert observe(r/relative,4194304)[1]==meta,'offline initialized file changed'
print(json.dumps(dict(binary=identity,managedDLL=dllIdentity,config={k:config[k] for k in ['LocalAddress','ServerPort','MaxPlayers','PlayerVersion']},configSHA256=configmeta['sha256'],initialized=manifest,backups=backups,engines=engines),sort_keys=True))`;
 let out;
 if(d.State.Running)out=await docker(['exec','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib',n.id,'/home/container/.voltra/python/bin/python3','-B','-c',program],ctx.signal,30000);
 else{
  if(ctx.game.offlineHelperImage!==pythonImage)throw Error('Reviewed offline Python helper image required');
  out=await docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--cpus','1','--user','0:0','--cap-drop','ALL','--cap-add','DAC_READ_SEARCH','--security-opt','no-new-privileges','--mount','type=bind,source='+source+',target=/home/container,readonly',pythonImage,'python3','-B','-c',program],ctx.signal,30000);
 }
 const [after]=JSON.parse(await docker(['inspect',n.id],ctx.signal));if(!d.State.Running&&(after.State.Running||after.State.StartedAt!==d.State.StartedAt||after.State.FinishedAt!==d.State.FinishedAt))throw Error('Offline OpenWorld process changed');
 const result=JSON.parse(out);await ctx.artifact('openworld-observation-'+Date.now()+'.json',result);return result;
}
async function command(ctx,input,pattern){
 const n=await native(ctx);if(!n?.state.Running)throw Error('Command requires running OpenWorld fixture');
 const before=await logs(ctx,n.state.StartedAt);
 await h.api('/api/client/servers/'+owned(ctx).uuid+'/command','POST',{command:input});
 return wait(ctx,async()=>{const next=await logs(ctx,n.state.StartedAt);if(!next.startsWith(before))throw Error('OpenWorld command log boundary changed');const fresh=plain(next.slice(before.length));return pattern.test(fresh)?{command:input,freshSHA256:sha(fresh)}:false;},'OpenWorld native '+input,30000);
}
export async function prerequisites(ctx,c){
 const hashes=await installedSource(ctx,c);if(await c.state()!=='offline'||(await native(ctx))?.state.Running)throw Error('OpenWorld prerequisites require parked fixture');
 if(ctx.game.offlineHelperImage!==pythonImage)throw Error('Reviewed offline helper required');
 const doc=(await h.api(settingsURL(ctx))).attributes,capacity=doc.fields?.filter(f=>f.key==='/MaxPlayers');
 if(capacity?.length!==1||capacity[0].readonly!==false||capacity[0].type!=='number')throw Error('OpenWorld publisher typed capacity authority absent');
 if(String(capacity[0].value)==='7'){
  // Admit only the exact owned prior test intent and independently captured
  // before/after observer hashes, never an arbitrary preexisting capacity7.
  const directory=resolve(ctx.output,ctx.game.id),history=resolve(ctx.output,'history');
  const reportNames=(await readdir(history)).filter(n=>n.startsWith(ctx.game.id+'-')&&n.endsWith('.json'));if(reportNames.length>200)throw Error('OpenWorld retry report history requires bounded review');
  const reports=await Promise.all(reportNames.map(async n=>JSON.parse(await readFile(resolve(history,n),'utf8'))));
  reports.push(JSON.parse(await readFile(resolve(ctx.output,ctx.game.id+'.json'),'utf8')));
  const report=reports.find(r=>r.fixture?.server?.uuid===ctx.fixture.server.uuid&&r.build===ctx.build&&r.checks?.some(x=>x.name==='start-ready'&&x.status==='PASS'));
  if(!report)throw Error('Prior owned OpenWorld native readiness receipt absent');
  const intent=JSON.parse(await readFile(resolve(directory,'openworld-config-intent.json'),'utf8'));
  if(report.fixture?.server?.uuid!==ctx.fixture.server.uuid||report.build!==ctx.build||!report.checks?.some(x=>x.name==='start-ready'&&x.status==='PASS')||intent.changes?.['/MaxPlayers']!==7||intent.fixture&&intent.fixture!==ctx.fixture.server.uuid)throw Error('Owned previous OpenWorld edit proof absent');
  const names=(await readdir(directory)).filter(n=>/^openworld-observation-\d+\.json$/.test(n));if(names.length>300)throw Error('OpenWorld retry observer history requires bounded review');
  const observations=await Promise.all(names.map(async n=>JSON.parse(await readFile(resolve(directory,n),'utf8'))));
  const current=await snapshot(ctx),original=observations.find(o=>o.configSHA256===intent.beforeSHA&&o.config?.MaxPlayers===10);
  if(!original||!observations.some(o=>o.configSHA256===current.configSHA256&&o.config?.MaxPlayers===7)||JSON.stringify({...original.config,MaxPlayers:7})!==JSON.stringify(current.config))throw Error('Exact previous OpenWorld test state differs');
  // CachedValues is publisher-updated on boot. Compare the current full family
  // against an actual post-edit observer, rather than its pre-restart contents.
  if(!observations.some(o=>o.config?.MaxPlayers===7&&JSON.stringify(o.initialized)===JSON.stringify(current.initialized)))throw Error('OpenWorld exact prior post-edit family differs');
  await ctx.artifact('openworld-retry-reset-intent-'+Date.now()+'.json',{fixture:ctx.fixture.server.uuid,beforeSHA:current.configSHA256,previousIntent:intent,changes:{'/MaxPlayers':10}});
  await h.api(settingsURL(ctx),'PUT',{revision:doc.revision,settings:{'/MaxPlayers':'10'}});
  const after=(await h.api(settingsURL(ctx))).attributes,reset=await snapshot(ctx);
  if(String(after.fields?.find(f=>f.key==='/MaxPlayers')?.value)!=='10'||reset.configSHA256!==intent.beforeSHA)throw Error('OpenWorld exact baseline reset readback differs');
  await ctx.artifact('openworld-retry-reset-readback-'+Date.now()+'.json',{fixture:ctx.fixture.server.uuid,afterSHA:reset.configSHA256});
 }else if(String(capacity[0].value)!=='10')throw Error('OpenWorld controlled baseline capacity10 required');
 contexts.set(ctx,{edited:false});return {hashes,scope};
}
export async function ready(ctx,c){
 const n=await native(ctx);if(!n?.state||Date.parse(n.state.StartedAt)<ctx.startRequestedAt)return false;if(!n.state.Running)throw Error('OpenWorld exited before readiness');
 const text=await logs(ctx,n.state.StartedAt);if(!text.includes('Server Launched')||await c.state()!=='running')return false;
 if(!text.includes('Open World Server v1.0.4')||!text.includes('Server port ['+ctx.fixture.ports[0]+']'))throw Error('OpenWorld native version/listener differs');
 const hashes=await installedSource(ctx,c),observation=await snapshot(ctx,true);
 if(observation.engines.length!==1||!observation.engines[0].direct||observation.engines[0].cwd!=='/home/container')throw Error('OpenWorld direct dotnet8 child unproved');
 const protocol=await handshake(ctx),capacity=contexts.get(ctx)?.edited?7:10;
 if(observation.config.MaxPlayers!==capacity)throw Error('Native config capacity differs');
 await command(ctx,'status',new RegExp('Max Players: '+capacity+'(?:\\r|\\n|$)'));
 await command(ctx,'status',/Connected Players: 0/);
 const proof={containerId:n.id,startedAt:n.state.StartedAt,engine:observation.engines[0],hashes,protocol};proofs.set(ctx,proof);return {...proof,scope};
}
async function cleanStop(ctx,c){
 const proof=proofs.get(ctx),n=await native(ctx);if(!proof||!n||n.id!==proof.containerId||n.state.StartedAt!==proof.startedAt||n.state.Running||n.state.ExitCode!==0||n.state.OOMKilled||n.state.Dead||await c.state()!=='offline')throw Error('OpenWorld direct native shutdown0 unproved');
 if(/grace expired|escalating owned process|Native process exited:/i.test(await logs(ctx,n.state.StartedAt))||JSON.stringify(await installedSource(ctx,c))!==JSON.stringify(proof.hashes))throw Error('OpenWorld stop escalated or source changed');
 return {...proof,engineNumericExit:0,engineExitProven:true};
}
const settingsURL=ctx=>'/api/client/servers/'+owned(ctx).uuid+'/game-settings?file='+encodeURIComponent(retentionRequiredPath);
export async function settings(ctx,c){
 await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','OpenWorld settings stop',budgets.stopMs);await cleanStop(ctx,c);
 const before=(await h.api(settingsURL(ctx))).attributes,field=before.fields?.filter(f=>f.key==='/MaxPlayers');
 if(field?.length!==1||field[0].type!=='number'||field[0].readonly===true||String(field[0].value)!=='10')throw Error('Existing editable publisher MaxPlayers10 required');
 const original=await snapshot(ctx);await ctx.artifact('openworld-config-intent.json',{fixture:ctx.fixture.server.uuid,beforeSHA:original.configSHA256,changes:{'/MaxPlayers':7},scope});
 await h.api(settingsURL(ctx),'PUT',{revision:before.revision,settings:{'/MaxPlayers':'7'}});
 const after=(await h.api(settingsURL(ctx))).attributes;if(String(after.fields?.find(f=>f.key==='/MaxPlayers')?.value)!=='7'||after.revision===before.revision)throw Error('OpenWorld typed capacity readback failed');
 const edited=await snapshot(ctx);for(const [path,meta]of Object.entries(original.initialized))if(path!=='Data/Config.json'&&JSON.stringify(meta)!==JSON.stringify(edited.initialized[path]))throw Error('Unrelated initialized data changed');
 contexts.set(ctx,{edited:true});ctx.startRequestedAt=Date.now();await c.power('start');const fresh=await wait(ctx,()=>ready(ctx,c),'OpenWorld edited native readiness',budgets.startupMs);
 const prior=await snapshot(ctx);const backupCommand=await command(ctx,'backup',/Backup/i);
 const backup=await wait(ctx,async()=>{const next=await snapshot(ctx);const added=Object.entries(next.backups).filter(([name,m])=>!prior.backups[name]&&m.sha256===next.configSHA256);return added.length===1?{file:added[0][0],...added[0][1]}:false;},'OpenWorld actual native backup config identity',30000);
 contexts.set(ctx,{edited:true,backup});return {backupCommand,changes:{'/MaxPlayers':7},nativeConsumption:'Fresh publisher status Max Players7',backup,fresh,scope};
}
export function retentionPaths(ctx){owned(ctx);return ['/Data','/Players','/Saves','/Settlements','/Backups','/OpenWorldServer','/OpenWorldServer.dll','/.voltra/openworld/release.json'];}
export function restoreContext(ctx,saved){if(!saved?.baseline?.initialized||!saved.backup||saved.engineNumericExit!==0||saved.engineExitProven!==true||!saved.processProof?.engine?.direct)throw Error('OpenWorld saved proof absent');contexts.set(ctx,{edited:true,backup:saved.backup});}
export async function saved(ctx,c){
 const context=contexts.get(ctx);if(!context?.edited||!context.backup)throw Error('OpenWorld native backup/settings proof absent');
 const processProof=await cleanStop(ctx,c),baseline=await snapshot(ctx);if(!baseline.backups[context.backup.file]||baseline.backups[context.backup.file].sha256!==context.backup.sha256)throw Error('OpenWorld native backup identity missing');
 return {baseline,backup:context.backup,processProof,engineNumericExit:0,engineExitProven:true,scope};
}
export async function loaded(ctx,c,saved){
 restoreContext(ctx,saved);const fresh=await ready(ctx,c);if(!fresh||fresh.startedAt===saved.processProof.startedAt)throw Error('OpenWorld fresh reload absent');
 await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','OpenWorld reload stop',budgets.stopMs);const stop=await cleanStop(ctx,c),after=await snapshot(ctx);
 if(JSON.stringify(saved.baseline.initialized)!==JSON.stringify(after.initialized)||after.backups[saved.backup.file]?.sha256!==saved.backup.sha256)throw Error('OpenWorld initialized native state/backup changed across reload');
 return {fresh,stop,initializedStateRetained:true,nativeWorldCreated:false,scope};
}
