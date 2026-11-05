import { createHash } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Historical research only: artifacts/clusterio-live-acceptance.json. Fresh
// idle service proof cannot establish Factorio instances, players or gameplay.
const recipe='factorio/clusterio/egg-clusterio.json';
export const registration={clusterio:{recipe,ports:1,environment:{SERVER_MODE:'controller',LOG_LEVEL:'info',ADMIN_STRING:'admin',HOST_NAME:'Validator Host',CONTROLLER_URL:'',CONTROLLER_TOKEN:'',PLUGINS:'',CLUSTER_NAME:'Validator Cluster'}}};
export const budgets={memoryMiB:1536,diskMiB:4096,startupMs:180000,stopMs:90000};
export const retentionRequiredPath='/config-controller.json';
const image='sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8';
const pins={'.voltra/clusterio-start.mjs':'9836ea030a9070cc34c5c871075cc70e01f4a55a0e1f1828c7df82b4451e7c3c','.voltra/clusterio-setup.mjs':'138801ede639f619996563452fa5ab370e07149c01c352d9847cd0e33626a476','.voltra/clusterio-controller.mjs':'fe066393858f9ce7c1bc73bc28f44c2a3183e814d355fc1d1eb196d4957b76c5'};
const sha=x=>createHash('sha256').update(x).digest('hex'),plain=x=>x.replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'');
const proofs=new WeakMap();
const scope='Idle Clusterio2.0.2 controller/host service, existing readonly typed controls and native config/state retention. No writable typed setting, Factorio instance, player, gameplay or WAN claim.';
function owned(ctx){
 const f=ctx.fixture,role=ctx.game.clusterioRole??'controller';
 if(ctx.game.family!=='clusterio'||ctx.game.recipe!==recipe||f?.recipe!==recipe||f.server?.uuid!==ctx.game.serverUUID||f.server.name!=='validator-'+ctx.game.id||ctx.game.testStartup||!['controller','host'].includes(role)||f.ports?.length!==1)throw Error('Exact owned Clusterio role fixture required');
 if(role==='host'&&(!ctx.game.clusterioController?.uuid||ctx.game.clusterioController.uuid===f.server.uuid||!Number.isSafeInteger(ctx.game.clusterioHostId)))throw Error('Explicit distinct reviewed controller fixture and host ID required; token setup belongs to root');
 return {f,role};
}
async function source(ctx,c){
 const {f,role}=owned(ctx),p=h.profileFromRuntime(recipe,receipt),s=(await h.api('/api/application/servers/'+f.server.id)).attributes;
 if(p.revision!=='clusterio-2.0.2-v1'||p.egg.startup!=='exec node .voltra/clusterio-start.mjs'||s.container?.startup_command!==p.egg.startup||s.uuid!==f.server.uuid||s.egg!==f.egg.id||Number(s.node)===202||s.container.environment.SERVER_MODE!==role||p.egg.config.stop!=='^C'||await c.read('/.voltra/clusterio-mode')!==role+'\n')throw Error('Clusterio exact role/source authority differs');
 for(const [key,value]of Object.entries(s.container.environment))if(['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_LIBRARY_PATH','BASH_ENV','ENV','EXTRA_ARGS','ADDITIONAL_ARGS'].includes(key)&&value)throw Error('Unreviewed Clusterio runtime injection');
 const emitted=Object.fromEntries([...p.egg.scripts.installation.script.matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>[m[1],sha(m[3]+'\n')]));
 for(const [path,pin]of Object.entries(pins))if(emitted[path]!==pin||sha(await c.read('/'+path))!==pin)throw Error('Clusterio exact helper differs: '+path);
 if(role==='host'){const config=JSON.parse(await c.read('/config-host.json'));if(!ctx.clusterioExpectedTokenSHA256||sha(config['host.controller_token']??'')!==ctx.clusterioExpectedTokenSHA256)throw Error('Installed private host token hash differs before native start');}
 return {role,helpers:pins}; // Never return startup credentials or token bytes.
}
async function snapshot(ctx,process=false){
 const {f,role}=owned(ctx),n=await native(ctx);if(!n)throw Error('Owned Clusterio container absent');
 const [d]=JSON.parse(await docker(['inspect',n.id],ctx.signal)),mount='/var/lib/voltra-parity-20261029/volumes/'+f.server.uuid;
 if(d.Name!=='/'+f.server.uuid||d.Mounts.filter(m=>m.Source===mount&&m.Destination==='/home/container').length!==1||d.Mounts.some(m=>m.Destination.startsWith('/home/container/')))throw Error('Clusterio owned mount differs');
 const program=String.raw`import pathlib,json,hashlib,stat,os
r=pathlib.Path('/home/container');role=${JSON.stringify(role)}
def safe(p):
 for q in [p,*p.parents]:
  if q==r.parent:break
  assert not q.is_symlink(),'symlink state refused'
def observe(p):
 safe(p);a=p.stat();assert stat.S_ISREG(a.st_mode) and a.st_size<=67108864
 with p.open('rb') as stream:h=hashlib.file_digest(stream,'sha256').hexdigest()
 b=p.stat();assert (a.st_ino,a.st_size,a.st_mtime_ns)==(b.st_ino,b.st_size,b.st_mtime_ns)
 return dict(sha256=h,bytes=b.st_size,mode=stat.S_IMODE(b.st_mode),uid=b.st_uid,gid=b.st_gid)
config=r/('config-'+role+'.json');meta=observe(config);data=json.loads(config.read_text())
keys=['controller.name','controller.http_port','controller.bind_address'] if role=='controller' else ['host.id','host.name','host.controller_url','host.public_address','host.factorio_directory','host.factorio_port_range']
public={k:data[k] for k in keys if k in data};manifest={}
for name in ['config-controller.json','config-host.json','package.json','package-lock.json','database','instances','.voltra/admin-token.txt','.voltra/clusterio-mode','.voltra/clusterio-controller-initialized','.voltra/clusterio-plugin-selection']+[str(p.relative_to(r)) for p in (r/'.voltra').glob('validator-clusterio-host-token-*.txt')]:
 p=r/name;safe(p)
 if not p.exists():continue
 paths=[p,*p.rglob('*')] if p.is_dir() else [p];assert len(paths)<=10000
 for q in paths:
  safe(q)
  if q.is_file():manifest[str(q.relative_to(r))]=observe(q)
versions={}
for package in ['controller','host','ctl']:
 p=r/'node_modules/@clusterio'/package/'package.json';safe(p);versions[package]=json.loads(p.read_text())['version'];assert versions[package]=='2.0.2'
entry=r/'node_modules/@clusterio'/role/'dist/node'/(role+'.js')
entryBytes,entryMeta=None,observe(entry)
expectedEntry={'controller':'6490ed03036ac5a5d83567db2a8ece9fa4bf5b0b03288f2803ace7159dd5be41','host':'54bd208b92e1f5958b70f5ae2deb8965dacca8ce09ef44986fb36e578e3feda0'}
assert entryMeta['sha256']==expectedEntry[role],'publisher role entrypoint source differs'
# Pinned publisher controller.js:354 / host.js:165 set process.title, replacing
# Linux argv with clusteriocontroller / clusteriohost plus NUL padding.
engines=[]
if ${process ? 'True' : 'False'}:
 for p in pathlib.Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   args=(p/'cmdline').read_bytes().split(b'\0')[:-1]
   target=b'.voltra/clusterio-controller.mjs' if role=='controller' else b'node_modules/@clusterio/host/dist/node/host.js'
   original=args[1:]==[target,b'--log-level',b'info',b'run']
   titled=[x for x in args if x]==[b'clusteriocontroller' if role=='controller' else b'clusteriohost']
   if not (original or titled):continue
   pp=int(next(x.split()[1] for x in (p/'status').read_text().splitlines() if x.startswith('PPid:')));parent=pathlib.Path('/proc')/str(pp)
   pargs=(parent/'cmdline').read_bytes().split(b'\0')[:-1]
   with (p/'exe').open('rb') as exe:exeSHA=hashlib.file_digest(exe,'sha256').hexdigest()
   engines.append(dict(pid=int(p.name),ppid=pp,nodeExecutableSHA256=exeSHA,publisherEntrySHA256=entryMeta['sha256'],publisherTitle=titled,direct=pargs[1:]==[b'.voltra/clusterio-start.mjs'] and (p/'exe').resolve()==(parent/'exe').resolve(),cwd=os.readlink(p/'cwd')))
  except (FileNotFoundError,ProcessLookupError):pass
else:
 for key,value in manifest.items():assert observe(r/key)==value,'offline state changed'
roleSemantics=None
if role=='controller':
 def unique(pairs):
  out={}
  for k,v in pairs:
   assert k not in out,'duplicate role JSON key';out[k]=v
  return out
 roleFile=r/'database/roles.json';safe(roleFile);roleRaw=roleFile.read_bytes();roleRows=json.loads(roleRaw,object_pairs_hook=unique)
 assert len(roleRows)==2 and [x['id'] for x in roleRows]==[0,1],'unsupported default role identity'
 assert all(set(x)=={'id','name','description','permissions','updated_at_ms','is_deleted'} and isinstance(x['updated_at_ms'],int) and not isinstance(x['updated_at_ms'],bool) for x in roleRows),'unexpected native role schema'
 import re
 masked,count=re.subn(rb'("updated_at_ms"\s*:\s*)[0-9]+',lambda m:m[1]+b'TIMESTAMP',roleRaw);assert count==2
 sourcePins={'node_modules/@clusterio/controller/dist/node/src/Controller.js':'14e015c1009c20fbc69851ceaa48f80b6ff965f381d33ff54f9bc3311bd7fbbe','node_modules/@clusterio/lib/dist/node/src/data/Role.js':'236f98edda6b1202a0f19ababb03f687859b7565a4de513fa3fa3ba19e87b3d6','node_modules/@clusterio/lib/dist/node/src/datastore.js':'cb8e7fb06a1e13cca16c8852e01cb72a0d5e5e9f7b7d396222e188f0dbda273a'}
 for name,expected in sourcePins.items():assert observe(r/name)['sha256']==expected,'publisher role timestamp source changed'
 projection=[{k:v for k,v in row.items() if k!='updated_at_ms'} for row in roleRows]
 roleSemantics=dict(rawSHA256=hashlib.sha256(roleRaw).hexdigest(),maskedByteSHA256=hashlib.sha256(masked).hexdigest(),semanticSHA256=hashlib.sha256(json.dumps(projection,sort_keys=True,separators=(',',':')).encode()).hexdigest(),timestamps=[x['updated_at_ms'] for x in roleRows],roleIds=[x['id'] for x in roleRows],source=sourcePins)
print(json.dumps(dict(roleSemantics=roleSemantics,config=public,configSHA256=meta['sha256'],manifest=manifest,versions=versions,engines=engines)))`;
 if(ctx.game.offlineHelperImage!==image)throw Error('Immutable observer helper required');
 const args=['run','--rm','--pull','never','--network','none','--read-only','--user','0:0','--memory','256m','--cap-drop','ALL','--cap-add','DAC_READ_SEARCH'];
 if(d.State.Running)args.push('--pid','container:'+n.id,'--cap-add','SYS_PTRACE');
 args.push('--mount','type=bind,src='+mount+',dst=/home/container,readonly','--entrypoint','python3',image,'-B','-c',program);
 const raw=await docker(args,ctx.signal,30000);
 const [after]=JSON.parse(await docker(['inspect',n.id],ctx.signal));if(!d.State.Running&&(after.State.Running||after.State.StartedAt!==d.State.StartedAt||after.State.FinishedAt!==d.State.FinishedAt))throw Error('Offline Clusterio process changed');return JSON.parse(raw);
}
export async function prerequisites(ctx,c){if(await c.state()!=='offline')throw Error('Parked Clusterio fixture required');if(ctx.game.offlineHelperImage!==image)throw Error('Immutable Clusterio observer required');return {source:await source(ctx,c),typedWriteProven:false,hostAcceptanceProven:false,scope};}
export async function ready(ctx,c){
 const {role,f}=owned(ctx),n=await native(ctx);if(!n?.state||Date.parse(n.state.StartedAt)<ctx.startRequestedAt)return false;if(!n.state.Running)throw Error('Clusterio exited before readiness');
 const text=plain(await logs(ctx,n.state.StartedAt));if(!text.includes('Started '+role)||await c.state()!=='running')return false;
 const authority=await source(ctx,c),disk=await snapshot(ctx,true);await ctx.artifact('clusterio-native-process-'+Date.now()+'.json',{engines:disk.engines,versions:disk.versions});if(disk.engines.length!==1||!disk.engines[0].direct||disk.engines[0].cwd!=='/home/container')throw Error('Clusterio direct child chain unproved');
 let http;if(role==='controller'){
  if(!text.includes('Listening for HTTP on port '+f.ports[0])||disk.config['controller.http_port']!==f.ports[0])throw Error('Native controller allocated HTTP differs');
  const response=await fetch('http://127.0.0.1:'+f.ports[0]+'/',{signal:AbortSignal.timeout(5000)});let body='',size=0;for await(const chunk of response.body){size+=chunk.length;if(size>2097152)throw Error('Oversized controller HTTP');body+=Buffer.from(chunk).toString('utf8');}if(response.status!==200||!/<html/i.test(body))throw Error('Native controller HTTP absent');http={status:200,bodySHA256:sha(body)};
 }else{
  const peer=ctx.clusterioPeer;if(!peer||peer.uuid!==ctx.game.clusterioController.uuid||!peer.startedAt||!peer.containerId)throw Error('Exact live paired controller proof absent');
  const server=(await h.api('/api/application/servers/'+peer.serverId)).attributes;
  if(server.uuid!==peer.uuid||server.name!==peer.name||server.egg!==peer.eggId||Number(server.user)!==peer.owner||Number(server.node)!==peer.node)throw Error('Paired controller API identity differs');
  const [container]=JSON.parse(await docker(['inspect',peer.containerId],ctx.signal));
  if(container.Name!=='/'+peer.uuid||!container.State.Running||container.State.StartedAt!==peer.startedAt)throw Error('Paired controller process changed');
  const all=await docker(['logs','--since',peer.startedAt,peer.containerId],ctx.signal);if(!all.startsWith(peer.logBoundary))throw Error('Paired controller log boundary changed');
  // Each host restart requires registration after THIS start request, not a
  // prior registration retained in the controller's long-lived log.
  const fresh=plain(await docker(['logs','--since',new Date(ctx.startRequestedAt).toISOString(),peer.containerId],ctx.signal));
  if(disk.config['host.id']!==ctx.game.clusterioHostId||!new RegExp('WsServer \\| registered host '+ctx.game.clusterioHostId+' using version 2\\.0\\.2(?:\\r?\\n|$)').test(fresh))return false;
  http={authenticatedHostRegistration:true,hostId:ctx.game.clusterioHostId,controllerUUID:peer.uuid,controllerStartedAt:peer.startedAt,freshLogSHA256:sha(fresh)};

 }
 const proof={containerId:n.id,startedAt:n.state.StartedAt,engine:disk.engines[0],authority,http};proofs.set(ctx,proof);return {...proof,typedWriteProven:false,scope};
}
async function clean(ctx,c){const proof=proofs.get(ctx),n=await native(ctx),{role}=owned(ctx);if(!proof||!n||n.id!==proof.containerId||n.state.StartedAt!==proof.startedAt||n.state.Running||n.state.ExitCode!==0||n.state.OOMKilled||await c.state()!=='offline')throw Error('Clusterio exact child exit0 unproved');const text=plain(await logs(ctx,n.state.StartedAt));if(!text.includes('Caught interrupt, shutting down')||!text.includes(role==='controller'?'Saving data':'Saving config')||/grace expired|escalating owned process/i.test(text))throw Error('Clusterio native graceful save/stop unproved');return {...proof,engineNumericExit:0,engineExitProven:true};}
export async function settings(ctx,c){const {role}=owned(ctx),disk=await snapshot(ctx),body=(await h.api('/api/client/servers/'+ctx.fixture.server.uuid+'/game-settings?file='+encodeURIComponent('/config-'+role+'.json'))).attributes;for(const [key,value]of Object.entries(disk.config)){const fields=body.fields?.filter(f=>f.key==='/'+key);if(fields?.length!==1||fields[0].readonly!==true||String(fields[0].value)!==String(value))throw Error('Existing readonly Clusterio role field differs');}return {readonlyExposure:true,typedWriteProven:false,scope};}
export function retentionPaths(ctx){owned(ctx);if(!Number.isSafeInteger(ctx.game.clusterioHostId))throw Error('Exact retained pair host ID required');return ['/config-controller.json','/config-host.json','/package.json','/package-lock.json','/database','/instances','/.voltra/admin-token.txt','/.voltra/validator-clusterio-host-token-'+ctx.game.clusterioHostId+'.txt','/.voltra/clusterio-mode','/.voltra/clusterio-controller-initialized','/.voltra/clusterio-plugin-selection',...Object.keys(pins).map(p=>'/'+p)];}
export function restoreContext(ctx,saved){owned(ctx);if(!saved?.baseline?.manifest||saved.engineNumericExit!==0||!saved.engineExitProven)throw Error('Clusterio saved native proof absent');}
export async function saved(ctx,c){const stop=await clean(ctx,c),baseline=await snapshot(ctx);return {...stop,processProof:stop,baseline,scope};}
export function publisherRoleReload(before,after,startedAt,finishedAt){
 const old=before.roleSemantics,next=after.roleSemantics,start=Date.parse(startedAt),finish=Date.parse(finishedAt);
 const paths=[...new Set([...Object.keys(before.manifest),...Object.keys(after.manifest)])],changed=paths.filter(p=>JSON.stringify(before.manifest[p])!==JSON.stringify(after.manifest[p]));
 if(changed.length!==1||changed[0]!=='database/roles.json'||!old||!next||!Number.isFinite(start)||!Number.isFinite(finish)||finish<start)throw Error('Unapproved native Clusterio state delta');
 const prior=before.manifest['database/roles.json'],current=after.manifest['database/roles.json'];
 if(['bytes','mode','uid','gid'].some(k=>prior[k]!==current[k])||old.rawSHA256!==prior.sha256||next.rawSHA256!==current.sha256||old.maskedByteSHA256!==next.maskedByteSHA256||old.semanticSHA256!==next.semanticSHA256||JSON.stringify(old.source)!==JSON.stringify(next.source)||JSON.stringify(old.roleIds)!=='[0,1]'||JSON.stringify(next.roleIds)!=='[0,1]')throw Error('Publisher role bytes/schema/metadata changed beyond timestamp values');
 const [a,b]=next.timestamps;if(![...old.timestamps,a,b].every(Number.isSafeInteger)||a<=Math.max(...old.timestamps)||b<=a||a<start||b>finish)throw Error('Publisher role timestamps outside exact native reload window/order');
 return {rawBeforeSHA256:old.rawSHA256,rawAfterSHA256:next.rawSHA256,semanticSHA256:old.semanticSHA256,maskedByteSHA256:old.maskedByteSHA256,oldTimestamps:old.timestamps,newTimestamps:next.timestamps,source:next.source,scope:'Only publisher default-role0/1 updated_at_ms advanced during native reload; canonical installer bytes remain strict'};
}
export async function loaded(ctx,c,saved){restoreContext(ctx,saved);const fresh=await ready(ctx,c);if(!fresh||fresh.startedAt===saved.startedAt)throw Error('Fresh Clusterio reload absent');await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','Clusterio reload stop',budgets.stopMs);const stop=await clean(ctx,c),after=await snapshot(ctx);if(JSON.stringify(Object.keys(after.manifest).sort())!==JSON.stringify(Object.keys(saved.baseline.manifest).sort())||Object.keys(after.manifest).some(path=>JSON.stringify(after.manifest[path])!==JSON.stringify(saved.baseline.manifest[path]))){
 const currentNative=await native(ctx);let semantic;
 try{semantic=publisherRoleReload(saved.baseline,after,fresh.startedAt,currentNative?.state.FinishedAt);}catch{}
 if(semantic){await ctx.artifact('clusterio-native-role-timestamps-'+Date.now()+'.json',{semantic,beforeManifest:saved.baseline.manifest,afterManifest:after.manifest,nativeStop:currentNative.state,stop});return {fresh,stop,retained:true,publisherRoleTimestamps:semantic,scope};}
 const paths=[...new Set([...Object.keys(saved.baseline.manifest),...Object.keys(after.manifest)])].sort(),differences=paths.filter(path=>JSON.stringify(saved.baseline.manifest[path])!==JSON.stringify(after.manifest[path]));
 const current=await native(ctx);
 await ctx.artifact('clusterio-reload-failed-offline-snapshot-'+Date.now()+'.json',{containerId:current?.id,nativeState:current?.state,stop,configSHA256:after.configSHA256,priorConfigSHA256:saved.baseline.configSHA256,differenceCount:differences.length,differences:differences.slice(0,200).map(path=>({path,before:saved.baseline.manifest[path]??null,after:after.manifest[path]??null})),afterManifest:Object.fromEntries(Object.entries(after.manifest).slice(0,2000)),truncated:differences.length>200||Object.keys(after.manifest).length>2000,scope:'Hash/size/mode/owner metadata only; original mismatch remains failure'});
 throw Error('Clusterio state/config changed across reload');
 }return {fresh,stop,retained:true,scope};}

export { clean as cleanStop, snapshot as observeState };
