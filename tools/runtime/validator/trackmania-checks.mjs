/** Bounded idle LAN checks. Root must register and authorize execution separately. */
import {campaign as h,docker} from './campaign-session.mjs';
import {native,logs,wait} from './campaign-adapter.mjs';
import {recipe,installedSource,pins,binarySHA,sha} from './trackmania-canonical-check.mjs';
export {installedSource};
export {verifyBuild} from './game-checks.mjs';
export const registration={trackmania:{recipe,ports:1,environment:{MASTERSERVER_LOGIN:'',MASTERSERVER_PASSWORD:'',GAME_CONFIG:'MatchSettings\\example.txt',SERVER_NAME:'Validator Trackmania LAN',SERVER_COMMENT:'Validator idle LAN',SERVER_PASSWORD:''}}};
export const budgets={memoryMiB:1536,diskMiB:4096,startupMs:180000,stopMs:90000};
export const retentionRequiredPath='/UserData/Config/dedicated_cfg.txt';
export const scope='Idle authenticated publisher GBXRemote2 LAN, zero players, Startup name consumption, cap32 and bundled Training01 identity, direct-engine clean exit0 and exact config/map retention. No player progress, gameplay, capacity enforcement, public listing or WAN claim.';
const helper='sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8',proofs=new WeakMap(),contexts=new WeakMap();
function owned(ctx){const f=ctx.fixture;if(ctx.game.family!=='trackmania'||ctx.game.recipe!==recipe||f?.recipe!==recipe||f.server?.uuid!==ctx.game.serverUUID||!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(f.server.uuid)||f.server.name!=='validator-'+ctx.game.id||f.ports?.length!==1||!Number.isInteger(f.ports[0])||ctx.game.testStartup)throw Error('Exact owned Trackmania fixture required');return f;}
// Exported for offline compile. No password or full XML ever leaves the probe.
export const observationPython=String.raw`import pathlib,os,stat,hashlib,json,sys,socket,struct,xmlrpc.client,xml.etree.ElementTree as ET
r=pathlib.Path('/source');live=sys.argv[1]=='live'
def safe(p):
 for q in [p,*p.parents]:
  if q==r.parent:break
  assert not q.is_symlink(),'symlink refused'
def meta(p):
 safe(p);a=p.stat();assert stat.S_ISREG(a.st_mode) and a.st_size<=268435456
 with p.open('rb') as f:d=hashlib.file_digest(f,'sha256').hexdigest()
 b=p.stat();assert (a.st_ino,a.st_size,a.st_mtime_ns)==(b.st_ino,b.st_size,b.st_mtime_ns)
 return dict(sha256=d,bytes=b.st_size,mode=stat.S_IMODE(b.st_mode),uid=b.st_uid,gid=b.st_gid)
paths=['UserData/Config/dedicated_cfg.txt','UserData/Maps/MatchSettings/example.txt','UserData/Maps/Campaigns/Training/Training - 01.Map.Gbx','MatchSettings/example.txt','TrackmaniaServer']
manifest={p:meta(r/p) for p in paths}
raw=(r/paths[0]).read_bytes();assert len(raw)<1048576 and b'<!DOCTYPE' not in raw.upper() and b'<!ENTITY' not in raw.upper()
root=ET.fromstring(raw)
def scalar(path):
 hits=root.findall(path);assert len(hits)==1;return hits[0].text or ''
assert root.tag=='dedicated'
assert scalar('masterserver_account/login')=='' and scalar('masterserver_account/password')==''
assert scalar('system_config/xmlrpc_allowremote').lower()=='false'
port=int(scalar('system_config/xmlrpc_port'));assert 1<=port<=65535
config=dict(name=scalar('server_options/name'),cap=int(scalar('server_options/max_players')),gamePort=int(scalar('system_config/server_port')),privateRPC=True)
engines=[];rpc=None
if live:
 for p in pathlib.Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   if os.readlink(p/'exe')!='/home/container/TrackmaniaServer':continue
   args=(p/'cmdline').read_bytes().split(b'\0')[:-1];pp=int(next(x.split()[1] for x in (p/'status').read_text().splitlines() if x.startswith('PPid:')));parent=pathlib.Path('/proc')/str(pp)
   engines.append(dict(pid=int(p.name),ppid=pp,cwd=os.readlink(p/'cwd'),argv=[x.decode() for x in args],parentCwd=os.readlink(parent/'cwd'),parentExe=os.readlink(parent/'exe'),parentArgv=[x.decode() for x in (parent/'cmdline').read_bytes().split(b'\0')[:-1]],binarySHA256=hashlib.sha256((p/'exe').read_bytes()).hexdigest()))
  except (FileNotFoundError,ProcessLookupError):pass
 sock=socket.create_connection(('127.0.0.1',port),timeout=8)
 def read(n):
  data=b''
  while len(data)<n:
   b=sock.recv(n-len(data))
   if not b:raise RuntimeError('RPC disconnected')
   data+=b
  return data
 n=struct.unpack('<I',read(4))[0];assert 0<n<100;handshake=read(n).decode();assert handshake=='GBXRemote 2'
 def call(name,*args):
  data=xmlrpc.client.dumps(args,methodname=name).encode();sock.sendall(struct.pack('<II',len(data),0x80000000)+data)
  for attempt in range(64):
   n,handle=struct.unpack('<II',read(8));assert 0<n<4*1024**2;body=read(n)
   if handle==0x80000000:return xmlrpc.client.loads(body)[0][0]
  raise RuntimeError('RPC response bound exceeded')
 levels=root.findall('authorization_levels/level');assert levels
 level=levels[0];assert level.findtext('name') and level.findtext('password')
 auth=call('Authenticate',level.findtext('name'),level.findtext('password'));assert auth is True
 options=call('GetServerOptions');players=call('GetPlayerList',100,0);assert isinstance(players,list)
 rpc=dict(handshake=handshake,authenticated=auth,version=call('GetVersion'),name=options['Name'],cap=options['CurrentMaxPlayers'],nextCap=options['NextMaxPlayers'],players=len(players),map=call('GetCurrentMapInfo'))
 sock.close()
print(json.dumps(dict(manifest=manifest,config=config,engines=engines,rpc=rpc)))`;
async function observe(ctx,live=false){
 const f=owned(ctx),n=await native(ctx);if(!n)throw Error('Owned Trackmania container missing');const [d]=JSON.parse(await docker(['inspect',n.id],ctx.signal)),source='/var/lib/voltra-parity-20261029/volumes/'+f.server.uuid;
 if(d.Name!=='/'+f.server.uuid||d.Mounts.filter(m=>m.Source===source&&m.Destination==='/home/container'&&m.RW).length!==1||d.Mounts.some(m=>m.Destination.startsWith('/home/container/'))||ctx.game.offlineHelperImage!==helper||Boolean(d.State.Running)!==live)throw Error('Exact Trackmania volume/helper/process boundary differs');
 const args=['run','--rm','--pull','never','--read-only','--user','0:0','--memory','256m','--cap-drop','ALL','--cap-add','DAC_READ_SEARCH','--cap-add','SYS_PTRACE','--network',live?'container:'+n.id:'none'];if(live)args.push('--pid','container:'+n.id);
 args.push('--mount','type=bind,src='+source+',dst=/source,readonly','--entrypoint','python3',helper,'-B','-c',observationPython,live?'live':'offline');
 let result;try{result=JSON.parse(await docker(args,ctx.signal,60000));}catch(error){await ctx.artifact('trackmania-observe-failed-'+Date.now()+'.json',{containerId:n.id,state:d.State,live,scope:'Probe failed; no acceptance',error:String(error.message).slice(0,1200)});throw error;}const [after]=JSON.parse(await docker(['inspect',n.id],ctx.signal));
 await ctx.artifact('trackmania-observe-'+Date.now()+'.json',{containerId:n.id,before:d.State,after:after.State,...result,scope});
 if(after.State.StartedAt!==d.State.StartedAt||after.State.Running!==d.State.Running||after.State.FinishedAt!==d.State.FinishedAt)throw Error('Trackmania changed during observation');return result;
}
async function startup(ctx,name){owned(ctx);const environment={...registration.trackmania.environment,SERVER_NAME:name};await ctx.artifact('trackmania-startup-intent-'+Date.now()+'.json',{environment,scope:'Supported Startup controls only'});await h.api('/api/application/servers/'+ctx.fixture.server.id+'/startup','PATCH',{environment});const s=(await h.api('/api/application/servers/'+ctx.fixture.server.id)).attributes;if(s.uuid!==ctx.fixture.server.uuid||Object.entries(environment).some(([k,v])=>s.container.environment[k]!==v))throw Error('Trackmania Startup readback differs');}
export async function prerequisites(ctx,c){owned(ctx);if(await c.state()!=='offline')throw Error('Parked Trackmania fixture required');const source=await installedSource(ctx,c);await startup(ctx,registration.trackmania.environment.SERVER_NAME);contexts.set(ctx,{edited:false});return {source,scope};}
export async function ready(ctx,c){
 owned(ctx);const n=await native(ctx);if(!n?.state||Date.parse(n.state.StartedAt)<ctx.startRequestedAt)return false;if(!n.state.Running)throw Error('Trackmania exited before readiness');if(await c.state()!=='running')return false;
 const text=await logs(ctx,n.state.StartedAt);if(!text.includes('...Load succeeds'))return false;
 const source=await installedSource(ctx,c),disk=await observe(ctx,true),expected=contexts.get(ctx)?.edited?'Validator changed $ + & LAN':registration.trackmania.environment.SERVER_NAME,e=disk.engines[0],rpc=disk.rpc;
 if(disk.engines.length!==1||e.cwd!=='/home/container'||e.parentCwd!=='/home/container'||!/^\/home\/container\/\.voltra\/python\/bin\/python3(?:\.\d+)?$/.test(e.parentExe)||e.binarySHA256!==binarySHA||JSON.stringify(e.argv)!==JSON.stringify(['/home/container/TrackmaniaServer','/dedicated_cfg=dedicated_cfg.txt','/game_settings=MatchSettings/example.txt','/noDaemon'])||JSON.stringify(e.parentArgv.slice(1))!==JSON.stringify(['.voltra/truck-trackmania-native.py','run','trackmania']))throw Error('Trackmania direct engine unproved');
 if(disk.config.gamePort!==ctx.fixture.ports[0]||disk.config.name!==expected||disk.config.cap!==32||!rpc.authenticated||rpc.name!==expected||rpc.cap!==32||rpc.nextCap!==32||rpc.players!==0||rpc.version?.Build!=='2026-05-15_18_00'||rpc.map?.UId!=='olsKnq_qAghcVAnEkoeUnVHFZei'||rpc.map.FileName!=='Campaigns/Training/Training - 01.Map.Gbx')throw Error('Trackmania fresh native LAN/config/map readback differs');
 e.direct=true;
 const proof={containerId:n.id,startedAt:n.state.StartedAt,engine:e,source,rpc};proofs.set(ctx,proof);return {...proof,scope};
}
async function clean(ctx,c){
 owned(ctx);const p=proofs.get(ctx),n=await native(ctx);if(!p||!n)throw Error('Trackmania live process proof absent');const text=await logs(ctx,p.startedAt),source=await installedSource(ctx,c),state=n.state;
 await ctx.artifact('trackmania-stop-'+Date.now()+'.json',{containerId:n.id,state,logSHA256:sha(text),source,scope:'Pinned native-console returns exact child status; Trackmania launcher preserves nonzero/signal status'});
 if(n.id!==p.containerId||state.StartedAt!==p.startedAt||state.Running||state.ExitCode!==0||state.OOMKilled||state.Dead||await c.state()!=='offline'||/Native process exited:|grace expired|escalating owned process/i.test(text)||JSON.stringify(source)!==JSON.stringify(p.source))throw Error('Trackmania exact direct-engine clean exit0 unproved');return {...p,finishedAt:state.FinishedAt,engineNumericExit:0,engineExitProven:true};
}
export async function settings(ctx,c){await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','Trackmania settings stop',budgets.stopMs);await clean(ctx,c);await startup(ctx,'Validator changed $ + & LAN');contexts.set(ctx,{edited:true});ctx.startRequestedAt=Date.now();await c.power('start');const fresh=await wait(ctx,()=>ready(ctx,c),'Trackmania name native readback',budgets.startupMs);return {fresh,typedGameplayDocument:false,scope};}
export function retentionPaths(ctx){owned(ctx);return [retentionRequiredPath,'/UserData/Maps/MatchSettings/example.txt','/UserData/Maps/Campaigns/Training/Training - 01.Map.Gbx','/MatchSettings/example.txt','/TrackmaniaServer',...Object.keys(pins).map(p=>'/'+p)];}
export function restoreContext(ctx,saved){owned(ctx);if(!saved?.baseline?.manifest||!saved.engine?.direct||!saved.finishedAt||!saved.engineExitProven||saved.engineNumericExit!==0||saved.rpc?.name!=='Validator changed $ + & LAN')throw Error('Trackmania saved proof absent');contexts.set(ctx,{edited:true});proofs.set(ctx,saved);}
export async function saved(ctx,c){if(!contexts.get(ctx)?.edited)throw Error('Trackmania settings consumption absent');const stop=await clean(ctx,c),baseline=await observe(ctx);return {...stop,baseline,worldGameplaySaveClaimed:false,scope};}
export async function loaded(ctx,c,saved){restoreContext(ctx,saved);const fresh=await ready(ctx,c);if(!fresh||fresh.startedAt===saved.startedAt)throw Error('Fresh Trackmania reload absent');await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','Trackmania reload stop',budgets.stopMs);const stop=await clean(ctx,c),after=await observe(ctx);if(JSON.stringify(saved.baseline.manifest)!==JSON.stringify(after.manifest))throw Error('Trackmania exact config/map identity retention differs');return {fresh,stop,configMapRetained:true,worldGameplaySaveClaimed:false,scope};}

export async function retentionStop(ctx,c,saved){
 const reload=[...(ctx.previous?.checks??[])].reverse().find(x=>['reload','reinstall-native-reload'].includes(x.name)&&x.status==='PASS')?.evidence;
 const proof=reload?.stop??saved,current=await native(ctx);
 verifyStoppedGeneration(current,proof);
 if(await c.state()!=='offline'||JSON.stringify(await installedSource(ctx,c))!==JSON.stringify(proof.source))throw Error('Trackmania latest stopped generation/source differs');
 const updated={...saved,...proof};restoreContext(ctx,updated);return await savedBaseline(ctx,c,updated);
}
async function savedBaseline(ctx,c,proof){const stop=await clean(ctx,c),baseline=await observe(ctx);if(JSON.stringify(baseline.manifest)!==JSON.stringify(proof.baseline.manifest))throw Error('Trackmania parked bytes changed since native reload');return {...proof,...stop,baseline};}

export function verifyStoppedGeneration(current,proof){
 if(!proof?.engine?.direct||proof.engineExitProven!==true||proof.engineNumericExit!==0||!current||current.id!==proof.containerId||current.state.StartedAt!==proof.startedAt||!proof.finishedAt||current.state.FinishedAt!==proof.finishedAt||current.state.Running||current.state.ExitCode!==0||current.state.OOMKilled||current.state.Dead)throw Error('Trackmania exact latest direct stopped generation required');
}
