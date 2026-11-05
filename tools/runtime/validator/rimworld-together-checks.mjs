import net from 'node:net';
import { readFile, lstat } from 'node:fs/promises';
import { createHash, randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Historical publisher/protocol research: artifacts/rimworld-together-native-acceptance.json,
// .local/sonic-rimworld-protocol.mjs, together-PM_Handshake.cs and together-CMD_Backup.cs.
// Fresh verbose-handshake consumption and ZIP layout are assertions to prove, not prior passes.
const recipe='rimworld/together/egg-rimworld-together.json';
export const registration={rimworld_together:{recipe,ports:1,environment:{VERSION:'26.10.20.1_(1)',MAX_PLAYERS:'100',VERBOSE:'false',REGISTER_SERVER:'false',SERVER_NAME:'Validator Together',SERVER_TELEMETRY:'false',AUTO_UPDATE:'0'}}};
export const budgets={memoryMiB:1024,diskMiB:2048,startupMs:120000,stopMs:60000};
export const retentionRequiredPath='/Configs/ServerConfig.json';
const binarySHA='c46c3b6a83e884eb6156bdd3acc897c35768644e69fa905f057cb4fe647d237c';
const archiveSHA='f4ede1e26d574e83cfdda91d441d1f3e204abea700db5dede8ac4fc35c3fd324';
const pythonImage='sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8';
const startup='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/sonic_rimworld.py run together';
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
const scope='Idle standalone mod server: rejected unauthenticated handshake, typed Verbosity consumption, native backup and initialized configuration/assets retention. No players, generated planet, player saves, gameplay or WAN; capacity/name consumption not claimed.';
const proofs=new WeakMap(), contexts=new WeakMap();
function owned(ctx){
 const f=ctx.fixture,s=f?.server;
 if(ctx.game.family!=='rimworld_together'||ctx.game.recipe!==recipe||f?.recipe!==recipe||!s||s.uuid!==ctx.game.serverUUID||s.name!=='validator-'+ctx.game.id||ctx.game.testStartup||f.ports?.length!==1||!Number.isInteger(f.ports[0])||f.ports[0]<1025||f.ports[0]>65535)throw Error('Exact isolated Together fixture/allocation required');
 return s;
}
export async function installedSource(ctx,c){
 const s=owned(ctx),p=h.profileFromRuntime(recipe,receipt),actual=(await h.api('/api/application/servers/'+s.id)).attributes;
 if(actual.uuid!==s.uuid||actual.egg!==ctx.fixture.egg.id||Number(actual.node)===202||actual.name!==s.name||p.egg.startup!==startup||actual.container?.startup_command!==startup||p.egg.config.stop!=='quit')throw Error('Together source/launch authority differs');
 const emitted=Object.fromEntries([...p.egg.scripts.installation.script.matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>[m[1],sha(m[3]+'\n')]));
 for(const [path,hash] of Object.entries(pins))if(emitted[path]!==hash||sha(await c.read('/'+path))!==hash)throw Error('Together exact emitted helper differs: '+path);
 const rel=JSON.parse(await c.read('/.voltra/together/release.json'));
 // The installer publication receipt has an archive identity and actual binary identity.
 const archive=rel.archive??rel;
 if(rel.game!=='together'||rel.version!=='26.10.20.1_(1)'||archive.sha256!==archiveSHA||archive.bytes!==31679969||rel.binary_sha256!==binarySHA)throw Error('Together exact release receipt shape/version/hash differs; preserve actual receipt for review');
 return {helpers:pins,archiveSHA256:archiveSHA,binarySHA256:binarySHA};
}
async function protocolKey(){
 const path='C:/Users/Veky/.t3/projects/pteroclone/ptero-go/.local/sonic-rimworld/inspection/RTShared.dll';
 if((await lstat(path)).isSymbolicLink())throw Error('Protocol reference assembly must be regular');
 const data=await readFile(path);
 if(sha(data)!=='8f2e0d096913df3473ab92f45074ea5620c938b2601d124d7e23900c400520f1')throw Error('Reviewed public protocol assembly differs');
 const matches=new Set();
 for(const offset of [0,1])for(const m of data.subarray(offset).toString('utf16le').matchAll(/[a-f0-9]{64}/g))if(sha(m[0])==='e420144349ac5024a8247ea42bb27edfd4e16e14587dca1bafc21ab501e99b37')matches.add(m[0]);
 if(matches.size!==1)throw Error('Publisher public handshake constant missing/ambiguous');
 return [...matches][0];
}
async function handshake(ctx){
 const key=await protocolKey(),salt=randomBytes(16),iv=randomBytes(16),cipher=createCipheriv('aes-256-cbc',pbkdf2Sync(key,salt,256,32,'sha1'),iv);
 const payload=Buffer.concat([salt,iv,cipher.update(Buffer.from([0x94,0,0xc0,0x90,0])),cipher.final()]),header=Buffer.alloc(5);header[0]=1;header.writeInt32LE(payload.length,1);
 return new Promise((resolve,reject)=>{
  let received=Buffer.alloc(0),done=false;const socket=net.createConnection({host:'127.0.0.1',port:ctx.fixture.ports[0]});
  const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);ctx.signal.removeEventListener('abort',abort);socket.destroy();error?reject(error):resolve({response:'Handshake.Deny',missingManagers:true,authenticatedPlayer:false});};
  const abort=()=>finish(Error('Together handshake aborted')),timer=setTimeout(()=>finish(Error('Together handshake timeout')),5000);
  ctx.signal.addEventListener('abort',abort,{once:true});if(ctx.signal.aborted)return abort();
  socket.on('error',()=>finish(Error('Together handshake socket failed')));socket.on('connect',()=>socket.write(Buffer.concat([header,payload])));
  socket.on('end',()=>{if(!done)finish(Error('Native handshake ended without complete denial'));});
  socket.on('data',part=>{try{
   received=Buffer.concat([received,part]);if(received.length>1048576)throw Error('Oversized handshake');if(received.length<5)return;
   const length=received.readInt32LE(1);if(received[0]!==1||length<48||length>1048571||(length-32)%16)throw Error('Invalid handshake frame');if(received.length<length+5)return;if(received.length!==length+5)throw Error('Unexpected trailing native frame');
   const data=received.subarray(5),decipher=createDecipheriv('aes-256-cbc',pbkdf2Sync(key,data.subarray(0,16),256,32,'sha1'),data.subarray(16,32));
   if(!Buffer.concat([decipher.update(data.subarray(32)),decipher.final()]).equals(Buffer.from([0x94,0,0xc0,0x90,2])))throw Error('Expected native missing-managers denial');finish();
  }catch(error){finish(error);}});
 });
}
async function snapshot(ctx,process=false){
 const s=owned(ctx),n=await native(ctx);if(!n)throw Error('Together container identity absent');
 const source='/var/lib/voltra-parity-20261029/volumes/'+s.uuid;
 const [d]=JSON.parse(await docker(['inspect',n.id],ctx.signal));
 if(d.Name!=='/'+s.uuid||d.Mounts.filter(m=>m.Destination==='/home/container'&&m.Source===source).length!==1||d.Mounts.some(m=>m.Destination.startsWith('/home/container/')))throw Error('Together exact volume authority differs');
 if(process&&!d.State.Running)throw Error('Together native process missing');
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
binary,identity=observe(r/'RimworldTogether/RTServer',134217728)
assert identity['sha256']=='c46c3b6a83e884eb6156bdd3acc897c35768644e69fa905f057cb4fe647d237c','publisher binary differs'
configraw,configmeta=observe(r/'Configs/ServerConfig.json',4194304);config=json.loads(configraw)
assert config['UseUPnP'] is False and config['EnableServerBrowser'] is False and config['EnableServerTelemetry'] is False,'private controls changed'
manifest={}
for dirname in ['Configs','Assets']:
 directory=safe(r/dirname);assert directory.is_dir(),'native initialized directory absent'
 paths=list(directory.rglob('*'));assert len(paths)<10000,'oversized native state'
 for p in paths:
  safe(p)
  if p.is_file():
   relative=str(p.relative_to(r))
   if any(relative.startswith('Assets/'+part+'/') for part in ['Users','Saves','Maps','Settlements']):raise ValueError('unexpected player/planet data; preserve fixture')
   data,meta=observe(p,4194304);manifest[relative]=meta
for path in ['Assets/IPBans.json','Assets/Leaderboard.json','Assets/Market.json','Assets/Rivers.json','Assets/Roads.json','Configs/BackupConfig.json','Configs/ServerConfig.json']:
 assert path in manifest,'native initialized identity component absent'
backups={}
folder=safe(r/'Backups/Servers')
if folder.exists():
 for p in folder.iterdir():
  safe(p)
  if p.suffix!='.zip':continue
  data,meta=observe(p);meta['mtimeNs']=p.stat().st_mtime_ns
  with zipfile.ZipFile(p) as z:
   entries=z.infolist();assert len(entries)<10000 and sum(x.file_size for x in entries)<67108864,'oversized native backup'
   for x in entries:
    n=PurePosixPath(x.filename)
    assert not n.is_absolute() and '..' not in n.parts and chr(92) not in x.filename and not stat.S_ISLNK(x.external_attr>>16),'unsafe native backup member'
   assert z.testzip() is None,'native backup CRC failure'
   configs=[x for x in entries if x.filename=='Configs/ServerConfig.json' or x.filename.endswith('/Configs/ServerConfig.json')]
   assert len(configs)==1,'native backup config identity unproved'
   meta['configSHA256']=hashlib.sha256(z.read(configs[0])).hexdigest()
  backups[p.name]=meta
engines=[]
if ${process ? 'True' : 'False'}:
 for p in Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   if (p/'exe').resolve()!=(r/'RimworldTogether/RTServer').resolve():continue
   pp=int(next(x.split()[1] for x in (p/'status').read_text().splitlines() if x.startswith('PPid:')))
   parent=Path('/proc')/str(pp);args=(parent/'cmdline').read_bytes().split(b'\0')[:-1]
   engines.append(dict(pid=int(p.name),ppid=pp,direct=args[1:]==[b'.voltra/sonic_rimworld.py',b'run',b'together'] and (parent/'exe').resolve()==(r/'.voltra/python/bin/python3').resolve(),cwd=os.readlink(p/'cwd')))
  except (FileNotFoundError,ProcessLookupError):pass
print(json.dumps(dict(binary=identity,config={k:config[k] for k in ['Name','MaxPlayers','Verbosity','Port','UseUPnP','EnableServerBrowser','EnableServerTelemetry']},configSHA256=configmeta['sha256'],initialized=manifest,backups=backups,engines=engines),sort_keys=True))`;
 let out;
 if(d.State.Running)out=await docker(['exec','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib',n.id,'/home/container/.voltra/python/bin/python3','-B','-c',program],ctx.signal,30000);
 else{
  if(ctx.game.offlineHelperImage!==pythonImage)throw Error('Reviewed offline Python helper image required');
  out=await docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--cpus','1','--user','0:0','--cap-drop','ALL','--cap-add','DAC_READ_SEARCH','--security-opt','no-new-privileges','--mount','type=bind,source='+source+',target=/home/container,readonly',pythonImage,'python3','-B','-c',program],ctx.signal,30000);
 }
 const result=JSON.parse(out);await ctx.artifact('together-observation-'+Date.now()+'.json',result);return result;
}
async function command(ctx,input,pattern){
 const n=await native(ctx);if(!n?.state.Running)throw Error('Command requires running Together fixture');
 const before=await logs(ctx,n.state.StartedAt);
 await h.api('/api/client/servers/'+owned(ctx).uuid+'/command','POST',{command:input});
 return wait(ctx,async()=>{const next=await logs(ctx,n.state.StartedAt);if(!next.startsWith(before))throw Error('Together command log boundary changed');const fresh=plain(next.slice(before.length));return pattern.test(fresh)?{command:input,freshSHA256:sha(fresh)}:false;},'Together native '+input,30000);
}
export async function prerequisites(ctx,c){
 const hashes=await installedSource(ctx,c);if(await c.state()!=='offline'||(await native(ctx))?.state.Running)throw Error('Together prerequisites require parked fixture');
 if(ctx.game.offlineHelperImage!==pythonImage)throw Error('Reviewed offline helper required');
 await protocolKey();contexts.set(ctx,{edited:false});return {hashes,scope};
}
export async function ready(ctx,c){
 const n=await native(ctx);if(!n?.state||Date.parse(n.state.StartedAt)<ctx.startRequestedAt)return false;if(!n.state.Running)throw Error('Together exited before readiness');
 const text=plain(await logs(ctx,n.state.StartedAt));if(!text.includes('Server launched')||await c.state()!=='running')return false;
 if(!text.includes('Server version 26.10.20.1 (1)')||!text.includes('Listening for users at 0.0.0.0:'+ctx.fixture.ports[0]))throw Error('Together native version/listener differs');
 const hashes=await installedSource(ctx,c),observation=await snapshot(ctx,true);
 if(observation.engines.length!==1||!observation.engines[0].direct||observation.engines[0].cwd!=='/home/container')throw Error('Together direct native process authority unproved');
 const before=await logs(ctx,n.state.StartedAt),protocol=await handshake(ctx);
 if(contexts.get(ctx)?.edited){
  await wait(ctx,async()=>{const next=await logs(ctx,n.state.StartedAt);if(!next.startsWith(before))throw Error('Together handshake log boundary changed');return /Missing existing manager '[^']+'/.test(plain(next.slice(before.length)));},'Together consumed verbose handshake setting',15000);
  if(observation.config.Verbosity!==2)throw Error('Together native verbosity configuration differs');
 }
 const proof={containerId:n.id,startedAt:n.state.StartedAt,engine:observation.engines[0],hashes,protocol};proofs.set(ctx,proof);
 await command(ctx,'list',/Connected players: \[0\]/);
 if(!contexts.get(ctx)?.edited){
  const next=await logs(ctx,n.state.StartedAt);
  if(observation.config.Verbosity!==0||!next.startsWith(before)||/Missing existing manager '[^']+'/.test(plain(next.slice(before.length))))throw Error('Together baseline Verbosity0 suppression unproved');
 }
 return {...proof,scope};
}
async function cleanStop(ctx,c){
 const proof=proofs.get(ctx),n=await native(ctx);if(!proof||!n||n.id!==proof.containerId||n.state.StartedAt!==proof.startedAt||n.state.Running||n.state.ExitCode!==0||n.state.OOMKilled||n.state.Dead||await c.state()!=='offline')throw Error('Together direct native quit0 unproved');
 if(/grace expired|escalating owned process|Native process exited:/i.test(await logs(ctx,n.state.StartedAt))||JSON.stringify(await installedSource(ctx,c))!==JSON.stringify(proof.hashes))throw Error('Together stop escalated or source changed');
 return {...proof,engineNumericExit:0,engineExitProven:true};
}
const settingsURL=ctx=>'/api/client/servers/'+owned(ctx).uuid+'/game-settings?file='+encodeURIComponent(retentionRequiredPath);
export async function settings(ctx,c){
 await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','Together settings stop',budgets.stopMs);await cleanStop(ctx,c);
 const before=(await h.api(settingsURL(ctx))).attributes;
 const field=before.fields?.filter(f=>f.key==='/Verbosity');if(field?.length!==1||field[0].type!=='number'||field[0].readonly===true||String(field[0].value)!=='0')throw Error('Existing editable publisher Verbosity0 required');
 const original=await snapshot(ctx);
 await h.api(settingsURL(ctx),'PUT',{revision:before.revision,settings:{'/Verbosity':'2'}});
 const after=(await h.api(settingsURL(ctx))).attributes;if(String(after.fields?.find(f=>f.key==='/Verbosity')?.value)!=='2'||after.revision===before.revision)throw Error('Together typed verbosity readback failed');
 const edited=await snapshot(ctx);for(const [path,meta] of Object.entries(original.initialized))if(path!=='Configs/ServerConfig.json'&&JSON.stringify(meta)!==JSON.stringify(edited.initialized[path]))throw Error('Together unrelated initialized state changed by typed edit');
 contexts.set(ctx,{edited:true});ctx.startRequestedAt=Date.now();await c.power('start');const fresh=await wait(ctx,()=>ready(ctx,c),'Together edited readiness',budgets.startupMs);
 const prior=await snapshot(ctx),requestedAt=Date.now();await command(ctx,'backup',/\[Server backup\] > \/home\/container\/Backups\/Servers\/Server_[^\r\n]+\.zip/);
 const backup=await wait(ctx,async()=>{const next=await snapshot(ctx);const added=Object.entries(next.backups).filter(([name,m])=>!prior.backups[name]&&m.mtimeNs/1e6>=requestedAt-2000&&m.configSHA256===next.configSHA256);return added.length===1?{file:added[0][0],...added[0][1]}:false;},'Together native backup with current typed config',30000);
 contexts.set(ctx,{edited:true,backup});return {changes:{'/Verbosity':2},nativeConsumption:'Fresh missing-manager diagnostics emitted after rejected handshake at Verbosity2',backup,fresh,scope};
}
export function retentionPaths(ctx){owned(ctx);return ['/Configs','/Assets','/Backups','/RimworldTogether','/.voltra/together/release.json'];}
export function restoreContext(ctx,saved){if(!saved?.baseline?.initialized||!saved.backup||saved.engineNumericExit!==0||saved.engineExitProven!==true||!saved.processProof?.engine?.direct)throw Error('Together saved proof absent');contexts.set(ctx,{edited:true,backup:saved.backup});}
export async function saved(ctx,c){
 const context=contexts.get(ctx);if(!context?.edited||!context.backup)throw Error('Together native backup/settings proof absent');
 const processProof=await cleanStop(ctx,c),baseline=await snapshot(ctx);if(!baseline.backups[context.backup.file]||baseline.backups[context.backup.file].sha256!==context.backup.sha256)throw Error('Together native backup identity missing');
 return {baseline,backup:context.backup,processProof,engineNumericExit:0,engineExitProven:true,scope};
}
export async function loaded(ctx,c,saved){
 restoreContext(ctx,saved);const fresh=await ready(ctx,c);if(!fresh||fresh.startedAt===saved.processProof.startedAt)throw Error('Together fresh reload absent');
 await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','Together reload stop',budgets.stopMs);const stop=await cleanStop(ctx,c),after=await snapshot(ctx);
 if(JSON.stringify(saved.baseline.initialized)!==JSON.stringify(after.initialized)||after.backups[saved.backup.file]?.sha256!==saved.backup.sha256)throw Error('Together initialized native state/backup changed across reload');
 return {fresh,stop,initializedStateRetained:true,nativeWorldCreated:false,scope};
}
