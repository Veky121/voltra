import net from 'node:net';
import dgram from 'node:dgram';
import {randomBytes,randomInt} from 'node:crypto';
import {campaign as h,docker} from './campaign-session.mjs';
import {native,logs,wait,command} from './campaign-adapter.mjs';
import {recipe,installedSource,publisherJars,hash,verifyCrossplayExposure} from './crossplay-canonical-check.mjs';
export {verifyBuild} from './game-checks.mjs';
export {installedSource};
export const registration={crossplay:{recipe,ports:3,environment:{MINECRAFT_VERSION:'26.3',SERVER_JARFILE:'server.jar',BUILD_NUMBER:'2654',GEYSER_TRANSPORT:'both',DL_PATH:'',DOWNLOAD_SHA256:''}}};
export const budgets={memoryMiB:3072,diskMiB:4096,startupMs:240000,stopMs:90000};
export const retentionRequiredPath='/world/level.dat';
const helper='sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8';
const contexts=new WeakMap(),proofs=new WeakMap(),readiness=new WeakMap();
const scope='Idle native Java status, RakNet discovery, Java typed properties consumption, console-created storage marker and publisher world reload. No client login, authenticated crossplay, gameplay, voice/WebRTC session or WAN proof.';
function owned(ctx){const f=ctx.fixture;if(ctx.game.family!=='crossplay'||ctx.game.recipe!==recipe||f?.recipe!==recipe||f.server.uuid!==ctx.game.serverUUID||f.server.name!=='validator-'+ctx.game.id||f.ports.length!==3||new Set(f.ports).size!==3||!f.ports.every(p=>Number.isInteger(p)&&p>1024&&p<=65535)||ctx.game.testStartup)throw Error('Exact three-port Crossplay fixture required');return f.server;}
function vint(value){const out=[];do{let b=value&127;value>>>=7;if(value)b|=128;out.push(b)}while(value);return Buffer.from(out)}
function readVint(b,at=0){let value=0;for(let n=0;n<5;n++){if(at+n>=b.length)return null;const byte=b[at+n];value|=(byte&127)<<(n*7);if(!(byte&128))return{value,bytes:n+1}}throw Error('Oversized Minecraft VarInt');}
const packet=body=>Buffer.concat([vint(body.length),body]);
async function javaQuery(ctx,capacity,motd){return new Promise((resolve,reject)=>{
 const port=ctx.fixture.ports[0],nonce=randomBytes(8),socket=net.createConnection({host:'127.0.0.1',port});let data=Buffer.alloc(0),status,done=false;
 const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);ctx.signal.removeEventListener('abort',abort);socket.destroy();error?reject(error):resolve(value)};
 const abort=()=>finish(Error('Crossplay status aborted')),timer=setTimeout(()=>finish(Error('Crossplay native status timeout')),5000);ctx.signal.addEventListener('abort',abort,{once:true});
 socket.on('error',()=>finish(Error('Crossplay status socket failed')));socket.on('close',()=>{if(!done)finish(Error('Crossplay status closed before nonce reply'))});
 socket.on('connect',()=>{const address=Buffer.from('127.0.0.1'),p=Buffer.alloc(2);p.writeUInt16BE(port);socket.write(Buffer.concat([packet(Buffer.concat([vint(0),vint(777),vint(address.length),address,p,vint(1)])),packet(vint(0))]))});
 socket.on('data',chunk=>{try{data=Buffer.concat([data,chunk]);if(data.length>524288)throw Error('Oversized status payload');while(data.length){const length=readVint(data);if(!length||data.length<length.bytes+length.value)return;const body=data.subarray(length.bytes,length.bytes+length.value);data=data.subarray(length.bytes+length.value);const id=readVint(body);if(!id)throw Error('Missing packet type');if(!status){if(id.value!==0)throw Error('Not native status JSON');const size=readVint(body,id.bytes);if(!size||body.length!==id.bytes+size.bytes+size.value)throw Error('Invalid status JSON frame');status=JSON.parse(body.subarray(id.bytes+size.bytes).toString());if(status.version?.protocol!==777||status.players?.online!==0||(capacity!==undefined&&status.players?.max!==capacity)||(motd!==undefined&&(typeof status.description==='string'?status.description:status.description?.text)!==motd))throw Error('Native Crossplay legacy/settings status differs');socket.write(packet(Buffer.concat([vint(1),nonce])))}else{if(id.value!==1||!body.subarray(id.bytes).equals(nonce))throw Error('Native ping nonce mismatch');finish(null,{...status,nonceEcho:true,playerLoginSent:false})}}}catch(error){finish(error)}});if(ctx.signal.aborted)abort();
});}
async function raknet(ctx){
 const port=ctx.fixture.ports[1],magic=Buffer.from('00ffff00fefefefefdfdfdfd12345678','hex'),nonce=randomBytes(8),request=Buffer.concat([Buffer.from([1]),nonce,magic,randomBytes(8)]);
 return new Promise((resolve,reject)=>{const socket=dgram.createSocket('udp4');let done=false;
 const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);ctx.signal.removeEventListener('abort',abort);socket.close();error?reject(error):resolve(value);};
 const abort=()=>finish(Error('Crossplay RakNet aborted')),timer=setTimeout(()=>finish(Error('Crossplay RakNet timeout')),5000);
 ctx.signal.addEventListener('abort',abort,{once:true});socket.on('error',()=>finish(Error('Crossplay RakNet socket failed')));
 socket.on('message',(data,peer)=>{if(peer.address!=='127.0.0.1'||peer.port!==port)return;try{if(data.length<35||data.length>16384||data[0]!==0x1c||!data.subarray(1,9).equals(nonce)||!data.subarray(17,33).equals(magic))throw Error('Invalid native RakNet pong');const size=data.readUInt16BE(33);if(data.length!==size+35)throw Error('RakNet size differs');const p=data.subarray(35).toString().split(';');if(p[0]!=='MCPE'||Number(p[4])!==0||!Number.isInteger(Number(p[5]))||Number(p[5])<1)throw Error('Crossplay discovery is not idle MCPE');finish(null,{motd:p[1],protocol:p[2],gameVersion:p[3],players:0,maxPlayers:Number(p[5]),nonceEcho:true,playerLoginSent:false});}catch(error){finish(error);}});
 socket.send(request,port,'127.0.0.1',error=>{if(error)finish(Error('Crossplay RakNet send failed'));});if(ctx.signal.aborted)abort();});
}
// Only the exact UTC Properties.store header observed in the frozen publisher is
// eligible. Every other byte, including comments, escapes and line endings, stays strict.
export function propertiesEvidence(rawBase64,meta,generation){
 const raw=Buffer.from(rawBase64,'base64');
 if(raw.toString('base64')!==rawBase64||raw.length>65536||raw.length!==meta.size||hash(raw)!==meta.sha256)throw Error('Crossplay raw properties evidence differs');
 const text=raw.toString('latin1'),match=/^#Minecraft server properties\n#((?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-3][0-9] [0-2][0-9]:[0-5][0-9]:[0-5][0-9] UTC [0-9]{4})\n/.exec(text);
 let timestamp=null,nonTimestampSHA256=null;
 if(match){
  const ms=Date.parse(match[1]),date=new Date(ms);
  const formatted=Number.isFinite(ms)?date.toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) (\S+) GMT$/, '$1 $3 $2 $5 UTC $4'):null;
  if(formatted===match[1]){timestamp=new Date(ms).toISOString();nonTimestampSHA256=hash(Buffer.concat([Buffer.from('#Minecraft server properties\n','latin1'),raw.subarray(match[0].length)]));}
 }
 return {rawBase64,sha256:meta.sha256,timestamp,nonTimestampSHA256,generation,
  // Diagnostic exact generated key/value lines; never used to permit a change.
  semanticLinesSHA256:hash(text.split('\n').filter(line=>line&&!/^[#!]/.test(line)).sort().join('\n'))};
}
export function compareReloadFiles(before,after,baseline,current){
 const names=Object.keys(before).sort();if(JSON.stringify(names)!==JSON.stringify(Object.keys(after).sort()))return {accepted:false,reason:'file set changed'};
 const changed=names.filter(name=>JSON.stringify(before[name])!==JSON.stringify(after[name]));
 if(!changed.length)return {accepted:true,reason:'raw files identical'};
 if(changed.length!==1||changed[0]!=='server.properties')return {accepted:false,reason:'other raw files changed',changed};
 try{
  if(baseline.writerSHA256!=='f6bb7bc48ca44d3633e2bd0de447624f439187292899e2b6fc7092ceb26bd2da'||current.writerSHA256!==baseline.writerSHA256)throw Error('Frozen publisher writer proof absent');
  const a=propertiesEvidence(baseline.rawBase64,before['server.properties'],baseline.generation),b=propertiesEvidence(current.rawBase64,after['server.properties'],current.generation);
  const meta=x=>Object.fromEntries(Object.entries(x).filter(([k])=>k!=='sha256'));
  const bounded=e=>{const g=e.generation,t=Date.parse(e.timestamp);return e.timestamp&&g?.containerId&&Number.isFinite(Date.parse(g.startedAt))&&Number.isFinite(Date.parse(g.finishedAt))&&t>=Date.parse(g.startedAt)-1000&&t<=Date.parse(g.finishedAt);};
  const withoutTimestamp=e=>{const raw=Buffer.from(e.rawBase64,'base64'),first=raw.indexOf(10),second=raw.indexOf(10,first+1);return Buffer.concat([raw.subarray(0,first+1),raw.subarray(second+1)]);};
  const accepted=JSON.stringify(meta(before['server.properties']))===JSON.stringify(meta(after['server.properties']))&&a.nonTimestampSHA256&&a.nonTimestampSHA256===b.nonTimestampSHA256&&withoutTimestamp(a).equals(withoutTimestamp(b))&&bounded(a)&&bounded(b)&&Date.parse(b.generation.startedAt)>Date.parse(a.generation.finishedAt)&&Date.parse(b.timestamp)>Date.parse(a.timestamp)&&/^[a-f0-9-]{36}$/.test(a.generation.fixtureUUID??'')&&a.generation.fixtureUUID===b.generation.fixtureUUID;
  return {accepted:!!accepted,reason:accepted?'exact generated UTC timestamp only; fresh generation bounded':'timestamp/raw/metadata/generation boundary differs',changed,before:a,after:b};
 }catch(error){return {accepted:false,reason:'fresh raw baseline required: '+error.message,changed};}
}
async function observe(ctx,process=false,world=false){
 const server=owned(ctx),n=await native(ctx);if(!n)throw Error('Crossplay container absent');const [d]=JSON.parse(await docker(['inspect',n.id],ctx.signal));
 const source='/var/lib/voltra-parity-20261029/volumes/'+server.uuid;
 if(d.Name!=='/'+server.uuid||d.Mounts.filter(m=>m.Destination==='/home/container'&&m.Source===source).length!==1||d.Mounts.some(m=>m.Destination.startsWith('/home/container/'))||Number(d.HostConfig.Memory)!==0||process&&!d.State.Running||world&&d.State.Running)throw Error('Crossplay exact volume/process/diagnostic memory0 boundary differs');
 const program=String.raw`import os,sys,json,hashlib,stat,gzip,io,struct,re,base64,zipfile
from pathlib import Path
r=Path('/home/container');pins=json.loads(sys.argv[1]);wantprocess=sys.argv[2]=='true';wantworld=sys.argv[3]=='true';ports=json.loads(sys.argv[4])
def safe(p):
 for q in [p,*p.parents]:
  if q==r.parent:break
  if q.is_symlink():raise ValueError('Symlink in native identity')
 return p
def digest(p):
 safe(p);a=p.stat()
 if not stat.S_ISREG(a.st_mode) or a.st_size>268435456:raise ValueError('Invalid native file')
 h=hashlib.sha256()
 with p.open('rb') as f:
  for chunk in iter(lambda:f.read(1048576),b''):h.update(chunk)
 b=p.stat()
 if (a.st_ino,a.st_size,a.st_mtime_ns)!=(b.st_ino,b.st_size,b.st_mtime_ns):raise ValueError('File changed during observation')
 return dict(sha256=h.hexdigest(),size=b.st_size,mode=stat.S_IMODE(b.st_mode),uid=b.st_uid,gid=b.st_gid)
files={}
for name,pin in pins.items():
 files[name]=digest(r/name)
 assert files[name]['sha256']==pin,'Publisher JAR differs'
for name in ['server.properties','plugins/Geyser-Spigot/config.yml','plugins/floodgate/config.yml']:
 files[name]=digest(r/name)
geyser=(r/'plugins/Geyser-Spigot/config.yml').read_text()
assert re.findall(r'^\s*stun-discovery:\s*(true|false)\s*$',geyser,re.M)==['false'],'STUN discovery must remain disabled'
assert re.findall(r'^\s*auth-type:\s*(\S+)\s*$',geyser,re.M)==['floodgate'],'Native auth owner differs'
assert re.findall(r'^\s*webrtc-port:\s*(\d+)\s*$',geyser,re.M)==[str(ports[2])],'Allocated media configuration differs'
assert re.findall(r'^\s*transport:\s*(\S+)\s*$',geyser,re.M)==['both'],'Both native transports must remain configured'
engines=[];candidates=[]
if wantprocess:
 for p in Path('/proc').iterdir():
  if not p.name.isdigit():continue
  candidate=None;stage='exe'
  try:
   exe=(p/'exe').resolve()
   stage='cmdline'
   argv=(p/'cmdline').read_bytes().split(b'\0')[:-1]
   if exe.name!='java' and not (argv and Path(os.fsdecode(argv[0])).name=='java'):continue
   jar=argv[argv.index(b'-jar')+1] if b'-jar' in argv and argv.index(b'-jar')+1<len(argv) else None
   candidate=dict(pid=int(p.name),exe=str(exe),exeLink=os.readlink(p/'exe'),heapFlags=[os.fsdecode(x)for x in argv if re.fullmatch(rb'-Xm[sx][0-9]+[mMgGkK]?',x)],jarTarget=os.fsdecode(jar)if jar else None)
   candidates.append(candidate)
   if exe.name!='java':candidate['rejected']='exe-basename';continue
   if jar not in [b'server.jar',b'/home/container/server.jar']:candidate['rejected']='jar-target';continue
   stage='parent'
   parent=int(next(x.split()[1]for x in (p/'status').read_text().splitlines()if x.startswith('PPid:')))
   pid1java=int(p.name)==1 and parent==0
   candidate.update(ppid=parent,pid1Exe=str(Path('/proc/1/exe').resolve()),directPID1=pid1java)
   heap=[x.decode()for x in argv if x.startswith(b'-Xmx')]
   assert heap in [['-Xmx2048M'],['-Xmx2048m'],['-Xmx2G'],['-Xmx2g']],'Exact 2GiB JVM heap required'
   if not pid1java:
    parentpath=Path('/proc')/str(parent);parentargs=(parentpath/'cmdline').read_bytes().split(b'\0')[:-1]
    candidate.update(parentExe=str((parentpath/'exe').resolve()),parentEntrypoint=b'/entrypoint.sh'in parentargs)
    outer=parent==1 or ((parentpath/'exe').resolve().name=='bash' and b'/entrypoint.sh'in parentargs and int(next(x.split()[1]for x in(parentpath/'status').read_text().splitlines()if x.startswith('PPid:')))==1)
    assert outer and Path('/proc/1/exe').resolve().name=='tini','Unreviewed Java exit propagation'
   stage='entrypoint'
   entry=hashlib.sha256(Path('/proc/1/root/entrypoint.sh').read_bytes()).hexdigest()
   expectedentry='efc2aa2c66d43ed491860147ccc635e2d164c8ab9a50032d34c846b1ac540bb3' if pid1java else '32ae2a4f09300d31db2e10379a935614fc95f743da134eefbef61019dd4da4c4'
   assert entry==expectedentry,'Unreviewed entrypoint'
   stage='udp';udp=[]
   for table in ['udp','udp6']:
    for line in (p/'net'/table).read_text().splitlines()[1:]:
     cells=line.split();udp.append(int(cells[1].split(':')[1],16))
   candidate.update(namespaceUdpPorts=sorted(set(udp)),raknetUdpPresent=ports[1]in udp,mediaUdpPresent=ports[2]in udp)
   # Pinned Geyser NetherNetServer supplies webrtcPort as ICE_ADDRESS;
   # NetherNetServerChannel.bindIce configures the fixed UDP range, but
   # PeerConnection.createPeer is called only by acceptConnection. doBind
   # starts signaling, not an idle media peer. Never fabricate a player.
   engines.append(dict(pid=int(p.name),ppid=parent,direct=True,heapMiB=2048,entrypointSHA256=entry,allocatedRaknetUdpListener=ports[1]in udp,media=dict(configuredPort=ports[2],udpObserved=ports[2]in udp,nativePeerProof='not exercised: requires connection',sourceClassSHA256='eae87d3d64d482b6ddc18d702113e943f16139f685351b14900133703888985f')))
  except (FileNotFoundError,ProcessLookupError)as error:
   if candidate is not None:candidate.update(observationError=type(error).__name__,observationStage=stage)
publisher=safe(r/'versions/26.3/purpur-26.3.jar')
assert digest(publisher)['sha256']=='e80d28abbabc757bc0c5e3b534f29346509a42992a544c2e800f430f88d1177e','Frozen publisher runtime differs'
with zipfile.ZipFile(publisher) as archive:
 writer=hashlib.sha256(archive.read('net/minecraft/server/dedicated/Settings.class')).hexdigest()
assert writer=='f6bb7bc48ca44d3633e2bd0de447624f439187292899e2b6fc7092ceb26bd2da','Frozen properties writer differs'
properties=safe(r/'server.properties').read_bytes()
assert len(properties)<=65536 and hashlib.sha256(properties).hexdigest()==files['server.properties']['sha256'],'Properties changed during raw observation'
out=dict(files=files,engines=engines,processCandidates=candidates,propertiesWriterSHA256=writer,propertiesRawBase64=base64.b64encode(properties).decode())
def read_nbt(relative):
 p=safe(r/relative);meta=digest(p)
 if meta['size']>4194304:raise ValueError('Oversized compressed NBT')
 raw=p.read_bytes();data=gzip.GzipFile(fileobj=io.BytesIO(raw)).read(4194305)
 if len(data)>4194304:raise ValueError('Oversized NBT')
 at=0
 def take(n):
  nonlocal at
  if n<0 or at+n>len(data):raise ValueError('Truncated NBT')
  v=data[at:at+n];at+=n;return v
 def num(f):return struct.unpack('>'+f,take(struct.calcsize(f)))[0]
 def text():return take(num('H')).decode('utf8')
 def tag(t,depth=0):
  if depth>32:raise ValueError('NBT depth')
  if t in [1,2,3,4,5,6]:return num({1:'b',2:'h',3:'i',4:'q',5:'f',6:'d'}[t])
  if t==8:return text()
  if t in [7,11,12]:
   n=num('i')
   if n<0 or n>1048576:raise ValueError('Array bound')
   take(n*{7:1,11:4,12:8}[t]);return None
  if t==9:
   kind=num('B');n=num('i')
   if n<0 or n>100000:raise ValueError('List bound')
   return [tag(kind,depth+1)for _ in range(n)]
  if t==10:
   result={}
   while True:
    kind=num('B')
    if kind==0:return result
    key=text()
    if key in result:raise ValueError('Duplicate NBT key')
    result[key]=tag(kind,depth+1)
  raise ValueError('Unknown NBT tag')
 if num('B')!=10:raise ValueError('NBT root')
 text();root=tag(10)
 if at!=len(data) or p.read_bytes()!=raw:raise ValueError('Stopped NBT changed or trailing bytes')
 return root,meta
if wantworld:
 root,meta=read_nbt('world/level.dat');world=root.get('Data',{})
 gen,genmeta=read_nbt('world/dimensions/minecraft/overworld/data/minecraft/world_gen_settings.dat')
 storage,storagemeta=read_nbt('world/data/voltra/command_storage.dat')
 seed=gen.get('data',{}).get('seed');marker=storage.get('data',{}).get('contents',{}).get('crossplay',{}).get('marker')
 if any(v!=5023 for v in [world.get('DataVersion'),gen.get('DataVersion'),storage.get('DataVersion')]):raise ValueError('Unreviewed native NBT version')
 if type(seed)!=int or world.get('LevelName')!='world' or type(marker)!=int:raise ValueError('Native world identity or storage marker missing')
 out['world']=dict(seed=str(seed),name=world['LevelName'],level=meta,generation=genmeta,marker=marker,storage={'world/data/voltra/command_storage.dat':storagemeta},layout='namespaced dimension data version5023')
print(json.dumps(out,sort_keys=True))`;
 const args=['-B','-c',program,JSON.stringify(publisherJars),String(process),String(world),JSON.stringify(ctx.fixture.ports)];
 if(ctx.game.offlineHelperImage!==helper)throw Error('Reviewed Python observer required');
 // Java image need not contain Python. Read-only helper joins only the owned PID
 // namespace to inspect its processes; it has no network or writable game mount.
 const output=await docker(['run','--rm','--pull','never','--user','0:0','--network','none',...(d.State.Running?['--pid','container:'+n.id,'--cap-add','SYS_PTRACE']:[]),'--read-only','--memory','256m','--cpus','1','--cap-drop','ALL','--cap-add','DAC_READ_SEARCH','--security-opt','no-new-privileges','--mount','type=bind,source='+source+',target=/home/container,readonly',helper,'python3',...args],ctx.signal,30000);
 const after=await native(ctx);if(after?.id!==n.id||after.state.Running!==d.State.Running||after.state.StartedAt!==d.State.StartedAt||after.state.FinishedAt!==d.State.FinishedAt)throw Error('Crossplay observation process boundary changed');
 const result=JSON.parse(output);result.properties=propertiesEvidence(result.propertiesRawBase64,result.files['server.properties'],{fixtureUUID:server.uuid,containerId:n.id,startedAt:d.State.StartedAt,finishedAt:d.State.FinishedAt});result.properties.writerSHA256=result.propertiesWriterSHA256;delete result.propertiesRawBase64;return result;
}
export async function prerequisites(ctx,c){
 owned(ctx);if(await c.state()!=='offline')throw Error('Park Crossplay before preparation');
 if(String(ctx.game.environment.BEDROCK_PORT)!==String(ctx.fixture.ports[1])||String(ctx.game.environment.WEBRTC_PORT)!==String(ctx.fixture.ports[2]))throw Error('Explicit allocated Crossplay UDP/media ports required');
 const source=await installedSource(ctx,c);await c.write('/eula.txt','eula=true\n');await ctx.artifact('crossplay-eula.json',{accepted:true,at:new Date().toISOString(),method:'Owned file API write eula=true before first native start',authority:'User explicitly authorized EULA acceptance',terms:'https://www.minecraft.net/eula',fixture:ctx.fixture.server.uuid});
 contexts.set(ctx,{edited:false});return {source,scope,heapRequirementMiB:2048};
}
export async function ready(ctx,c){
 owned(ctx);const n=await native(ctx);if(!n?.state||Date.parse(n.state.StartedAt)<ctx.startRequestedAt)return false;if(!n.state.Running)throw Error('Crossplay exited before readiness');
 if(!/Done \([\d.]+s\)!/.test(await logs(ctx,n.state.StartedAt)))return false;
 const state=contexts.get(ctx);let query,bedrock;
 try{query=await javaQuery(ctx,state?.edited?7:undefined,state?.edited?state.motd:undefined);bedrock=await raknet(ctx);}catch(error){
  if(!['Crossplay status closed before nonce reply','Crossplay native status timeout','Crossplay status socket failed','Crossplay RakNet timeout','Crossplay RakNet socket failed'].includes(error.message))throw error;
  await ctx.artifact('crossplay-readiness-transport-'+Date.now()+'.json',{containerId:n.id,startedAt:n.state.StartedAt,error:error.message,scope:'Incomplete readiness observation; full nonce and native settings proof still required within existing deadline'});return false;
 }
 const snapshot=await observe(ctx,true);
 await ctx.artifact('crossplay-process-observation-'+Date.now()+'.json',{containerId:n.id,startedAt:n.state.StartedAt,candidates:snapshot.processCandidates,acceptedEngines:snapshot.engines,scope:'Read-only process identity diagnostics; excludes full argv and environment'});
 if(snapshot.engines.length!==1)throw Error('Crossplay Java process ambiguous');
 if(!snapshot.engines[0].allocatedRaknetUdpListener)throw Error('Allocated RakNet UDP listener missing');
 const source=await installedSource(ctx,c),proof={containerId:n.id,startedAt:n.state.StartedAt,engine:snapshot.engines[0],source};proofs.set(ctx,proof);
 await command(ctx,'list',/There are 0 of a max of \d+ players online/);
 const result={query,bedrock,processProof:proof,startedAt:n.state.StartedAt,scope};readiness.set(ctx,result);return result;
}
async function stopProof(ctx,c){
 const n=await native(ctx),p=proofs.get(ctx);if(!n||!p||n.id!==p.containerId||n.state.StartedAt!==p.startedAt||n.state.Running||n.state.ExitCode!==0||n.state.OOMKilled||n.state.Dead||await c.state()!=='offline')throw Error('Crossplay direct Java stop0 unproved');
 const text=await logs(ctx,n.state.StartedAt),savedDimensions=['overworld','the_nether','the_end'].filter(d=>new RegExp("Saved [0-9]+ block chunks, [0-9]+ entity chunks, [0-9]+ poi chunks in world 'minecraft:"+d+"'").test(text)),sourceMatches=JSON.stringify(await installedSource(ctx,c))===JSON.stringify(p.source);
 await ctx.artifact('crossplay-stop-observation-'+Date.now()+'.json',{containerId:n.id,startedAt:n.state.StartedAt,finishedAt:n.state.FinishedAt,logSHA256:hash(text),savedDimensions,sourceMatches,engineNumericExit:0});
 if(!/Stopping server/.test(text)||!(/All dimensions are saved|All chunks are saved/.test(text)||savedDimensions.length===3)||/grace expired|escalating owned process/.test(text)||!sourceMatches)throw Error('Crossplay native save/stop or source proof missing');
 return {...p,engineNumericExit:0,engineExitProven:true};
}
export async function settings(ctx,c){
 await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','Crossplay settings stop',budgets.stopMs);await stopProof(ctx,c);
 const url='/api/client/servers/'+owned(ctx).uuid+'/game-settings?file=%2Fserver.properties',before=(await h.api(url)).attributes;verifyCrossplayExposure(before);
 const motd='Validator Crossplay '+randomBytes(6).toString('hex');
 await h.api(url,'PUT',{revision:before.revision,settings:{'max-players':'7',motd}});
 const after=(await h.api(url)).attributes;if(String(after.fields.find(f=>f.key==='max-players')?.value)!=='7'||after.fields.find(f=>f.key==='motd')?.value!==motd||after.revision===before.revision)throw Error('Crossplay typed Java properties readback failed');
 const marker=randomInt(100000,999999);contexts.set(ctx,{edited:true,marker,motd});ctx.startRequestedAt=Date.now();await c.power('start');const fresh=await wait(ctx,()=>ready(ctx,c),'Crossplay typed native consumption',budgets.startupMs);
 await command(ctx,'data modify storage voltra:crossplay marker set value '+marker,/Modified storage voltra:crossplay/);
 await command(ctx,'data get storage voltra:crossplay marker',new RegExp('has the following contents: '+marker+'\\b'));
 const seed=await command(ctx,'seed',/Seed:/),value=seed.reply.match(/Seed:\s*\[?(-?\d+)/)?.[1];if(!value)throw Error('Crossplay native world seed absent');
 await command(ctx,'save-all flush',/Saved the game|Saved the world/);contexts.set(ctx,{edited:true,marker,motd,seed:value});return {fresh,marker,motd,seed:value,scope};
}
export function retentionPaths(ctx){owned(ctx);return ['/server.properties','/world','/world_nether','/world_the_end','/plugins','/config','/bukkit.yml','/spigot.yml','/purpur.yml','/eula.txt'];}
export function restoreContext(ctx,saved){owned(ctx);if(!/^Validator Crossplay [a-f0-9]{12}$/.test(saved?.motd??'')||!Number.isInteger(saved?.marker)||!saved.baseline?.world?.seed||saved.seed!==saved.baseline.world.seed||saved.engineNumericExit!==0||!saved.engineExitProven||!saved.processProof?.engine?.direct)throw Error('Crossplay saved native identity absent');contexts.set(ctx,{edited:true,marker:saved.marker,motd:saved.motd,seed:saved.seed});}
export async function saved(ctx,c){const s=contexts.get(ctx);if(!s?.seed||!s.marker)throw Error('Crossplay native saved marker absent');const proof=await stopProof(ctx,c),baseline=await observe(ctx,false,true);await ctx.artifact('crossplay-saved-properties-'+Date.now()+'.json',baseline.properties);if(baseline.world.seed!==s.seed||baseline.world.marker!==s.marker)throw Error('Crossplay offline NBT/native seed or marker mismatch');return {marker:s.marker,motd:s.motd,seed:s.seed,baseline,processProof:proof,engineNumericExit:0,engineExitProven:true,scope};}
export async function loaded(ctx,c,saved){restoreContext(ctx,saved);const current=await native(ctx),observed=readiness.get(ctx),fresh=current?.state.Running&&observed?.processProof.containerId===current.id&&observed.startedAt===current.state.StartedAt?observed:await ready(ctx,c);if(!fresh||fresh.startedAt===saved.processProof.startedAt||fresh.query.players.max!==7||(typeof fresh.query.description==='string'?fresh.query.description:fresh.query.description?.text)!==saved.motd)throw Error('Crossplay fresh native reload absent');
 await command(ctx,'data get storage voltra:crossplay marker',new RegExp('has the following contents: '+saved.marker+'\\b'));
 const seed=await command(ctx,'seed',/Seed:/);if(seed.reply.match(/Seed:\s*\[?(-?\d+)/)?.[1]!==saved.seed)throw Error('Crossplay reloaded native seed differs');
 await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','Crossplay reload stop',budgets.stopMs);const stop=await stopProof(ctx,c),after=await observe(ctx,false,true);
 const comparison=compareReloadFiles(saved.baseline.files,after.files,saved.baseline.properties,after.properties);
 await ctx.artifact('crossplay-reload-file-evidence-'+Date.now()+'.json',{before:saved.baseline.properties??null,after:after.properties,files:{before:saved.baseline.files,after:after.files},world:{expectedSeed:saved.seed,actualSeed:after.world.seed,expectedMarker:saved.marker,actualMarker:after.world.marker},comparison});
 if(after.world.seed!==saved.seed||after.world.marker!==saved.marker||!comparison.accepted)throw Error('Crossplay retained world identity/config/source changed');return {fresh,stop,seed:saved.seed,marker:saved.marker,scope};}
