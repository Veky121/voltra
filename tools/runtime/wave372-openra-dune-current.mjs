import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {root,runtime,verifyRuntime,profileFromRuntime,digest,api} from './campaign-native-20261029.mjs';

// Read-only campaign inspection. Writes are restricted to this worker's directory.
const recipe='openra/openra_dune2000/egg-open-r-a--dune2000.json';
const output=path.join(root,'artifacts/game-parity-20261029/wave372-openra-dune-current');
fs.mkdirSync(output,{recursive:true});
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p)));
const receiptPath='artifacts/openra-d2k-native-acceptance.json';
const accepted=read(receiptPath),ready=read('artifacts/game-parity-20261029/wave359-candidate-activation/ready.json');
const current=await verifyRuntime();
if(current.pid!==34620||current.binary_sha256!=='8d8b94d6d29fb7946e5762d2f6646e99aa45f50bb5a66e22c0f1cd26a04c18e4'||ready.status!=='ready')throw Error('Requested candidate changed');
const admitted=read('artifacts/game-parity-20261029/wave368-next-five-admission/report.json').added.find(x=>x.path===recipe);
if(!admitted||admitted.memory_mib!==1024||admitted.disk_mib!==4096)throw Error('Exact resource admission missing');
const profile=profileFromRuntime(recipe,current);
const sourceProfile=read('internal/panel/game_library/overrides.json')[recipe];
const helpers=[...profile.egg.scripts.installation.script.matchAll(/cat > (.*?) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>({path:m[1],body:m[3]+'\n'}));
if(helpers.length!==3)throw Error('Unexpected emitted helper count');
const evidence=[];
for(const helper of helpers){
 const name=path.basename(helper.path),sha256=digest(helper.body),prior=accepted.helpers[name]?.sha256;
 fs.writeFileSync(path.join(output,name),helper.body);
 evidence.push({name,sha256,accepted_sha256:prior,matches_original:sha256===prior,source_sha256:digest(fs.readFileSync(path.join(root,'internal/panel/game_library/scripts',name)))});
}
fs.writeFileSync(path.join(output,'current-profile.json'),JSON.stringify(profile,null,2)+'\n');
const snapshots=[];
for(const entry of fs.readdirSync(runtime,{withFileTypes:true}).filter(x=>x.isDirectory()&&x.name.startsWith('build-input-'))){
 const manifestPath=path.join(runtime,entry.name,'snapshot-manifest.json');
 if(!fs.existsSync(manifestPath))continue;
 const manifest=JSON.parse(fs.readFileSync(manifestPath));
 if(digest(JSON.stringify(manifest.inputs))!==manifest.fingerprint)throw Error('Historical manifest seal drift');
 const p=path.join(runtime,entry.name,'internal/panel/game_library/overrides.json');
 if(!fs.existsSync(p))continue;
 const sealed=manifest.inputs.find(x=>x.path==='internal/panel/game_library/overrides.json');
 if(!sealed||digest(fs.readFileSync(p))!==sealed.sha256)throw Error('Historical catalog drift');
 const old=JSON.parse(fs.readFileSync(p))[recipe];if(!old)continue;
 snapshots.push({snapshot:entry.name,manifest_fingerprint:manifest.fingerprint,catalog_sha256:sealed.sha256,profile_sha256:digest(JSON.stringify(old)),current_profile_match:JSON.stringify(old)===JSON.stringify(profile),helpers:[...old.egg.scripts.installation.script.matchAll(/cat > (.*?) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>({name:path.basename(m[1]),sha256:digest(m[3]+'\n')}))});
}
const backendPath='internal/panel/game_settings_openra.go';
const backend=fs.readFileSync(path.join(current.snapshot,backendPath),'utf8');
const typedDune=backend.includes('openra_dune2000/egg-open-r-a--dune2000.json');
const template=(await api('/api/client/game-library/templates/'+digest(recipe).slice(0,16))).attributes;
fs.writeFileSync(path.join(output,'template.json'),JSON.stringify(template,null,2)+'\n');
// Check actual emitted Python syntax without importing executable installer code,
// creating bytecode, networking, or modifying the game source.
const syntax=spawnSync('python',['-B','-c','import ast,sys; [ast.parse(open(p,encoding="utf-8").read(),filename=p) for p in sys.argv[1:]]',...helpers.map(x=>path.join(output,path.basename(x.path)))],{encoding:'utf8',windowsHide:true});
if(syntax.status!==0)throw Error('Emitted helper syntax failed: '+syntax.stderr);
const report={wave:372,recipe,at:new Date().toISOString(),status:'partial',actual:{candidate:{pid:current.pid,binary_sha256:current.binary_sha256,source:current.source,snapshot:current.snapshot,listener_and_health_and_node_verified:true},admitted,profile_sha256:digest(JSON.stringify(profile)),installer_sha256:digest(profile.egg.scripts.installation.script),current_source_profile_matches:JSON.stringify(sourceProfile)===JSON.stringify(profile),template_id:digest(recipe).slice(0,16),template_sha256:digest(JSON.stringify(template)),helpers:evidence,emitted_python_syntax:'pass: three AST parses; not native proof',settings_backend:{path:backendPath,sha256:digest(backend),typed_dune_selected:typedDune,red_alert_proof_applies_to_dune:false}},reused:[{path:receiptPath,sha256:digest(fs.readFileSync(path.join(root,receiptPath))),scope:accepted.scope,version:accepted.version,mod:accepted.mod,publisher:accepted.release,query:accepted.current_query,stop:accepted.native_stop,reinstall_protected_files:accepted.protected_files,metadata_preserved:accepted.protected_contents_and_metadata_preserved,boundary:'Original exact variant acceptance retained. Changed helper hashes prevent promotion to current-helper native acceptance.'}],historical_sealed_catalogs:snapshots,failed:[],pending:['Current changed helper native install and callback/raw installer exit','Current Dune native settings consumption and console/lifecycle delta','Current canonical-installer reinstall preservation with exported payload/config/metadata'],limitations:['No new native fixture executed. This report does not close current operator checklist.','Typed MiniYaml adapter selects Red Alert only; Dune does not inherit Wave201 acceptance.','World save is N/A for empty lobby; no artificial player or commercial-media requirement.','Native Ctrl-C exit130 is conventional signal termination, not exit0.','No full-parity, player, WAN, match replay or in-progress match recovery claim.'],cleanup:{new_lease:false,new_server:false,new_egg:false,new_nest:false,new_allocation:false,new_container:false,new_helper_container:false,new_volume:false,new_tmp:false,new_machine_id:false,native_mutations:false,lease_release:'N/A: none acquired',historical_cleanup:accepted.cleanup,historical_cleanup_reverified:false},next_required_action:'Run only current changed-helper native install/settings/lifecycle/reinstall delta for d2k release-20250330 at 1024MiB/4096MiB and one reviewed port, using a free serialized installer slot. Export full payload/config/save metadata before cleanup. Preserve original receipt.',production_edits:false,publication:false};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:path.relative(root,path.join(output,'report.json')),status:report.status,helpers:evidence,snapshots:snapshots.length}));
