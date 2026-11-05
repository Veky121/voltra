import fs from 'node:fs';
import path from 'node:path';
import * as h from './campaign-native-20261029.mjs';
const recipe='gmod/egg-garry-s-mod.json';
const out=path.join(h.root,'artifacts/game-parity-20261029/wave369-gmod-current');
fs.mkdirSync(out,{recursive:true});
const read=p=>JSON.parse(fs.readFileSync(path.join(h.root,p)));
const save=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n');
const receipt=p=>({path:p,sha256:h.digest(fs.readFileSync(path.join(h.root,p)))});
const report={recipe,at:new Date().toISOString(),complete:false,actual:[],reused:[],failed:[],pending:[],limitations:[],cleanup:{created_resources:false,lease_acquired:false}};
try {
 const ready=read('artifacts/game-parity-20261029/wave359-candidate-activation/ready.json');
 const runtime=await h.verifyRuntime();
 if(ready.status!=='ready'||runtime.pid!==34620||runtime.binary_sha256!=='8d8b94d6d29fb7946e5762d2f6646e99aa45f50bb5a66e22c0f1cd26a04c18e4')throw Error('Assigned ready candidate changed');
 save('runtime.json',runtime);report.actual.push('Current pointer, executable SHA, PID, port owner, health, authenticated isolated node and all 853 sealed inputs verified');
 const admission=read('artifacts/game-parity-20261029/wave368-next-five-admission/report.json').added.find(x=>x.path===recipe);
 if(!admission||admission.memory_mib!==4096||admission.disk_mib!==16384)throw Error('Exact canonical admission absent');
 const profile=h.profileFromRuntime(recipe,runtime);save('profile.json',profile);
 const current=read('internal/panel/game_library/overrides.json')[recipe];
 const historical=read('.local/source-next/profiles.json')[recipe];
 const accepted=read('artifacts/gmod-live-acceptance.json');
 const script=profile.egg.scripts.installation.script;
 const helpers=[];
 for(const [name,proof] of Object.entries(accepted.helpers)) {
  const re=new RegExp("cat > \\.voltra/"+name.replaceAll('.','\\.')+" <<'([^']+)'\\n([\\s\\S]*?)\\n\\1(?:\\n|$)");
  const m=script.match(re), hash=m?h.digest(m[2]+'\n'):null;
  helpers.push({name,accepted_sha256:proof.tested_sha256,emitted_sha256:hash,exact_match:hash===proof.tested_sha256});
 }
 const backend=['internal/panel/game_settings_gmod.go','internal/panel/game_settings_source.go','internal/panel/game_settings_campaign_authority.go','internal/panel/game_settings_documents.go'].map(p=>({path:p,current_sha256:h.digest(fs.readFileSync(path.join(h.root,p))),sealed_sha256:h.digest(fs.readFileSync(path.join(runtime.snapshot,p)))}));
 const compare={canonical_catalog:receipt('../pterodactyl-vite/upstream/game-eggs/'+recipe),admission,profile_current_matches_sealed:JSON.stringify(profile)===JSON.stringify(current),startup:profile.egg.startup,config_files:profile.egg.config.files,installer_sha256:h.digest(script),historical_profile_found:!!historical,historical_installer_sha256:historical?.egg?.scripts?.installation?.script?h.digest(historical.egg.scripts.installation.script):null,helpers,backend};
 save('comparison.json',compare);
 const template=(await h.api('/api/client/game-library/templates/'+h.digest(recipe).slice(0,16))).attributes;
 save('template.json',template);report.actual.push('Active canonical profile and template fetched; emitted helper bytes and settings backend compared with sealed snapshot and original acceptance');
 report.evidence=[receipt('artifacts/gmod-live-acceptance.json'),receipt('artifacts/gmod-cleanup.json'),receipt('artifacts/game-parity-20261029/wave99-gmod-frozen-trace/report.json')];
 report.reused.push({receipt:'artifacts/gmod-live-acceptance.json',scope:'Historical native app4020 build25375525 install, A2S hostname/map/password, RCON accept/reject, map change, quit exit0/noOOM, Lua counter0->4 and 27-file bytes/mode/UID/GID preservation through reinstall remain accepted within original recipe/helper scope.',current_helper_equivalence:helpers.every(x=>x.exact_match),does_not_prove_current_typed_adapter:true});
 report.pending.push('Current typed sandbox edit must reach native engine and be read back as a ConVar. Historical sbox_maxprops=73 was an operator file edit, not this typed adapter.');
 report.limitations.push('No native fixture created in this preparation phase. No native acceptance or full parity claim. Historical node202 was not contacted.');
 report.pending.push(...helpers.filter(x=>!x.exact_match).map(x=>'Changed emitted '+x.name+' requires affected native check; historical receipt is retained, not promoted to proof of these bytes.'));
 const cacheDirectories=['.local/source-next/gmod','.local/source-next','.local/source-games'];
 save('payload-search.json',cacheDirectories.map(p=>({path:p,archives:fs.readdirSync(path.join(h.root,p),{withFileTypes:true}).filter(x=>x.isFile()&&/\.(tar|tgz|gz|xz|zst|zip)$/.test(x.name)).map(x=>({name:x.name,bytes:fs.statSync(path.join(h.root,p,x.name)).size}))})));
 report.next_required_action='Provide the location of a reusable app4020 payload if root has one outside the searched historical directories. Otherwise the authorized native continuation needs cold Steam acquisition at canonical 4096MiB/16384MiB and three ports. Acquire only a free serialized installer slot; apply cache-validator to own egg before create if using a payload. Run typed sbox_maxprops edit and native GetConVar readback, plus affected console/lifecycle/reinstall checks for the five changed helpers. Capture callback and raw installer exit, export full payload/config/save/metadata, then verify exact owned absence before release.';
 report.resources={memory_mib:4096,disk_mib:16384,ports:3,cpu:100,swap:0};
 report.complete=false;
} catch(e) {report.failed.push({stage:'preparation',message:e.message});report.next_required_action='Resolve the recorded preparation failure before claiming native resources.';process.exitCode=1;}
save('report.json',report);
console.log(JSON.stringify(report,null,2));
