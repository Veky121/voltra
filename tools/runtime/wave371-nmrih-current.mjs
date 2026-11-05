import fs from 'node:fs';
import path from 'node:path';
import * as h from './campaign-native-20261029.mjs';
const recipe='nmrih/egg-nmrih.json';
const out=path.join(h.root,'artifacts/game-parity-20261029/wave371-nmrih-current');
fs.mkdirSync(out,{recursive:true});
const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
const read=p=>JSON.parse(fs.readFileSync(path.join(h.root,p)));
const modules=p=>Object.fromEntries([...p.egg.scripts.installation.script.matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>[m[1],{sha256:h.digest(m[3]+'\n'),bytes:Buffer.byteLength(m[3]+'\n')}]));
const runtime=await h.verifyRuntime();
if(runtime.pid!==34620||runtime.binary_sha256!=='8d8b94d6d29fb7946e5762d2f6646e99aa45f50bb5a66e22c0f1cd26a04c18e4')throw Error('Assigned candidate changed');
const ready=read('artifacts/game-parity-20261029/wave359-candidate-activation/ready.json');
if(ready.status!=='ready'||ready.pid!==runtime.pid||ready.binary_sha256!==runtime.binary_sha256)throw Error('Readiness mismatch');
const admission=read('artifacts/game-parity-20261029/wave368-next-five-admission/report.json').added.find(x=>x.path===recipe);
const p=h.profileFromRuntime(recipe,runtime),current=read('internal/panel/game_library/overrides.json')[recipe];
if(admission?.catalog_sha256!==p.upstream_sha256)throw Error('Exact admission mismatch');
const drift=Object.keys({...current,...p}).filter(k=>JSON.stringify(current[k])!==JSON.stringify(p[k]));
if(drift.some(k=>k!=='setup_steps'))throw Error('Executable profile mismatch');
save('source-profile-drift.json',{keys:drift,executable_recipe_equal:true,active_setup_steps:p.setup_steps,current_setup_steps:current.setup_steps});
const before=p.setup_steps[1];
save('description-proposal.json',{scope:'setup_steps[1] only; staged unapplied',recipe,before,before_sha256:h.digest(before),after:'LAN is the default. Internet hosting requires reachable game ports.',reason:'Active NMRIH instructions incorrectly prescribe the CS:S AppID240 login token. NMRIH is fixed AppID317670. Current working source already contains this narrow correction; no shared edit made.'});
if(p.required_ports!==3||p.defaults.memory!==4096||p.defaults.disk!==16384)throw Error('Canonical resources changed');
save('runtime.json',runtime);save('profile.json',p);
const accepted=read('artifacts/nmrih-live-acceptance.json'),installed=read('.local/source-games/nmrih/after-reinstall.json');
const emitted=modules(p);for(const [name,m] of Object.entries(emitted)){m.accepted_sha256=accepted.helpers[name]?.tested_sha256??null;m.installed_historical_sha256=installed.files[name]?.sha256??null;m.matches_original_acceptance=m.sha256===m.accepted_sha256;}
save('helper-comparison.json',emitted);
const snapshots=[];
for(const name of fs.readdirSync(h.runtime).filter(x=>x.startsWith('build-input-'))){const f=path.join(h.runtime,name,'internal/panel/game_library/overrides.json');if(!fs.existsSync(f))continue;const old=JSON.parse(fs.readFileSync(f))[recipe];if(old)snapshots.push({snapshot:name,profile_sha256:h.digest(JSON.stringify(old)),exact_profile_match:JSON.stringify(old)===JSON.stringify(p),helpers:modules(old),settings_documents:old.settings_documents??null});}
save('snapshot-comparison.json',snapshots);
const settingsFiles=fs.readdirSync(path.join(runtime.snapshot,'internal/panel')).filter(x=>/^game_settings.*\.go$/.test(x));
const settings=settingsFiles.map(name=>{const f=path.join(runtime.snapshot,'internal/panel',name),body=fs.readFileSync(f);return {path:'internal/panel/'+name,sha256:h.digest(body),mentions_nmrih:body.toString().includes('nmrih')};});save('settings-backend.json',settings);
const options=(await h.api('/api/client/game-library/templates/'+h.digest(recipe).slice(0,16))).attributes;save('template-options.json',options);
const observed={at:new Date().toISOString(),queue_slot:read('.local/game-parity-20261029/runtime/queue.json').installer_slot??null,installers:h.campaignInstallers().map(c=>({id:c.Id,name:c.Name})),capacity:h.hostCapacity()};save('capacity.json',observed);
const changed=Object.entries(emitted).filter(([,m])=>!m.matches_original_acceptance).map(([name])=>name);
save('report.json',{at:new Date().toISOString(),recipe,status:'prepared_current_native_delta_required',complete:false,actual:{candidate_verified:true,canonical_profile_verified:true,admission_verified:true,resources:{memory_mib:4096,disk_mib:16384,ports:3,cpu_percent:100,swap:0},snapshot_comparison:'snapshot-comparison.json',settings_backend:'settings-backend.json',current_native:false},reused:{receipt:'artifacts/nmrih-live-acceptance.json',sha256:h.digest(fs.readFileSync(path.join(h.root,'artifacts/nmrih-live-acceptance.json'))),build:24996675,scope:['historical native install','RCON authentication and rejection','post-init VScript','custom map','native quit exit0','password restart','24-file reinstall contents/mode/UID/GID preservation'],current_helper_equivalence:false},failed:[],pending:changed.map(helper=>({helper,check:'Current emitted helper native delta consumption; historical result retained without promotion'})),limitations:['No current native consumption yet','No player/WAN/full-parity claim','Round/session world-save operation is not applicable','Global direct-create Wave130 admission not rerun'],hashes:{profile:h.digest(JSON.stringify(p)),installer:h.digest(p.egg.scripts.installation.script),startup:h.digest(p.egg.startup)},cleanup:{lease_acquired:false,server_created:false,egg_created:false,nest_created:false,allocations_created:false,containers_created:false,paths_created:false,release_required:false},next_required_action:'Run current helper delta against a verified reusable native payload, or canonical bounded installation if no payload exists. Preserve historical install/lifecycle/reinstall acceptance; no redundant full loop.'});
console.log(JSON.stringify({out,changed_helpers:changed,snapshots:snapshots.length}));
if(process.argv.includes('--observe')){
 const observations=[];
 for(let i=0;i<10;i++){
  const q=read('.local/game-parity-20261029/runtime/queue.json');
  observations.push({at:new Date().toISOString(),slot:q.installer_slot??null,actual_installers:h.campaignInstallers().map(c=>({id:c.Id,name:c.Name,state:c.State.Status}))});
  save('installer-observations.json',observations);
  if(i<9)await new Promise(r=>setTimeout(r,5000));
 }
 const report=JSON.parse(fs.readFileSync(path.join(out,'report.json')));
 report.actual.installer_observations='installer-observations.json';
 report.actual.bounded_wait_ms=Date.parse(observations.at(-1).at)-Date.parse(observations[0].at);
 report.actual.installer_free_at_last_observation=!observations.at(-1).slot&&!observations.at(-1).actual_installers.length;
 report.actual.description_proposal='description-proposal.json';
 report.pending.push({check:'Acquire reusable original native payload or perform bounded canonical acquisition; no payload found in checked locations',checked_locations:['.local/source-games/nmrih','.local/steam-game-cache','.local/game-parity-20261029/cache','artifacts/game-parity-20261029/*nmrih*']});
 save('report.json',report);
 console.log(JSON.stringify({observations:observations.length,free:report.actual.installer_free_at_last_observation}));
}
