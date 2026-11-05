// Read-only reconciliation of source receipts plus loopback GET status.
// No gate promotion, resource claim or runtime mutation.
import fs from 'node:fs';
import crypto from 'node:crypto';
const base='artifacts/game-parity-20261029';
const read=file=>JSON.parse(fs.readFileSync(file));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inventory=read(base+'/inventory.json'),catalogPaths=new Set(inventory.games.map(game=>game.path));
const integration=new Map();
function add(recipe,evidence){if(!catalogPaths.has(recipe))return;const list=integration.get(recipe)||[];if(!list.includes(evidence))list.push(evidence);integration.set(recipe,list);}
const receipts=['root-game-integration.json','root-wave2-integration.json','root-wave3-integration.json','wave2-root-integration.json','wave3-root-integration.json','root-ready-merge.json'];
for(const name of receipts){
 const file=base+'/'+name;if(!fs.existsSync(file))continue;const receipt=read(file);
 for(const recipe of [...(receipt.integrated_profiles||[]),...(receipt.integrated_games||[])])add(recipe,file);
 for(const change of receipt.changes||[])if(change.recipe)add(change.recipe,file);
 for(const alias of receipt.profiles||[]){
  if(typeof alias!=='string'||!/^[a-z0-9_-]+$/.test(alias))continue;
  const fragment=base+'/'+alias+'-profile.json';
  if(fs.existsSync(fragment))for(const recipe of Object.keys(read(fragment)))add(recipe,file);
 }
}
const groups=Object.values(inventory.games.reduce((out,game)=>{const key=game.path.split('/')[0].toLowerCase();(out[key]??={group:key,variants:[]}).variants.push(game.path);return out;},{})).sort((a,b)=>a.group.localeCompare(b.group));
const get=async(route)=>{const response=await fetch('http://127.0.0.1:18099'+route,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('GET '+route+' '+response.status);return response.json();};
const live={origin:'http://127.0.0.1:18099',captured_at:new Date().toISOString(),read_only:true,servers:[]};
try{
 live.health=await get('/healthz');
 for(const row of (await get('/api/application/servers')).data||[]){
  const server=row.attributes;let resources={},resource_error;
  try{resources=(await get('/api/client/servers/'+server.uuid+'/resources')).attributes;}catch(error){resource_error=String(error);}
  live.servers.push({uuid:server.uuid,identifier:server.identifier,name:server.name,node:server.node,status:server.status,installed:server.container?.installed===1,current_state:resources.current_state||'unavailable',resource_error});
 }
}catch(error){live.error=String(error);}
const activationFile=base+'/root-activation.json';
const activation=fs.existsSync(activationFile)?read(activationFile):null;
const stkFile=base+'/stk-root-source-fix.json',ddnetFile=base+'/ddnet-root-native.json';
const stk=fs.existsSync(stkFile)?read(stkFile):null,ddnet=fs.existsSync(ddnetFile)?read(ddnetFile):null;
const status={
 captured_at:new Date().toISOString(),goal_complete:false,
 definitions:{catalog_variant:'One catalog recipe path, including loaders, engines, platforms and editions. This is what241 counts.',family_group:'First catalog recipe directory, case-folded. This is a structural grouping, not an audited unique-title count; some group multiple titles and some aliases split one title.',prepared_profile:'A local override exists. This includes older work, and never implies current-campaign native acceptance.',campaign_prepared:'Explicit root integration receipts listed here cover the variant; count is a documented lower bound, not all source work.',native_complete:'All five independent ledger gates verified with reviewed evidence for current source. No historical runtime_verified promotion.'},
 counts:{catalog_variants:inventory.total,structural_family_groups:groups.length,audited_distinct_game_titles:null,local_profile_variants:inventory.games.filter(game=>game.profile).length,managed_bridge_variants:inventory.games.filter(game=>game.managed_game).length,go_assembled_fs25_variants:inventory.games.filter(game=>game.path==='farming-simulator/egg-farming-simulator-25.json').length,documented_campaign_prepared_variants:integration.size,fully_verified_variants:inventory.complete,variants_awaiting_full_native_acceptance:inventory.total-inventory.complete,settings_partial_source:inventory.counts.settings.partial,settings_unknown:inventory.counts.settings.unknown},
 gates:inventory.counts,
 warnings:inventory.warnings,
 ledger:{path:base+'/inventory.json',sha256:sha(base+'/inventory.json'),reviewed_gates_path:base+'/reviewed-gates.json',reviewed_gates_sha256:sha(base+'/reviewed-gates.json'),gate_promotions:false},
 activation:activation?{evidence:activationFile,pid:activation.pid,binary_sha256:activation.binary_sha256,health:activation.health,source_fingerprint:activation.source_fingerprint,scope:'Panel activation receipt only; this observer did not revalidate binary/source/runtime identity.'}:null,
 current_native:live,
 latest_native_evidence:{
  stk:stk?{evidence:stkFile,complete:stk.complete,result:stk.result,official_binary_unchanged:stk.native_ab?.official_binary?.changed===false,direct_normalized_exit_codes:stk.native_ab?.normalized_environment?.native_raw_returncodes,scope_limit:stk.native_ab?.scope_limit}:null,
  ddnet:ddnet?{evidence:ddnetFile,complete:ddnet.complete,status:ddnet.status,owned_resources_removed:ddnet.cleanup?.owned_resources_removed,default_failure:ddnet.default_failure?.error}:null,
  clonehero:fs.existsSync(base+'/clonehero-wave4-native.json')?{evidence:base+'/clonehero-wave4-native.json',complete:false,scope:'Real canonical cached installation, readiness,14-field typed API edit, stale/injection rejection and requested native SIGINT. Cached reinstall and five-gate/player acceptance incomplete.'}:null
 },
 family_groups:groups,
 documented_campaign_prepared:[...integration.entries()].map(([recipe,evidence])=>({recipe,evidence})).sort((a,b)=>a.recipe.localeCompare(b.recipe)),
 variants:inventory.games.map(game=>({recipe:game.path,name:game.name,family_group:game.path.split('/')[0].toLowerCase(),local_profile:game.profile,managed_bridge:game.managed_game,documented_campaign_prepared:integration.has(game.path),complete:game.complete,gates:Object.fromEntries(Object.entries(game.gates).map(([name,gate])=>[name,{status:gate.status,kind:gate.kind,reason:gate.reason,evidence:gate.evidence}]))})),
 boundaries:['No reviewed-gates modification or verification promotion.','Native direct A/B evidence does not establish actual Wings lifecycle, browser, reinstall, permissions or player acceptance.','Counts are a timestamped snapshot and must be refreshed after integrations/native runs.','All subsequent native work remains subject to fresh root receipt plus coordinator lease/installer lock.']
};
fs.writeFileSync(base+'/current-work-status.json',JSON.stringify(status,null,2)+'\n');
const listFile=base+'/UNTESTED-GAMES.md';
const list=fs.readFileSync(listFile,'utf8').replace(/^(# Games awaiting complete native acceptance\n\n)(?:Snapshot [^\n]*\n\n)+/,'$1');
const note=`Snapshot ${status.captured_at}. The ${inventory.total} entries are catalog variants across ${groups.length} top-level directory family groups, not ${inventory.total} distinct game titles. ${status.counts.local_profile_variants} have local profiles including historical work; ${integration.size} variants have explicit campaign integration receipts listed in current-work-status.json. Neither count establishes native completion. Settings evidence is partial for ${inventory.counts.settings.partial} entries and unknown for ${inventory.counts.settings.unknown}.\n\n`;
fs.writeFileSync(listFile,list.replace('# Games awaiting complete native acceptance\n\n','# Games awaiting complete native acceptance\n\n'+note));
console.log(JSON.stringify({counts:status.counts,current_native:live.servers,health:live.health,error:live.error}));
