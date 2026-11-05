import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import * as h from './campaign-native-20261029.mjs';
const recipe='openra/openra_tiberian_dawn/egg-open-r-a--tiberian-dawn.json';
const dir=path.join(h.root,'artifacts/game-parity-20261029/wave373-openra-td-current');
fs.mkdirSync(dir,{recursive:true});
const write=(n,v)=>fs.writeFileSync(path.join(dir,n),JSON.stringify(v,null,2)+'\n');
const read=p=>JSON.parse(fs.readFileSync(p));
const runtime=await h.verifyRuntime();
if(runtime.pid!==34620||runtime.binary_sha256!=='8d8b94d6d29fb7946e5762d2f6646e99aa45f50bb5a66e22c0f1cd26a04c18e4')throw Error('Unexpected runtime');
const ready=read('artifacts/game-parity-20261029/wave359-candidate-activation/ready.json');
if(ready.status!=='ready'||ready.pid!==runtime.pid||ready.binary_sha256!==runtime.binary_sha256)throw Error('Ready receipt mismatch');
const admission=read('artifacts/game-parity-20261029/wave368-next-five-admission/report.json');
if(!admission.already_admitted.includes(recipe))throw Error('Exact case not admitted');
const profile=h.profileFromRuntime(recipe,runtime),canonical=read('internal/panel/game_library/overrides.json')[recipe];
if(JSON.stringify(profile)!==JSON.stringify(canonical))throw Error('Canonical/served profile mismatch');
if(profile.egg.startup!=='exec python3 .voltra/openra-family.py cnc'||profile.defaults.memory!==1024||profile.defaults.disk!==4096)throw Error('Variant/resources mismatch');
write('profile.json',profile);
const acceptancePath='artifacts/openra-cnc-native-acceptance.json',acceptance=read(acceptancePath);
if(acceptance.game!==recipe||acceptance.mod!=='cnc'||acceptance.version!=='release-20250330')throw Error('Wrong acceptance identity');
const extract=p=>[...p.egg.scripts.installation.script.matchAll(/cat > \.voltra\/(\S+) <<'VOLTRA_SOURCE'\n([\s\S]*?)\nVOLTRA_SOURCE\n/g)].map(m=>({name:m[1],body:m[2]+'\n'}));
const historicalPath='.local/github-sync-20261025/repo/internal/panel/game_library/overrides.json';
const historical=read(historicalPath)[recipe],oldHelpers=extract(historical),helpers=[];
for(const current of extract(profile)){
 const old=oldHelpers.find(x=>x.name===current.name); if(!old)throw Error('Historical helper absent');
 const before=path.join(dir,'historical-'+current.name),after=path.join(dir,'current-'+current.name);
 fs.writeFileSync(before,old.body);fs.writeFileSync(after,current.body);
 const diff=spawnSync('git',['diff','--no-index','--',before,after],{encoding:'utf8',windowsHide:true});
 if(![0,1].includes(diff.status))throw Error('Helper comparison failed');
 fs.writeFileSync(path.join(dir,current.name+'.diff'),diff.stdout);
 helpers.push({name:current.name,current_sha256:h.digest(current.body),historical_sha256:h.digest(old.body),accepted_sha256:acceptance.helpers[current.name]?.sha256,historical_matches_acceptance:h.digest(old.body)===acceptance.helpers[current.name]?.sha256,current_matches_acceptance:h.digest(current.body)===acceptance.helpers[current.name]?.sha256,diff:current.name+'.diff'});
}
const snapshots=[];
for(const name of ['build-input-wave348-1793441318355','build-input-wave358-1793442400405']){
 const base=path.join(h.runtime,name),manifest=read(path.join(base,'snapshot-manifest.json'));
 h.verifySnapshot(base,manifest.fingerprint);
 const p=read(path.join(base,'internal/panel/game_library/overrides.json'))[recipe];
 snapshots.push({name,sealed_fingerprint:manifest.fingerprint,profile_sha256:h.digest(JSON.stringify(p)),installer_sha256:h.digest(p.egg.scripts.installation.script),same_current_installer:p.egg.scripts.installation.script===profile.egg.scripts.installation.script});
}
const settingsPath=path.join(runtime.snapshot,'internal/panel/game_settings_openra.go'),settings=fs.readFileSync(settingsPath,'utf8');
const settingsEvidence={path:settingsPath,sha256:h.digest(settings),ra_only:settings.includes('const openraSettingsRecipe = "openra/openra_red_alert/egg-open-r-a.json"'),required_startup:'exec python3 .voltra/openra-ra-runtime.py',td_typed_adapter:false};
if(!settingsEvidence.ra_only)throw Error('Settings eligibility changed; native review required');
const report={schema_version:1,at:new Date().toISOString(),recipe,mod:'cnc',version:'release-20250330',status:'partial_current_installer_native_checks_pending',full_parity:false,runtime,profile_sha256:h.digest(JSON.stringify(profile)),installer_sha256:h.digest(profile.egg.scripts.installation.script),helpers,snapshots,settings:settingsEvidence,
 actual:['Verified active pointer, PID, executable, listener, health and sealed source inputs','Verified exact admission, canonical profile equality, cnc startup, 1024MiB/4096MiB resources','Exported exact current/historical emitted helpers and byte diffs','Verified two sealed snapshots and Red Alert-only typed settings eligibility'],
 reused:[{path:acceptancePath,sha256:h.digest(fs.readFileSync(acceptancePath)),scope:'Accepted historical cnc native install/start, protocol7 mod/version greeting, custom-map UID, operator arguments, Ctrl-C130 twice and two-file metadata reinstall preservation remain accepted',current_helper_equivalence:false},{path:'artifacts/game-parity-20261029/wave58-openra_variants/report.json',sha256:h.digest(fs.readFileSync('artifacts/game-parity-20261029/wave58-openra_variants/report.json')),scope:'Existing source-only preflight/migration fixtures retained; no redundant test rerun; no native promotion'}],
 failed:[],pending:['Native execution of changed current installer/helper preflight and migration ordering','Capture actual install raw exit and authenticated callback on own canonical-identity fixture','Current-helper native greeting, settings-file preservation and canonical real reinstall delta checks'],
 limitations:[...acceptance.limitations,'Historical native-release helper differs from later historical checkout; only the other two historical helper hashes directly bind to acceptance','Wave201 Red Alert supplies shared-code context only, no cnc variant acceptance','No current native fixture was created or native checks executed; operator checklist remains incomplete'],
 world_save:{status:'not_applicable',reason:'Empty lobby and round-based game; no persistent-world save claim'},console:{stdin_commands:'not_supported_by_publisher',historical_stop:'PublisherCtrlC130, not exit0'},
 cleanup:{new_resources_created:false,lease_acquired:false,installer_slot_acquired:false,export:'profile, emitted helpers, helper diffs and receipt hashes retained; no new payload/config/save existed to export',absence_boundary:'No owned UUID/egg/nest/allocation/container/helper/volume/tmp/machine-id was created; historical node202 cleanup receipt retained without reference-node operations'},
 next_required_action:'Acquire one free guarded installer slot with a fresh exact owned lease review if required. Use verified cached release20250330 cnc payload on an own egg with canonical template identity/config mapping. Run only the pending current installer/reinstall deltas, export full payload/config/metadata, clean exact owned resources, then release. Do not repeat accepted historical whole-loop checks.'};
write('report.json',report);
console.log(JSON.stringify({report:path.relative(h.root,path.join(dir,'report.json')),status:report.status,helpers,snapshots,settings:settingsEvidence},null,2));
