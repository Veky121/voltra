import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import * as g from './campaign-native-20261029.mjs';
import {observeInstallerExit,verifySoldatInstallerObservation} from './soldat-installer-observer.mjs';
const recipe='soldat/egg-soldat.json';
export function resourceEgg(profile,token){
  if(profile.defaults.memory!==512||profile.defaults.disk!==4096||profile.egg.variables.length!==7)throw Error('Exact Soldat baseline required');
  const egg=structuredClone(profile.egg);
  egg.uuid=crypto.randomUUID();egg.name='OWNED RESOURCE PROOF ONLY - not Soldat acceptance';
  egg.description='No publisher acquisition, no game installation, no native readiness claim.';
  egg.startup='exec sleep 120';
  egg.scripts.installation.script=g.installerGate('printf "OWNED_RESOURCE_PROOF_TERMINAL\\n"\n',token);
  return egg;
}
export function reviewCleanup(prior,hash){
 if(!prior.resources?.lease_released||!prior.resources?.server_removed||!prior.resources?.slot_released||!prior.filesystem_cleanup?.length||!prior.filesystem_cleanup.every(x=>x.absent)||!prior.protected_comparison?.every(x=>x.unchanged))throw Error('Prior cleanup incomplete');
 return {lease_id:prior.resources.lease.lease_id,game:recipe,resources_removed:true,reviewer:'soldat_resource_followup',cleanup_receipt:'artifacts/game-parity-20261029/soldat-resource-proof-20261030/report.json',cleanup_sha256:hash,fix_reason:'Root fixed waitNativeInstaller reserved/unbound supplement bootstrap; verify automatic binding and cgroup resize instead of prior manual continuation'};
}
export async function run(){
 const dir=path.join(g.root,'artifacts/game-parity-20261029/soldat-resource-followup-20261030');fs.mkdirSync(dir,{recursive:true});
 const report={at:new Date().toISOString(),scope:'owned resource fixture only; no Soldat installation or acceptance',phases:[],checks:{},resources:{},hashes:{}};
 const save=()=>fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2)+'\n');
 const phase=(id,value)=>{report.phases.push({at:new Date().toISOString(),id,...value});save();};
 const queue=()=>JSON.parse(fs.readFileSync(path.join(g.runtime,'queue.json')));
 const kernel=id=>g.docker(['exec',id,'sh','-c','cat /sys/fs/cgroup/memory.max; cat /sys/fs/cgroup/memory.swap.max; cat /sys/fs/cgroup/cpu.max']).trim().split(/\r?\n/).map(x=>x.trim());
 let s={},waiter;
 const priorPath='artifacts/game-parity-20261029/soldat-resource-proof-20261030/report.json';
 const prior=JSON.parse(fs.readFileSync(path.join(g.root,priorPath)));
 const retryReview=reviewCleanup(prior,g.digest(fs.readFileSync(path.join(g.root,priorPath))));
 report.retry_review=retryReview;
 if(fs.existsSync(path.join(dir,'report.json')))throw Error('Single followup already attempted; preserve receipt');
 try {
  for(const p of ['tools/runtime/campaign-native-20261029.mjs','tools/runtime/soldat-installer-observer.mjs','artifacts/game-parity-20261029/root-soldat-watcher-phase-report.json'])report.hashes[p]=g.digest(fs.readFileSync(path.join(g.root,p)));
  const r=await g.verifyRuntime();report.foundation={pid:r.pid,binary_sha256:r.binary_sha256,source_fingerprint:r.source_fingerprint,snapshot:r.snapshot};
  const profile=g.profileFromRuntime(recipe,r);
  fs.writeFileSync(path.join(dir,'served-profile.json'),JSON.stringify({[recipe]:profile},null,2)+'\n');
  report.profile_sha256=g.digest(JSON.stringify(profile));report.installer_embed_sha256=g.digest(profile.egg.scripts.installation.script);
  report.protected_before=g.containers();
  const wings=report.protected_before.find(c=>c.Name==='/voltra-parity-20261029-wings');
  if(!wings)throw Error('Served Wings missing');
  const activation=JSON.parse(fs.readFileSync(path.join(g.root,'artifacts/game-parity-20261029/wings-diagnostic-activation.json')));
  const binary=path.join(dir,'wings-readonly-copy.bin');
  g.docker(['cp',wings.Id+':/usr/bin/wings',binary]);
  const live=g.digest(fs.readFileSync(binary));fs.unlinkSync(binary);
  if(live!==activation.new_sha256)throw Error('Served gate source cannot be attested');
  const source=fs.readFileSync(path.join(g.root,'.local/game-parity-20261029/wings-diagnostic-build-1793328109843/input/server/install.go'),'utf8');
  if(!source.includes('Target:   "/mnt/install"')||!source.includes('"/mnt/install/install.sh"'))throw Error('Gate feature missing before mutation');
  report.gate_source_sha256=g.digest(source);
  for(const image of [profile.egg.scripts.installation.container,Object.values(profile.egg.docker_images)[0]])g.docker(['image','inspect',image]);
  phase('RESOURCE-PREFLIGHT',{pass:true,capacity:g.hostCapacity(),policy:g.policy});
  report.resources=s;
  if(!s.server){
  s.lease=g.claimNative({game:recipe,owner:'soldat_resource_followup_20261030',memory_mib:512,disk_mib:4096,ports:2,retry_review:retryReview});phase('RESOURCE-LEASE',{lease:s.lease});
  s.slot=g.acquireInstaller(s.lease.lease_id,s.lease.owner,{supplement_mib:512});phase('RESOURCE-SUPPLEMENT-RESERVED',{slot:s.slot});
  const egg=resourceEgg(profile,s.slot.token);g.assertPortsFree(s.lease.ports);
  const existing=(await g.api('/api/application/nodes/1/allocations')).data.map(x=>x.attributes);if(existing.some(a=>s.lease.ports.includes(a.port)))throw Error('Allocation conflict');
  s.nest=(await g.api('/api/admin/nests','POST',{name:egg.name,author:'resource-proof@localhost',description:egg.description})).attributes;save();
  s.egg=(await g.api('/api/admin/eggs/import','POST',{nest_id:s.nest.id,egg})).attributes;save();
  await g.api('/api/application/nodes/1/allocations','POST',{ip:'127.0.0.1',ports:s.lease.ports.map(String)});
  s.allocations=(await g.api('/api/application/nodes/1/allocations')).data.map(x=>x.attributes).filter(a=>s.lease.ports.includes(a.port));save();
  s.server=(await g.api('/api/application/servers','POST',{name:egg.name,user:1,egg:s.egg.id,node_id:1,docker_image:Object.values(egg.docker_images)[0],startup:egg.startup,allocation:{default:s.allocations[0].id,additional:s.allocations.slice(1).map(a=>a.id)},limits:g.boundedBuild(s.lease),oom_disabled:false,feature_limits:{allocations:1,databases:0,backups:0},environment:Object.fromEntries(egg.variables.map(v=>[v.env_variable,v.default_value])),start_on_completion:false})).attributes;save();
  }
  const automatic=await g.waitNativeInstaller(s,{timeoutMs:15000});
  const actual=automatic.container;s.installer_id=actual.Id;save();
  phase('RESOURCE-AUTOMATIC-WAITER',{proof:automatic.proof,manual_configure:false});
  phase('RESOURCE-INSTALLER-1024',{proof:verifySoldatInstallerObservation({container:actual,lease:s.lease,queue:queue(),slot:s.slot,uuid:s.server.uuid,kernel:kernel(actual.Id)})});
  waiter=spawn('docker',['--context','desktop-linux','wait',actual.Id],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='';waiter.stdout.on('data',b=>out+=b);
  const waited=new Promise((resolve,reject)=>{waiter.on('error',reject);waiter.on('exit',code=>code===0&&/^\d+$/.test(out.trim())?resolve(Number(out.trim())):reject(Error('wait failed')));});
  g.releaseGate(actual,s.lease,s.slot.token);phase('RESOURCE-GATE-RELEASED',{});
  const exit=await observeInstallerExit(waited,15000);phase('RESOURCE-TERMINAL-OBSERVATION',exit);
  if(!exit.observed)throw Error('PENDING: installer exit not observed; retain owned resources');
  const outcome=await g.waitInstallOutcome(s,{timeoutMs:15000});phase('RESOURCE-INSTALL-CALLBACK',{outcome});
  if(exit.exit!==0||!outcome.success)throw Error('Resource fixture terminal failed');
  if(g.containers().some(c=>c.Id===actual.Id))throw Error('Terminal installer not removed; retain supplement');
  g.releaseInstaller(s.slot);s.slot_released=true;phase('RESOURCE-SUPPLEMENT-RELEASED',{});
  await g.api('/api/client/servers/'+s.server.uuid+'/power','POST',{signal:'start'});
  let runtimeContainer;const end=Date.now()+15000;while(Date.now()<end){runtimeContainer=g.containers().find(c=>c.Name==='/'+s.server.uuid&&c.State.Running);if(runtimeContainer)break;await new Promise(resolve=>setTimeout(resolve,250));}
  const proof=g.proveRuntime(runtimeContainer,s.lease),limits=kernel(runtimeContainer.Id);
  if(JSON.stringify(limits)!==JSON.stringify(['536870912','0','100000 100000']))throw Error('Runtime kernel mismatch');
  phase('RESOURCE-RUNTIME-512',{proof,kernel:limits,game_readiness:false});
  await g.api('/api/client/servers/'+s.server.uuid+'/power','POST',{signal:'stop'});
  await g.api('/api/application/servers/'+s.server.id,'DELETE');s.server_removed=true;save();
  await g.api('/api/admin/eggs/'+s.egg.id,'DELETE');await g.api('/api/admin/nests/'+s.nest.id,'DELETE');
  for(const a of s.allocations)await g.api('/api/application/nodes/1/allocations/'+a.id,'DELETE');
  if(g.containers().some(c=>c.Name.includes(s.server.uuid)))throw Error('Owned container remains');
  g.releaseNative(s.lease.lease_id,s.lease.owner,'tested',true);s.lease_released=true;phase('RESOURCE-CLEANUP',{pass:true});report.outcome='resource fixture proved; no game acceptance';
 }catch(e){report.outcome='blocked';report.error=e.message;phase('RESOURCE-REFUSAL',{error:e.message});}
 finally{
  if(waiter&&waiter.exitCode===null)waiter.kill();
  const after=g.containers(),normalize=c=>({...c,Mounts:[...c.Mounts].sort((a,b)=>a.Destination.localeCompare(b.Destination))});
  report.protected_comparison=(report.protected_before||[]).map(c=>({id:c.Id,name:c.Name,unchanged:!!after.find(a=>a.Id===c.Id)&&isDeepStrictEqual(normalize(c),normalize(after.find(a=>a.Id===c.Id)))}));
  report.final_foundation=await g.verifyRuntime();
  report.checks=Object.fromEntries(report.phases.map(p=>[p.id,{status:p.id==='RESOURCE-REFUSAL'?'blocked':'pass',evidence:p}]));
  for(const id of ['RESOURCE-AUTOMATIC-WAITER','RESOURCE-INSTALLER-1024','RESOURCE-GATE-RELEASED','RESOURCE-TERMINAL-OBSERVATION','RESOURCE-INSTALL-CALLBACK','RESOURCE-SUPPLEMENT-RELEASED','RESOURCE-RUNTIME-512','RESOURCE-CLEANUP'])report.checks[id]??={status:'not_run'};
  report.actual_operations={publisher_acquisition:0,image_pulls:0,panel_restarts:0,wings_restarts:0,activation:0,game_acceptance:false};
  report.resources=s;report.finished_at=new Date().toISOString();save();
 }
 console.log(JSON.stringify({outcome:report.outcome,error:report.error,report:path.join(dir,'report.json')}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await run();
