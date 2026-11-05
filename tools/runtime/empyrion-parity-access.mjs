// Nonshipping fixed anonymous authorization probe. Never downloads manifests/chunks.
import fs from 'node:fs';import path from 'node:path';import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runtime,docker,digest,verifyRuntime,policy,hostCapacity,assertBudget,activeLease,acquireInstaller,releaseInstaller,containers} from './campaign-native-20261029.mjs';
import {transact,claimUtility,claimReviewedUtilityRetry,release} from './batch-queue.mjs';
export const request={owner:'empyrion_access',task:'empyrion-anonymous-depot-access',memory_mib:1024,disk_mib:2048,ports:0};
export const framework={version:'8.0.33',metadata:'https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json',url:'https://builds.dotnet.microsoft.com/dotnet/Runtime/8.0.33/dotnet-runtime-8.0.33-linux-x64.tar.gz',sha512:'b314039d337a8c5c4be6a6f99712a2618cbeb5e1ab7cac7a5c1cbf1c97bd355f5d116b9932a8cfc604ac7849f74638896eba0534892c6518311908aba29b4f7b',max_archive_bytes:64*1024**2};
const image='sha256:27b7c9d4f13ca20bb1170148f02095d50a5dfce1f7f2dabf5ca273727e43b7ea',queue=path.join(runtime,'queue.json'),base='.local/game-parity-20261029/empyrion-access',compiled=path.join(base,'compiled');
const names=['EmpyrionDepotAccess.dll','EmpyrionDepotAccess.deps.json','EmpyrionDepotAccess.runtimeconfig.json','SteamKit2.dll','protobuf-net.dll','protobuf-net.Core.dll','ZstdSharp.dll','System.IO.Hashing.dll'];
const bundle=()=>names.map(name=>({name,sha256:digest(fs.readFileSync(path.join(compiled,name)))}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function bootstrap(files){return String.raw`import pathlib,os,time,json,urllib.request,hashlib,tarfile,subprocess,resource,sys
root=pathlib.Path('/tmp');gate=root/'empyrion-access-go';until=time.monotonic()+180
print('EMPYRION_ACCESS_RESOURCE_GATE',flush=True)
while not gate.is_file():
 if time.monotonic()>until:raise TimeoutError('Resource gate timeout')
 time.sleep(.1)
resource.setrlimit(resource.RLIMIT_CORE,(0,0))
framework=json.loads(${JSON.stringify(JSON.stringify(framework))})
expected=json.loads(${JSON.stringify(JSON.stringify(files))})
for row in expected:
 p=root/'probe'/row['name']
 if p.is_symlink()or hashlib.sha256(p.read_bytes()).hexdigest()!=row['sha256']:raise ValueError('Probe bundle mismatch')
with urllib.request.urlopen(framework['metadata'],timeout=20)as response:
 metadata_bytes=response.read(8388609)
 if len(metadata_bytes)>8388608:raise ValueError('Release metadata limit')
metadata=json.loads(metadata_bytes);matching=[r for r in metadata['releases'] if r.get('runtime',{}).get('version')==framework['version']]
assets=[f for r in matching for f in r['runtime']['files'] if f.get('rid')=='linux-x64' and f.get('url')==framework['url'] and f.get('hash','').lower()==framework['sha512']]
if len(assets)!=1:raise ValueError('Official runtime identity changed')
archive=root/'runtime.tar.gz';total=0;check=hashlib.sha512();deadline=time.monotonic()+70
with urllib.request.urlopen(framework['url'],timeout=20)as response,archive.open('wb')as output:
 if int(response.headers.get('Content-Length','0'))>framework['max_archive_bytes']:raise ValueError('Runtime archive too large')
 while True:
  block=response.read(65536)
  if not block:break
  total+=len(block)
  if total>framework['max_archive_bytes']or time.monotonic()>deadline:raise ValueError('Runtime archive bound')
  output.write(block);check.update(block)
if check.hexdigest()!=framework['sha512']:raise ValueError('Official runtime SHA512 mismatch')
runtime=root/'dotnet';runtime.mkdir();tarfile.open(archive).extractall(runtime,filter='data')
print(json.dumps({'stage':'runtime_verified','version':framework['version'],'archive_bytes':total,'sha512_verified':True,'bundle_verified':True}),flush=True)
environment=dict(os.environ);environment.update(HOME='/tmp',DOTNET_ROOT=str(runtime),DOTNET_SYSTEM_GLOBALIZATION_INVARIANT='1',DOTNET_EnableDiagnostics='0',DOTNET_CLI_TELEMETRY_OPTOUT='1',DOTNET_NOLOGO='1')
argv=[str(runtime/'dotnet'),str(root/'probe/EmpyrionDepotAccess.dll')]
scope=subprocess.run(argv+['--offline-scope'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=environment,timeout=15)
if scope.returncode or json.loads(scope.stdout).get('app')!=530870:raise ValueError('Offline executable scope failed')
print(json.dumps({'stage':'offline_scope_verified','app':530870,'depot':530871,'manifest':'8329430202076268665'}),flush=True)
result=subprocess.run(argv+['--approved-anonymous-depot-access'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=environment,timeout=100)
# Never forward raw SDK output/stderr. Admit only known non-secret scalar fields.
allowed={'stage','app','depot','manifest','branch','result','credentials_used','expected_depot','valid_key_issued','key_logged','key_persisted','request_code_issued','request_code_logged','request_code_persisted','anonymous_depot_access','account_ownership_claimed','content_downloaded','manifest_downloaded','chunks_requested','native_game_acceptance','access','paid_license_gate_inferred','exception_kind'}
events=[];suppressed=0
for line in result.stdout.splitlines():
 try:
  row=json.loads(line)
  if not isinstance(row,dict)or set(row)-allowed:raise ValueError('Unknown SDK event fields')
  if any(not isinstance(v,(str,int,bool))for v in row.values()):raise ValueError('SDK event type')
  events.append(row);print(json.dumps(row),flush=True)
 except Exception:suppressed+=1
print(json.dumps({'stage':'probe_terminal','raw_exit':result.returncode,'stderr_bytes_suppressed':len(result.stderr),'unknown_stdout_lines_suppressed':suppressed,'anonymous_depot_access':result.returncode==0 and any(e.get('anonymous_depot_access')is True for e in events),'game_payload_acquired':False}),flush=True)
sys.exit(result.returncode)
`;}
async function main(command){
 if(command==='plan')return {request,framework,image,bundle:bundle(),app:530870,depot:530871,manifest:'8329430202076268665',game_payload:false,claim:false};
 if(command==='claim-coordinator-approved'||command==='claim-reviewed-retry-coordinator-approved'){
  await verifyRuntime();let review;
  if(command==='claim-reviewed-retry-coordinator-approved'){
   const previous='f7492396-2bdb-448d-93fd-e9f347881b76',previousFile=path.join(base,previous,'state.json'),old=JSON.parse(fs.readFileSync(previousFile));
   if(!old.cleaned||old.gate_released_at||containers().some(c=>c.Id===old.container||c.Name==='/'+old.container_intent))throw Error('Exact failed pre-gate cleanup not proven');
   const receipt='artifacts/game-parity-20261029/empyrion-access-f749-cleanup.json';
   const proof={at:old.completed_at,lease_id:previous,owner:request.owner,game:'utility/'+request.task,resources_removed:true,container_removed:true,container_id:old.container,gate_released:false,steam_authorization_attempted:false,runtime_archive_acquired:false,terminal:old.terminal,private_state_sha256:digest(fs.readFileSync(previousFile)),failure:old.failure};
   if(!fs.existsSync(receipt))fs.writeFileSync(receipt,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
   review={lease_id:previous,game:'utility/'+request.task,resources_removed:true,reviewer:'coordinator',cleanup_receipt:receipt,cleanup_sha256:digest(fs.readFileSync(receipt))};
  }
  const capacity=hostCapacity(),lease=transact(queue,s=>{if(s.activation_pause)throw Error('Activation pause');assertBudget(s,request,capacity);const row=review?claimReviewedUtilityRetry(s,{...request,retry_review:review},policy):claimUtility(s,request,policy);row.cpu_percent=100;return row;});
  const folder=path.join(base,lease.lease_id);fs.mkdirSync(folder,{recursive:true});const state={lease,at:new Date().toISOString(),framework,image,bundle:bundle(),phase:'waiting-coordinator',container_intent:'voltra-empyrion-access-'+lease.lease_id,cleanup_intent:'Remove only labeled owned utility; release slot after actual terminal and lease after absence proof; no host volumes/ports or game resources'};
  fs.writeFileSync(path.join(folder,'state.json'),JSON.stringify(state,null,2)+'\n',{mode:0o600});fs.writeFileSync(path.join(base,'active.json'),JSON.stringify({lease_id:lease.lease_id},null,2)+'\n',{mode:0o600});return {lease_id:lease.lease_id,memory_mib:1024,disk_mib:2048,ports:[],query_started:false,framework};
 }
 if(command!=='run-coordinator-go')throw Error('Use plan/claim-coordinator-approved/run-coordinator-go');
 await verifyRuntime();const lease=activeLease(JSON.parse(fs.readFileSync(path.join(base,'active.json'))).lease_id,request.owner),folder=path.join(base,lease.lease_id),state=JSON.parse(fs.readFileSync(path.join(folder,'state.json')));
 if(JSON.parse(fs.readFileSync(queue)).activation_pause||state.phase!=='waiting-coordinator'||state.started_at||JSON.stringify(bundle())!==JSON.stringify(state.bundle))throw Error('Pause/replay/bundle drift');
 const save=()=>fs.writeFileSync(path.join(folder,'state.json'),JSON.stringify(state,null,2)+'\n',{mode:0o600});state.started_at=new Date().toISOString();save();let slot,failure,container,fd,logClient,waitClient;
 try{
  slot=acquireInstaller(lease.lease_id,request.owner);state.slot=slot;save();docker(['image','inspect',image]);
  container=docker(['create','--name',state.container_intent,'--label','voltra.access-owner='+lease.lease_id,'--pull','never','--init','--read-only','--network','voltra-parity-20261029','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','1024m','--memory-swap','1024m','--cpu-period','100000','--cpu-quota','100000','--pids-limit','128','--tmpfs','/tmp:rw,exec,nosuid,nodev,size=1024m','--user','1000:1000','--workdir','/tmp',image,'python3','-u','-B','-c',bootstrap(state.bundle)]).trim();state.container=container;save();docker(['start',container]);
  const c=containers().find(x=>x.Id===container),readonly=JSON.parse(docker(['inspect','--format','{{json .HostConfig.ReadonlyRootfs}}',container]));
  if(!c?.State.Running||!readonly||c.Mounts.some(m=>m.Type==='bind')||c.HostConfig.Memory!==1073741824||c.HostConfig.MemorySwap!==1073741824||c.HostConfig.CpuPeriod!==100000||c.HostConfig.CpuQuota!==100000||Object.keys(c.HostConfig.PortBindings??{}).length)throw Error('Owned utility hard limits/rootfs/mounts/ports differ');
  const cg=docker(['exec',container,'sh','-c','cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max']).trim().split(/\s+/);if(cg.join(' ')!=='1073741824 0 100000 100000')throw Error('Actual access cgroups differ');state.cgroups={memory_max:cg[0],swap_max:cg[1],cpu_quota:cg[2],cpu_period:cg[3],readonly:true,host_binds:0};save();
  docker(['exec',container,'mkdir','-p','/tmp/probe']);state.payload_transfers=[];
  for(const row of state.bundle){
   const bytes=fs.readFileSync(path.join(compiled,row.name));if(digest(bytes)!==row.sha256||bytes.length>16*1024**2)throw Error('Bounded source bundle differs');
   const code=`import pathlib,sys,hashlib,json\nb=sys.stdin.buffer.read(${bytes.length+1})\nif len(b)!=${bytes.length}or hashlib.sha256(b).hexdigest()!='${row.sha256}':raise ValueError('Reviewed stdin bundle mismatch')\np=pathlib.Path('/tmp/probe/${row.name}')\nif p.is_symlink():raise ValueError('Unexpected utility payload link')\np.write_bytes(b);p.chmod(0o400)\nprint(json.dumps({'name':'${row.name}','bytes':len(b),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}))`;
   let result;try{result=execFileSync('docker',['--context','desktop-linux','exec','-i',container,'python3','-B','-c',code],{input:bytes,windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:65536,stdio:['pipe','pipe','pipe']});}catch{throw Error('Bounded stdin payload transfer failed; no network gate released');}
   const transfer=JSON.parse(result);if(transfer.sha256!==row.sha256)throw Error('Inside utility payload hash mismatch');state.payload_transfers.push(transfer);save();
  }
  fd=fs.openSync(path.join(folder,'events.log'),'wx',0o600);logClient=spawn('docker',['--context','desktop-linux','logs','--follow',container],{windowsHide:true,stdio:['ignore',fd,fd]});const logged=new Promise(resolve=>logClient.once('exit',resolve));
  waitClient=spawn('docker',['--context','desktop-linux','wait',container],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';waitClient.stdout.on('data',b=>output+=b);const waited=new Promise(resolve=>waitClient.once('exit',code=>resolve({client_exit:code,container_exit:output.trim()})));
  await sleep(400);if(logClient.exitCode!==null||waitClient.exitCode!==null||!fs.readFileSync(path.join(folder,'events.log'),'utf8').includes('EMPYRION_ACCESS_RESOURCE_GATE'))throw Error('Live access observers/gate missing');
  state.observers={logs:logClient.pid,wait:waitClient.pid};save();docker(['exec',container,'touch','/tmp/empyrion-access-go']);state.gate_released_at=new Date().toISOString();save();
  let timer;try{state.wait=await Promise.race([waited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Access utility bounded wait exceeded')),215000);})]);}finally{clearTimeout(timer);}await logged;fs.closeSync(fd);fd=undefined;
  const raw=fs.readFileSync(path.join(folder,'events.log'),'utf8'),events=[];for(const line of raw.split(/\r?\n/)){try{events.push(JSON.parse(line));}catch{}}
  state.events=events;state.events_sha256=digest(raw);state.access_verified=state.wait.client_exit===0&&state.wait.container_exit==='0'&&events.some(x=>x.stage==='probe_terminal'&&x.anonymous_depot_access===true);save();
 }catch(error){failure=error;state.failure=error.message;save();}
 finally{
  const c=containers().find(x=>x.Id===container||x.Name==='/'+state.container_intent);if(c){const labels=JSON.parse(docker(['inspect','--format','{{json .Config.Labels}}',c.Id]));if(labels?.['voltra.access-owner']!==lease.lease_id)throw Error('Access cleanup owner differs');if(c.State.Running)docker(['stop','--time','5',c.Id]);state.terminal=JSON.parse(docker(['inspect','--format','{{json .State}}',c.Id]));docker(['rm',c.Id]);}
  if(containers().some(x=>x.Id===container||x.Name==='/'+state.container_intent))throw Error('Access utility absence unproven');
  if(logClient&&logClient.exitCode===null)logClient.kill();if(waitClient&&waitClient.exitCode===null)waitClient.kill();if(fd!==undefined)fs.closeSync(fd);
  if(slot)releaseInstaller(slot);transact(queue,s=>release(s,lease.lease_id,request.owner,state.access_verified?'tested':'blocked',true));state.cleaned=true;state.completed_at=new Date().toISOString();save();
 }
 if(failure)throw failure;return {lease_id:lease.lease_id,wait:state.wait,access_verified:state.access_verified,events:state.events,cleaned:true,game_payload:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await main(process.argv[2]??'plan'),null,2));
