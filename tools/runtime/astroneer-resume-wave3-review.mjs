// Read-only served review, atomic budget check, and exact recipe fragment staging.
// Never activates a panel, creates a fixture, acquires layers, or claims a lease.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {transact} from './batch-queue.mjs';
import {refreshHelpers} from './refresh-profile-helpers.mjs';
import {root,runtime,verifyRuntime,profileFromRuntime,digest,hostCapacity,assertBudget,docker,api} from './campaign-native-20261029.mjs';

const recipe='astroneer/egg-astroneer-dedicated-server.json';
const relative='artifacts/game-parity-20261029/resume-wave3-astroneer-20261030';
const dir=path.join(root,relative);
fs.mkdirSync(dir,{recursive:true});
if(fs.existsSync(path.join(dir,'final-report.json')))throw Error('Immutable completed receipt exists');
const served=await verifyRuntime();
if(served.pid!==45220||!served.source_fingerprint.startsWith('647bfff3'))throw Error('Assigned served runtime changed; review required');
const profile=profileFromRuntime(recipe,served);
const options=(await api('/api/client/game-library/templates/'+digest(recipe).slice(0,16))).attributes;
if(options.defaults.memory!==6144||options.defaults.disk!==20480)throw Error('Original served defaults changed');
const capacity=hostCapacity(),request={memory_mib:6144,disk_mib:20480};
let admission;
// Throw a private sentinel to release the standard queue lock without writing it.
const readOnly=Symbol('read-only transaction');
try{transact(path.join(runtime,'queue.json'),state=>{
 const active=state.claims.filter(c=>c.status==='active');
 admission={at:new Date().toISOString(),held_memory_mib:active.reduce((n,c)=>n+c.memory_mib,0),held_disk_mib:active.reduce((n,c)=>n+c.disk_mib,0),capacity,request,installer_slot_occupied:!!state.installer_slot,activation_pause:state.activation_pause??null,owned_active_leases:active.filter(c=>c.game===recipe),queue_sha256:digest(fs.readFileSync(path.join(runtime,'queue.json')))};
 try{assertBudget(state,request,capacity);admission.budget='pass';}catch(e){admission.budget='blocked';admission.error=e.message;}
 throw readOnly;
});}catch(e){if(e!==readOnly)throw e;}
const installer=profile.egg.scripts.installation.script;
const helpers=[...installer.matchAll(/cat\s+>\s*([^\s]+\.py)\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\2(?:\r?\n|$)/g)].filter(m=>/astroneer|native.console/.test(m[1])).map(m=>({path:m[1],sha256:digest(m[3]+'\n')}));
const images=[...new Set([...Object.values(profile.egg.docker_images),profile.egg.scripts.installation.container])].map(image=>{try{return {image,cached_id:JSON.parse(docker(['image','inspect',image]))[0].Id};}catch{return {image,missing:true};}});
const current=JSON.parse(fs.readFileSync(path.join(root,'internal/panel/game_library/overrides.json')))[recipe];
const sources=new Map(['astroneer-parity','astroneer-rcon','native-console'].map(n=>[n.replaceAll('-','_'),fs.readFileSync(path.join(root,`internal/panel/game_library/scripts/${n}.py`),'utf8')]));
const staged=refreshHelpers({[recipe]:current},sources);
fs.writeFileSync(path.join(dir,'profile.pending.json'),JSON.stringify(staged.profiles,null,2)+'\n');
const tests=['test-astroneer-parity.py','astroneer-parity-native-control-test.py'].map(file=>{
 const r=spawnSync('python',['-B',path.join(root,'tools/runtime',file)],{encoding:'utf8',windowsHide:true});
 const log=(r.stdout??'')+(r.stderr??'');fs.writeFileSync(path.join(dir,file+'.log'),log);
 return {file,exit_code:r.status,error:r.error?.message,log:relative+'/'+file+'.log'};
});
const prior=JSON.parse(fs.readFileSync(path.join(root,'artifacts/game-parity-20261029/resume-wave2-astroneer-20261030/final-report.json')));
const blocker=admission.budget==='blocked'?admission.error:'Fresh fixture requires an operator-confirmed global unicast PUBLIC_IP; no current value was supplied. Do not infer an address or reuse a historical diagnostic address.';
const identity={pid:served.pid,source_fingerprint:served.source_fingerprint,binary_sha256:served.binary_sha256,profile_sha256:digest(JSON.stringify(profile)),installer_sha256:digest(installer),helpers,defaults:options.defaults,setup_validation:options.setup_validation,images};
fs.writeFileSync(path.join(dir,'admission.json'),JSON.stringify({admission,identity},null,2)+'\n');
const checks=prior.checks.map(c=>c.status==='blocked'?{...c,evidence:relative+'/admission.json',detail:blocker}:c);
for(const c of checks){if(c.id==='DELIVERY-3')Object.assign(c,{status:tests.every(t=>t.exit_code===0)?'pass':'blocked',evidence:tests.map(t=>t.log).join(', '),detail:'Current Windows offline tests only; no native acceptance inferred.'});}
const changed=['tools/runtime/astroneer-resume-wave3-review.mjs',relative+'/profile.pending.json',relative+'/admission.json',...tests.map(t=>t.log)];
const report={at:new Date().toISOString(),recipe,outcome:'blocked',native_completion:false,blocker,proposed_fix:'Supply the operator-confirmed advertised PUBLIC_IP through the approved private configuration workflow. Then freshly review prior cleanup, obtain a reviewed retry lease at original 6144/20480 defaults and a serialized acquisition slot. Inspect cached images only, never implicitly pull. Continue solely against the authorized served build.',admission,identity,checks,tests,reused_proofs:prior.prior_evidence,history_reconciliation:'artifacts/game-parity-20261029/HISTORY-RECONCILIATION-20261030.json',changes:'Exact Astroneer fragment staged with current helpers for deferred integrator; canonical metadata untouched.',files:changed.map(p=>({path:p,sha256:digest(fs.readFileSync(path.join(root,p)))})),resources:{new_leases:0,new_fixtures:0,downloads:0,image_pulls:0,registry_inspections:0,installer_slots_acquired:0,running_owned_operations:[],cleanup:'No resources acquired. Historical receipts and unrelated operator data untouched.'},boundaries:['No activation or alternate launch path; rejected 583-input build remains unserved.','No browser/native/settings/RBAC/files/schedules/reinstall acceptance added.','Player/WAN/version/platform acceptance separate.']};
fs.writeFileSync(path.join(dir,'final-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:relative+'/final-report.json',admission,tests,blocker}));
