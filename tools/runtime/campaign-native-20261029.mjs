import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {transact,claim,claimUtility,claimReviewedRetry,claimReviewedUtilityRetry,release} from './batch-queue.mjs';
import {assertInstallerProof} from './campaign-resource-guard-20261029.mjs';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const runtime=path.join(root,'.local/game-parity-20261029/runtime');
export const policy={schema_version:1,node_id:1,memory_mib:20480,disk_mib:131072,reserved_disk_mib:0,physical_disk_reserve_mib:16384,max_active:8,cpu_percent:800,port_min:29100,port_max:29199,additional_reviewed_ports:[27015],host_free_memory_bytes:16*1024**3,host_free_disk_bytes:100*1024**3,max_installers:1};
export const coldSteamcmdUtilityDefaults={memory_mib:1024,disk_mib:1024,ports:0,cpu_percent:100,swap:0};
export const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
export function dockerFailure(args,status){const verb=/^[a-z-]+$/.test(args[0]||'')?args[0]:'command';const e=new Error(`Docker ${verb} failed (exit ${Number.isInteger(status)?status:'unavailable'}). Capture owned, redacted diagnostics separately.`);e.exitStatus=Number.isInteger(status)?status:null;return e;}
export const docker=(args,raw=false)=>{try{return execFileSync('docker',['--context','desktop-linux',...args],{encoding:raw?undefined:'utf8',windowsHide:true,maxBuffer:32*1024**2,stdio:['pipe','pipe','pipe']});}catch(e){throw dockerFailure(args,e.status);}};
export async function api(p,method='GET',body){
 if(!p.startsWith('/api/')&&p!='/healthz')throw Error('Campaign API path required');
 const r=await fetch('http://127.0.0.1:18099'+p,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const t=await r.text();if(!r.ok)throw Error(`${method} ${p}: ${r.status} ${t.slice(0,160)}`);return t?JSON.parse(t):null;
}
export function hostCapacity(){return JSON.parse(execFileSync('powershell',['-NoProfile','-Command',"@{ram=((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory*1024);disk=(Get-PSDrive C).Free}|ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true}));}
export function inspectListedContainers(ids,inspect){const rows=[];for(const id of ids){if(!/^[a-f0-9]{12,64}$/.test(id))throw Error('Invalid listed Docker ID');const result=inspect(id);if(result===null)continue;rows.push(result);}return rows;}
export function containers(){
 const ids=docker(['ps','-aq']).trim().split(/\s+/).filter(Boolean);
 const format='{"Id":{{json .Id}},"Name":{{json .Name}},"Config":{"Image":{{json .Config.Image}}},"State":{"Status":{{json .State.Status}},"Running":{{json .State.Running}},"Pid":{{json .State.Pid}},"ExitCode":{{json .State.ExitCode}},"OOMKilled":{{json .State.OOMKilled}},"StartedAt":{{json .State.StartedAt}},"FinishedAt":{{json .State.FinishedAt}}},"HostConfig":{"Memory":{{json .HostConfig.Memory}},"MemorySwap":{{json .HostConfig.MemorySwap}},"CpuPeriod":{{json .HostConfig.CpuPeriod}},"CpuQuota":{{json .HostConfig.CpuQuota}},"OomKillDisable":{{json .HostConfig.OomKillDisable}},"NetworkMode":{{json .HostConfig.NetworkMode}},"PortBindings":{{json .HostConfig.PortBindings}}},"Mounts":{{json .Mounts}}}';
 return inspectListedContainers(ids,id=>{const r=spawnSync('docker',['--context','desktop-linux','inspect','--format',format,id],{encoding:'utf8',windowsHide:true,maxBuffer:1024**2,stdio:['ignore','pipe','pipe']});if(r.status!==0){if(new RegExp('No such (object|container): '+id+'(?:\\s|$)').test(r.stderr||''))return null;throw dockerFailure(['inspect'],r.status);}try{return JSON.parse(r.stdout);}catch{throw Error('Docker returned invalid safe container projection');}});
}
export function campaignInstallers(all=containers()){return all.filter(c=>c.State.Running&&c.Name.includes('installer')&&c.HostConfig.NetworkMode==='voltra-parity-20261029');}
export function boundedBuild(lease){if(!Number.isSafeInteger(lease.memory_mib)||lease.memory_mib<128||lease.memory_mib>policy.memory_mib)throw Error('Bounded memory lease required');return {memory:lease.memory_mib,disk:lease.disk_mib,swap:0,cpu:100,io:500};}
export function assertBudget(state,request,capacity){
 const active=state.claims.filter(c=>c.status==='active');
 if(!capacity||!Number.isFinite(capacity.ram)||!Number.isFinite(capacity.disk))throw Error('Finite physical capacity required');
 if(!Number.isSafeInteger(request.memory_mib)||request.memory_mib<128||!Number.isSafeInteger(request.disk_mib)||request.disk_mib<1)throw Error('Positive bounded resources required');
 if(active.length>=policy.max_active||active.reduce((s,c)=>s+c.memory_mib,0)+(state.installer_slot?.supplement_mib||0)+request.memory_mib>policy.memory_mib||active.reduce((s,c)=>s+c.disk_mib,0)+request.disk_mib>policy.disk_mib||active.reduce((s,c)=>s+(c.cpu_percent??100),0)+100>policy.cpu_percent)throw Error('Campaign aggregate budget exhausted');
 // Conservative reservation check also counts stopped leases; never consume the host reserve.
 if(capacity.ram-(active.reduce((s,c)=>s+c.memory_mib,0)+(state.installer_slot?.supplement_mib||0)+request.memory_mib)*1024**2<policy.host_free_memory_bytes||capacity.disk-(active.reduce((s,c)=>s+c.disk_mib,0)+request.disk_mib+policy.physical_disk_reserve_mib)*1024**2<policy.host_free_disk_bytes)throw Error('Host headroom below reserved campaign budget');
}
function verifyRetryReceipt(review){const p=path.resolve(root,review.cleanup_receipt||'');if(!p.startsWith(path.join(root,'artifacts')+path.sep)||digest(fs.readFileSync(p))!==review.cleanup_sha256)throw Error('Cleanup receipt mismatch');}
export function claimNative(request,{statePath=path.join(runtime,'queue.json'),plan=JSON.parse(fs.readFileSync(path.join(runtime,'native-plan.json'))),capacity=hostCapacity()}={}){
 return transact(statePath,s=>{assertBudget(s,request,capacity);
  if(s.activation_pause)throw Error('Campaign activation pause is active');
  if(request.retry_review)verifyRetryReceipt(request.retry_review);
  const row=request.retry_review?claimReviewedRetry(s,plan,request,policy):claim(s,plan,request,policy);
  if(request.fixed_ports){if(request.fixed_ports.length!==request.ports||new Set(request.fixed_ports).size!==request.ports||request.fixed_ports.some(p=>!Number.isInteger(p)||!((p>=policy.port_min&&p<=policy.port_max)||policy.additional_reviewed_ports.includes(p))||s.claims.some(c=>c!==row&&c.status==='active'&&c.ports.includes(p))))throw Error('Invalid/conflicting reviewed fixed ports');row.ports=request.fixed_ports;}
  row.cpu_percent=100;row.policy='campaign-native-20261029-v1';return row;});
}
export function claimNativeUtility(request,{statePath=path.join(runtime,'queue.json'),capacity=hostCapacity()}={}){
 return transact(statePath,s=>{if(s.activation_pause)throw Error('Campaign activation pause is active');assertBudget(s,request,capacity);if(request.retry_review)verifyRetryReceipt(request.retry_review);const row=request.retry_review?claimReviewedUtilityRetry(s,request,policy):claimUtility(s,request,policy);row.cpu_percent=100;row.policy='campaign-native-20261029-v1';return row;});
}
export function activeLease(id,owner,state=JSON.parse(fs.readFileSync(path.join(runtime,'queue.json')))){const r=state.claims.find(c=>c.lease_id===id&&c.owner===owner&&c.status==='active');if(!r)throw Error('Active owned lease required');return r;}
export function acquireInstallerState(state,id,owner,installerCount,{supplement_mib=0,capacity}={}){const lease=activeLease(id,owner,state);if(state.activation_pause)throw Error('Campaign activation pause is active');if(state.installer_slot||installerCount!==0)throw Error('Serialized installer slot occupied');if(supplement_mib!==0){if(supplement_mib!==512||lease.game!=='soldat/egg-soldat.json'||lease.kind==='utility'||lease.memory_mib!==512)throw Error('Only classic Soldat installer supplement is authorized');const active=state.claims.filter(c=>c.status==='active');const memory=active.reduce((n,c)=>n+c.memory_mib,0)+supplement_mib;const disk=active.reduce((n,c)=>n+c.disk_mib,0);if(memory>policy.memory_mib||active.length>policy.max_active||disk>policy.disk_mib||active.reduce((n,c)=>n+(c.cpu_percent??100),0)>policy.cpu_percent)throw Error('Campaign aggregate budget exhausted');if(!capacity||!Number.isFinite(capacity.ram)||!Number.isFinite(capacity.disk)||capacity.ram-memory*1024**2<policy.host_free_memory_bytes||capacity.disk-(disk+policy.physical_disk_reserve_mib)*1024**2<policy.host_free_disk_bytes)throw Error('Host headroom below reserved campaign budget');}const r={lease_id:id,owner,...(supplement_mib?{supplement_mib}:{}),acquired_at:new Date().toISOString(),token:crypto.randomUUID()};state.installer_slot=r;return r;}
export function releaseInstallerState(state,slot,installerCount){if(state.installer_slot?.token!==slot.token||state.installer_slot?.owner!==slot.owner||installerCount!==0||(state.installer_slot?.supplement_mib&&!state.installer_slot?.container_id))throw Error('Installer still active or slot ownership mismatch');state.installer_history??=[];state.installer_history.push({...state.installer_slot,released_at:new Date().toISOString()});delete state.installer_slot;}
export function acquireInstaller(id,owner,options={}){const cap=hostCapacity();if(cap.ram<policy.host_free_memory_bytes||cap.disk<policy.host_free_disk_bytes)throw Error('Host headroom below campaign policy');const count=campaignInstallers().length;return transact(path.join(runtime,'queue.json'),s=>acquireInstallerState(s,id,owner,count,{...options,capacity:cap}));}
export function releaseInstaller(slot){const all=containers();const count=all.filter(c=>c.Name.includes('installer')&&c.HostConfig.NetworkMode==='voltra-parity-20261029').length;return transact(path.join(runtime,'queue.json'),s=>{if(all.some(c=>c.Id===s.installer_slot?.container_id))throw Error('Supplement container must be removed');return releaseInstallerState(s,slot,count);});}
// Bind before resizing: an interrupted Docker update retains the reservation and exact container.
export function bindInstallerSupplement(state,slot,container){
 const current=state.installer_slot,lease=activeLease(slot.lease_id,slot.owner,state);
 if(state.activation_pause||current?.token!==slot.token||current.owner!==slot.owner||current.supplement_mib!==512||current.container_id)throw Error('Owned unbound supplement slot required');
 if(!/^[a-f0-9]{64}$/.test(container.Id)||!container.Name.includes('installer')||!container.State.Running)throw Error('Exact gated installer identity required');
 proveInstaller(container,lease);current.container_id=container.Id;return current;
}
export function configureInstallerSupplement(container,slot){
 docker(['exec',container.Id,'sh','-c',`test ! -e /mnt/server/.campaign-release-${slot.token} && grep -q '${slot.token}' /mnt/install/install.sh`]);
 transact(path.join(runtime,'queue.json'),s=>bindInstallerSupplement(s,slot,container));
 docker(['update','--memory','1024m','--memory-swap','1024m','--cpu-period','100000','--cpu-quota','100000',container.Id]);
 const actual=containers().find(c=>c.Id===container.Id),state=JSON.parse(fs.readFileSync(path.join(runtime,'queue.json')));
 return proveInstaller(actual,activeLease(slot.lease_id,slot.owner,state),state);
}
export function proveRuntime(container,lease){
 const b=boundedBuild(lease);if(!container?.State.Running||container.Name.includes('installer'))throw Error('Live runtime required');
 assertInstallerProof(container.HostConfig,{Memory:b.memory*1024**2,MemorySwap:b.memory*1024**2,CpuPeriod:100000,CpuQuota:100000});return {memory:b.memory,cpu:100,swap:0,phase:'runtime'};
}
export function installerSupplementPending(container,lease,state,expectedSlot){
 const slot=state.installer_slot;
 if(!slot?.supplement_mib||slot.lease_id!==lease.lease_id||slot.container_id)return false;
 const active=activeLease(lease.lease_id,lease.owner,state);
 if(state.activation_pause||slot.supplement_mib!==512||slot.owner!==lease.owner||!expectedSlot?.token||expectedSlot.token!==slot.token||active.game!=='soldat/egg-soldat.json'||active.memory_mib!==512||lease.game!==active.game||lease.memory_mib!==active.memory_mib)throw Error('Owned unbound installer supplement phase required');
 // Before binding/resizing, the gated installer must still have runtime limits.
 proveInstaller(container,active);
 return true;
}
export function releaseNative(id,owner,outcome,resourcesRemoved){return transact(path.join(runtime,'queue.json'),s=>{if(s.installer_slot?.lease_id===id)throw Error('Release installer slot first');return release(s,id,owner,outcome,resourcesRemoved);});}
export function verifySnapshot(snapshot,fingerprint){
 const manifest=JSON.parse(fs.readFileSync(path.join(snapshot,'snapshot-manifest.json')));
 if(!/^[a-f0-9]{64}$/.test(fingerprint)||manifest.fingerprint!==fingerprint||digest(JSON.stringify(manifest.inputs))!==fingerprint)throw Error('Frozen source manifest fingerprint mismatch');
 if(!Array.isArray(manifest.inputs)||!manifest.inputs.length)throw Error('Frozen source manifest missing inputs');
 for(const item of manifest.inputs){if(typeof item.path!=='string'||item.path.includes('\\')||item.path.includes(':')||item.path.startsWith('/')||item.path.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe frozen input path');const file=path.join(snapshot,item.path);if(!fs.lstatSync(file).isFile()||digest(fs.readFileSync(file))!==item.sha256)throw Error('Frozen snapshot input drift: '+item.path);}
 return {fingerprint,inputs_verified:manifest.inputs.length};
}
export async function verifyRuntime(){
 const r=JSON.parse(fs.readFileSync(path.join(root,'artifacts/game-parity-20261029/root-activation.json')));
 if(digest(fs.readFileSync(r.executable))!==r.binary_sha256)throw Error('Active panel executable hash mismatch');
 const p=JSON.parse(execFileSync('powershell',['-NoProfile','-Command',`Get-Process -Id ${Number(r.pid)} | Select-Object Id,Path | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true}));
 if(path.resolve(p.Path).toLowerCase()!==path.resolve(r.executable).toLowerCase())throw Error('Panel process executable mismatch');
 const listeners=execFileSync('powershell',['-NoProfile','-Command',"(Get-NetTCPConnection -LocalPort 18099 -State Listen).OwningProcess | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true});if(![JSON.parse(listeners)].flat().every(x=>x===r.pid))throw Error('Panel listener owner mismatch');
 if(JSON.parse(docker(['context','inspect','desktop-linux']))[0].Endpoints.docker.Host!=='npipe:////./pipe/dockerDesktopLinuxEngine')throw Error('Wrong Docker engine');
 await api('/healthz');await api('/api/admin/nodes/1/system-information');
 const snapshotName=path.basename(r.executable).replace(/^panel-frozen-/,'').replace(/\.exe$/i,'');
 if(!/^build-input-(?:wave\d+-)?\d+$/.test(snapshotName))throw Error('Unrecognized frozen snapshot executable');
 const snapshot=path.join(path.dirname(r.executable),snapshotName);if(!fs.statSync(snapshot).isDirectory())throw Error('Frozen source snapshot missing');
 const source=verifySnapshot(snapshot,r.source_fingerprint);
 return {...r,snapshot,source};
}
export function installerGate(script,token){if(!/^[a-f0-9-]{36}$/.test(token))throw Error('UUID gate token required');return `#!/bin/sh\nset -eu\ncd /mnt/server\necho CAMPAIGN_RESOURCE_GATE\nn=0\nwhile test ! -f .campaign-release-${token}; do n=$((n+1)); test "$n" -lt 600; sleep 1; done\n`+script;}
export function proveInstaller(container,lease,state){const b=boundedBuild(lease);const slot=state?.installer_slot;if(slot?.supplement_mib&&slot.lease_id===lease.lease_id){if(slot.owner!==lease.owner||slot.container_id!==container.Id||slot.supplement_mib!==512||lease.game!=='soldat/egg-soldat.json'||lease.memory_mib!==512)throw Error('Installer supplement phase mismatch');b.memory+=slot.supplement_mib;}if(!container.State.Running||!container.Name.includes('installer')||container.HostConfig.NetworkMode!=='voltra-parity-20261029')throw Error('Owned live campaign installer required');assertInstallerProof(container.HostConfig,{Memory:b.memory*1024**2,MemorySwap:b.memory*1024**2,CpuPeriod:100000,CpuQuota:100000});return {id:container.Id,memory:b.memory,cpu:b.cpu,swap:0};}
export function releaseGate(container,lease,token){activeLease(lease.lease_id,lease.owner);const queue=JSON.parse(fs.readFileSync(path.join(runtime,'queue.json')));if(queue.installer_slot?.lease_id!==lease.lease_id||queue.installer_slot?.token!==token)throw Error('Installer slot token mismatch');proveInstaller(container,lease,queue);docker(['exec',container.Id,'touch',`/mnt/server/.campaign-release-${token}`]);}
export function assertPortsFree(ports,all=containers()){
 if(!ports.length||ports.some(p=>!Number.isInteger(p)||p<1||p>65535))throw Error('Numeric native ports required');
 for(const c of all)for(const arr of Object.values(c.HostConfig.PortBindings||{}))for(const b of arr||[])if(ports.includes(+b.HostPort))throw Error('Docker port already bound: '+b.HostPort);
 const ps=`@(Get-NetTCPConnection -LocalPort ${ports.join(',')} -ErrorAction SilentlyContinue;Get-NetUDPEndpoint -LocalPort ${ports.join(',')} -ErrorAction SilentlyContinue) | Select-Object LocalPort,OwningProcess | ConvertTo-Json -Compress`;
 if(execFileSync('powershell',['-NoProfile','-Command',ps],{encoding:'utf8',windowsHide:true}).trim())throw Error('Host native port already bound');
}
export function profileFromRuntime(recipe,receipt){
 if(typeof recipe!=='string'||recipe.includes('..')||!recipe.endsWith('.json'))throw Error('Exact catalog recipe required');
 verifySnapshot(receipt.snapshot,receipt.source_fingerprint);
 const profile=JSON.parse(fs.readFileSync(path.join(receipt.snapshot,'internal/panel/game_library/overrides.json')))[recipe];
 if(!profile?.egg?.scripts?.installation?.script)throw Error('Recipe absent from active source snapshot');return profile;
}
// onStep must durably retain partial ownership after each successful mutation.
export async function createNativeFixture({lease,slot,profile,environment={},name,onStep}){
 if(typeof onStep!=='function')throw Error('Durable fixture ownership recorder required');
 activeLease(lease.lease_id,lease.owner);
 const current=JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).installer_slot;
 if(current?.token!==slot.token||slot.lease_id!==lease.lease_id||current.owner!==lease.owner)throw Error('Owned installer slot required');
 const receipt=await verifyRuntime(),canonical=profileFromRuntime(lease.game,receipt);
 if(JSON.stringify(canonical)!==JSON.stringify(profile))throw Error('Profile differs from served source snapshot');
 // Image provisioning is a separate reviewed boundary; never silently pull outside the script gate.
 docker(['image','inspect',profile.egg.scripts.installation.container]);
 docker(['image','inspect',Object.values(profile.egg.docker_images)[0]]);
 assertPortsFree(lease.ports);
 const allocations=(await api('/api/application/nodes/1/allocations')).data.map(x=>x.attributes);
 if(allocations.some(a=>lease.ports.includes(a.port)))throw Error('Allocation already exists; explicit owner review required');
 const state={lease,slot,recipe:lease.game,runtime:receipt,installer_body_sha256:digest(profile.egg.scripts.installation.script)};await onStep(state);
 state.nest=(await api('/api/admin/nests','POST',{name:name||`Campaign ${lease.owner}`,author:'campaign@localhost',description:'Owned bounded native fixture'})).attributes;await onStep(state);
 const egg=structuredClone(profile.egg);egg.uuid=crypto.randomUUID();egg.scripts.installation.script=installerGate(egg.scripts.installation.script,slot.token);
 state.egg=(await api('/api/admin/eggs/import','POST',{nest_id:state.nest.id,egg})).attributes;await onStep(state);
 await api('/api/application/nodes/1/allocations','POST',{ip:'127.0.0.1',ports:lease.ports.map(String)});
 state.allocations=(await api('/api/application/nodes/1/allocations')).data.map(x=>x.attributes).filter(a=>lease.ports.includes(a.port));await onStep(state);
 if(state.allocations.length!==lease.ports.length||state.allocations.some(a=>a.server_id!=null))throw Error('Allocation ownership conflict');
 const options=(await api('/api/client/game-library/templates/'+digest(lease.game).slice(0,16))).attributes;
 const env=Object.fromEntries(options.variables.map(v=>[v.env_variable,v.default_value]));Object.assign(env,environment);
 state.server=(await api('/api/application/servers','POST',{name:name||`Campaign ${lease.owner}`,user:1,egg:state.egg.id,node_id:1,docker_image:Object.values(profile.egg.docker_images)[0],startup:profile.egg.startup,allocation:{default:state.allocations.find(a=>a.port===lease.ports[0]).id,additional:lease.ports.slice(1).map(p=>state.allocations.find(a=>a.port===p).id)},limits:boundedBuild(lease),oom_disabled:false,feature_limits:{allocations:lease.ports.length-1,databases:0,backups:0},environment:env,start_on_completion:false})).attributes;await onStep(state);return state;
}
export async function waitNativeInstaller(state,{timeoutMs=60000}={}){
 const started=Date.now();while(Date.now()-started<timeoutMs){const ids=docker(['ps','-aq','--filter','name='+state.server.uuid]).trim().split(/\s+/).filter(Boolean);const c=ids.length?JSON.parse(docker(['inspect',...ids])).find(c=>c.Name.includes('installer')&&c.State.Running):undefined;if(c){if(!c.Name.includes(state.server.uuid))throw Error('Wrong fixture installer');const queue=JSON.parse(fs.readFileSync(path.join(runtime,'queue.json')));if(installerSupplementPending(c,state.lease,queue,state.slot)){const proof=configureInstallerSupplement(c,state.slot),actual=containers().find(row=>row.Id===proof.id);if(!actual)throw Error('Configured installer disappeared; observation incomplete');return {container:actual,proof};}return {container:c,proof:proveInstaller(c,state.lease,queue)};}await new Promise(r=>setTimeout(r,300));}throw Error('Gated installer observation timed out');
}
export function classifyInstallOutcome(a){
 if(['install_failed','reinstall_failed'].includes(a.status))return {status:a.status,installed:a.container?.installed,success:false};
 if(a.status===null&&a.container?.installed===1)return {status:null,installed:1,success:true};
 return null;
}
export async function waitInstallOutcome(state,{timeoutMs=600000}={}){
 const started=Date.now();while(Date.now()-started<timeoutMs){const a=(await api('/api/application/servers/'+state.server.id)).attributes;if(a.uuid!==state.server.uuid)throw Error('Fixture identity drift');const outcome=classifyInstallOutcome(a);if(outcome)return {at:new Date().toISOString(),...outcome};await new Promise(r=>setTimeout(r,500));}throw Error('Installer outcome timed out; retain slot and inspect');
}
export async function observePower(state){const a=(await api('/api/client/servers/'+state.server.uuid+'/resources')).attributes;return {at:new Date().toISOString(),...a};}
// This is explicit loopback-development identity selection, not password/session acceptance.
export async function createReaderFixture(state,onStep){
 if(typeof onStep!=='function')throw Error('Durable permission-fixture recorder required');activeLease(state.lease.lease_id,state.lease.owner);
 const suffix=crypto.randomBytes(8).toString('hex'),username='parity_reader_'+suffix;
 const fixture={server_uuid:state.server.uuid,identity_boundary:'isolated loopback DEV X-Dev-User-ID; not password/session authentication',permissions:['file.read','file.read-content']};
 fixture.user=(await api('/api/application/users','POST',{username,email:username+'@localhost.invalid',first_name:'Parity',last_name:'Reader',root_admin:false})).attributes;await onStep(fixture);
 fixture.subuser=(await api('/api/client/servers/'+state.server.uuid+'/users','POST',{email:fixture.user.email,permissions:fixture.permissions})).attributes;await onStep(fixture);
 const me=await readerRequest(fixture,'/api/client/account');const body=await me.json();if(!me.ok||body.attributes?.id!==fixture.user.id||body.attributes?.root_admin!==false)throw Error('Nonadmin development identity was not selected');return fixture;
}
export async function readerRequest(fixture,p,method='GET',body){if(!Number.isSafeInteger(fixture.user?.id)||fixture.user.id<=1||!p.startsWith('/api/'))throw Error('Owned nonadmin fixture and API path required');return fetch('http://127.0.0.1:18099'+p,{method,headers:{'Content-Type':'application/json','X-Dev-User-ID':String(fixture.user.id)},body:body===undefined?undefined:JSON.stringify(body)});}
export async function removeReaderFixture(fixture,onStep){
 if(!Number.isSafeInteger(fixture.user?.id)||fixture.user.id<=1||fixture.user.root_admin!==false||!/^parity_reader_[a-f0-9]{16}$/.test(fixture.user.username))throw Error('Owned reader account required');
 if(fixture.subuser){await api('/api/client/servers/'+fixture.server_uuid+'/users/'+fixture.user.uuid,'DELETE');fixture.subuser_removed=true;if(onStep)await onStep(fixture);}
 await api('/api/application/users/'+fixture.user.id,'DELETE');fixture.user_removed=true;if(onStep)await onStep(fixture);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [command,input='{}']=process.argv.slice(2),a=JSON.parse(input);let result;
 if(command==='claim'){await verifyRuntime();result=claimNative(a);}
 else if(command==='claim-utility'){await verifyRuntime();result=claimNativeUtility(a);}
 else if(command==='installer-acquire'){await verifyRuntime();result=acquireInstaller(a.lease_id,a.owner,{supplement_mib:a.supplement_mib??0});}
 else if(command==='installer-release')result=releaseInstaller(a);
 else if(command==='release')result=releaseNative(a.lease_id,a.owner,a.outcome,a.resources_removed===true);
 else if(command==='status')result={runtime:await verifyRuntime(),policy,capacity:hostCapacity(),active:JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).claims.filter(c=>c.status==='active'),installers:campaignInstallers().map(c=>({id:c.Id,name:c.Name}))};
 else throw Error('Use claim|claim-utility|installer-acquire|installer-release|release|status JSON');
 console.log(JSON.stringify(result,null,2));
}
