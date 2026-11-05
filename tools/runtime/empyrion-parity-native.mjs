// Root-reviewed Empyrion pilot preparation; no operation runs by default.
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {root,runtime,api,docker,digest,verifyRuntime,activeLease,claimNative,acquireInstaller,releaseInstaller,profileFromRuntime,createNativeFixture,waitNativeInstaller,proveInstaller,releaseGate,containers,classifyInstallOutcome} from './campaign-native-20261029.mjs';
export const recipe='empyrion/egg-empyrion--galactic-survival.json',owner='empyrion_native';
export const request={game:recipe,owner,memory_mib:6144,disk_mib:49152,ports:5};
const base=path.join(root,'.local/game-parity-20261029/empyrion-native'),proofFile=path.join(root,'artifacts/game-parity-20261029/empyrion-parity-access.json');
function proof(){const p=JSON.parse(fs.readFileSync(proofFile));if(p.scope.app!==530870||p.scope.depot!==530871||p.scope.manifest!=='8329430202076268665'||p.boundaries.anonymous_depot_access!==true||p.successful_retry.wait.container_exit!=='0'||p.capacity.capacity_known!==true||p.capacity.fits_proposed48GiB_reinstall!==true)throw Error('Measured exact anonymous access/capacity proof required');return p;}
function current(id){if(!/^[a-f0-9-]{36}$/.test(id??''))throw Error('Exact lease UUID required');return JSON.parse(fs.readFileSync(path.join(base,id,'state.json')));}
function save(s){const dir=path.join(base,s.lease.lease_id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(s,null,2)+'\n',{mode:0o600});}
async function context(id){const receipt=await verifyRuntime(),lease=activeLease(id,owner),s=current(id);if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause||s.runtime.binary_sha256!==receipt.binary_sha256||s.runtime.source_fingerprint!==receipt.source_fingerprint)throw Error('Pause or snapshot change; root/coordinator receipt adoption required');if(lease.memory_mib!==6144||lease.disk_mib!==49152||lease.ports.length!==5||lease.ports.some((p,i)=>p!==lease.ports[0]+i)||lease.ports.includes(1030))throw Error('Exact6GiB/48GiB/5consecutive/privateTelnet lease required');return {receipt,lease,s};}
export function validateIntegratedProfile(p){if(p.egg.startup!=='exec /usr/bin/python3 .voltra/empyrion-parity.py'||!p.egg.scripts.installation.script.includes('def raw_commands(')||!p.egg.scripts.installation.script.includes('class Parsed(Exception)')||p.defaults.memory!==6144||p.defaults.disk!==49152)throw Error('Root must integrate/freeze the reviewed native-authority/raw-input/6GiB48GiB profile before fixture creation; snapshot guard retained');return p;}
function integrated(receipt){return validateIntegratedProfile(profileFromRuntime(recipe,receipt));}
export function terminalInstallerProof(outcome,attachment,containerRunning){
 if(!outcome||!attachment?.completed_at||attachment.wait?.client_exit!==0||!/^\d+$/.test(attachment.wait?.container_exit??'')||containerRunning)throw Error('Actual completed Docker wait/logs and terminal API outcome required before slot release');
 const exit=Number(attachment.wait.container_exit);if(outcome.success&&exit!==0)throw Error('Docker failure conflicts with successful API outcome');return {api_success:outcome.success,container_exit:exit};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main([command='plan',id]){
 if(command==='plan')return {recipe,request,access:proof().boundaries,coordinator_admission_required:true,older_Craftopia_priority:true,active_integrated_profile_required:true,readiness_selected:false,commands:['claim-coordinator-approved','installer-acquire LEASE','create LEASE','prove-installer LEASE','attach-installer LEASE','release-gate LEASE','install-status LEASE','installer-release LEASE'],native_game_claimed:false};
 if(command==='verify-active-profile'){const r=await verifyRuntime(),p=integrated(r);return {pid:r.pid,binary_sha256:r.binary_sha256,profile_revision:p.revision,ready_for_claim:true,claim_made:false};}
 if(command==='claim-coordinator-approved'){proof();const r=await verifyRuntime();integrated(r);const lease=claimNative(request);save({lease,recipe,runtime:{pid:r.pid,binary_sha256:r.binary_sha256,source_fingerprint:r.source_fingerprint},access_proof_sha256:digest(fs.readFileSync(proofFile))});return lease;}
 const {receipt,lease,s}=await context(id);const attempt=s.active_attempt??'';if(attempt&&!/^retry-[1-9][0-9]?$/.test(attempt))throw Error('Invalid owned attempt path');const dir=path.join(base,id,attempt),attachmentFile=path.join(dir,'installer-attachment.json');if(attempt)fs.mkdirSync(dir,{recursive:true});
 if(command==='installer-acquire'){s.slot=acquireInstaller(id,owner);save(s);return s.slot;}
 if(command==='create'){
  if(s.server||s.egg||!s.slot)throw Error('Fresh owned slot/fixture required');const profile=integrated(receipt);
  const result=await createNativeFixture({lease,slot:s.slot,profile,name:'Campaign Empyrion native',environment:{AUTO_UPDATE:'0',INSTALL_MODE:'steam',SERVER_PUBLIC:'false',SERVER_NAME:'ParityEmpyrion',GAME_NAME:'ParityEmpyrion'},onStep:async part=>{Object.assign(s,part);save(s);}});
  save({...s,...result,runtime:s.runtime});return {server_id:result.server.id,uuid:result.server.uuid,node:1,egg:result.egg.id,installer_gate_released:false};
 }
 if(!s.server||s.server.node!==1)throw Error('Owned node1 fixture required');
 if(command==='prove-installer'){
  const found=await waitNativeInstaller(s,{timeoutMs:30000}),c=found.container;proveInstaller(c,lease);
  if(!c.Mounts.some(m=>m.Destination==='/mnt/server'&&m.Source==='/var/lib/voltra-parity-20261029/volumes/'+s.server.uuid))throw Error('Owned installer mount differs');
  const cg=docker(['exec',c.Id,'sh','-c','cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max']).trim().split(/\s+/);if(cg.join(' ')!=='6442450944 0 100000 100000')throw Error('Actual6GiB installer cgroups differ');
  s.installer={id:c.Id,proof:found.proof,cgroups:{memory_max:cg[0],swap_max:cg[1],cpu_quota:cg[2],cpu_period:cg[3]}};save(s);return {...s.installer,gate_released:false};
 }
 if(command==='attach-installer'){
  if(!s.installer||fs.existsSync(attachmentFile))throw Error('Exact unobserved proven installer required');const c=containers().find(c=>c.Id===s.installer.id);if(!c?.State.Running)throw Error('Installer no longer running');
  const logFile=path.join(dir,'installer.log'),fd=fs.openSync(logFile,'wx',0o600),logs=spawn('docker',['--context','desktop-linux','logs','--follow',c.Id],{windowsHide:true,stdio:['ignore',fd,fd]}),wait=spawn('docker',['--context','desktop-linux','wait',c.Id],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';wait.stdout.on('data',b=>output+=b);const waited=new Promise(resolve=>wait.once('exit',code=>resolve({client_exit:code,container_exit:output.trim()}))),logged=new Promise(resolve=>logs.once('exit',resolve));
  const a={installer:c.Id,logs_pid:logs.pid,wait_pid:wait.pid,private_log:logFile,attached_at:new Date().toISOString(),gate_seen:false};const record=()=>fs.writeFileSync(attachmentFile,JSON.stringify(a,null,2)+'\n',{mode:0o600});record();
  while(logs.exitCode===null&&wait.exitCode===null&&!a.gate_seen){a.gate_seen=fs.readFileSync(logFile,'utf8').includes('CAMPAIGN_RESOURCE_GATE');record();if(!a.gate_seen)await sleep(200);}
  a.wait=await waited;await logged;fs.closeSync(fd);a.completed_at=new Date().toISOString();a.bytes=fs.statSync(logFile).size;a.sha256=digest(fs.readFileSync(logFile));record();return {installer:a.installer,wait:a.wait,bytes:a.bytes,completed:true};
 }
 if(command==='release-gate'){
  const a=JSON.parse(fs.readFileSync(attachmentFile));if(a.installer!==s.installer?.id||!a.gate_seen||a.completed_at||!Number.isInteger(a.logs_pid)||!Number.isInteger(a.wait_pid))throw Error('Actual live wait/log attachment before gate required');
  for(const pid of [a.logs_pid,a.wait_pid])process.kill(pid,0);
  const c=containers().find(x=>x.Id===s.installer.id);releaseGate(c,lease,s.slot.token);s.gate_released_at=new Date().toISOString();save(s);return {gate_released:true,installer:c.Id};
 }
 if(command==='install-status'){
  const row=(await api('/api/application/servers/'+s.server.id)).attributes;if(row.uuid!==s.server.uuid||row.node!==1||row.egg!==s.egg.id)throw Error('Owned API fixture drift');const outcome=classifyInstallOutcome(row);if(outcome){s.install_outcome={at:new Date().toISOString(),...outcome};save(s);}return {status:row.status,installed:row.container?.installed,outcome};
 }
 if(command==='installer-release'){const a=JSON.parse(fs.readFileSync(attachmentFile));const terminal=terminalInstallerProof(s.install_outcome,a,containers().some(c=>c.Id===s.installer?.id&&c.State.Running));releaseInstaller(s.slot);s.installer_slot_released_at=new Date().toISOString();save(s);return {slot_released:true,game_resources_retained:true,...terminal};}
 throw Error('Unknown bounded Empyrion pilot action');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await main(process.argv.slice(2)),null,2));
