import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const base='artifacts/game-parity-20261029/wave58-goldsrc_generic';
fs.mkdirSync(base,{recursive:true});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const canonical='internal/panel/game_library/overrides.json', before=fs.readFileSync(canonical), profiles=JSON.parse(before);
const keys=['hlds_server/vanilla/egg-custom-h-l-d-s-engine-game.json','hlds_server/rehlds/egg-custom-re-h-l-d-s-engine-game.json'];
const fragment={};
for(const key of keys){
 const original=profiles[key], p=structuredClone(original);
 let script=p.egg.scripts.installation.script;
 for(const [source,target] of [['goldsrc-runtime.py','goldsrc_runtime.py'],['goldsrc-install.py','goldsrc_install.py']]){
  const begin=`cat > .voltra/${target} <<'VOLTRA_SOURCE'\n`, start=script.indexOf(begin);
  assert(start>=0,`Missing exact emitted helper ${target}`);
  const end=script.indexOf('\nVOLTRA_SOURCE',start+begin.length);assert(end>=0);
  script=script.slice(0,start+begin.length)+fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8').trimEnd()+script.slice(end);
 }
 const invocation='python3 .voltra/bundle_debian_python.py\n';assert(script.includes(invocation));
 script=script.replace(invocation,`PYTHONPATH=.voltra python3 -c 'import os; from pathlib import Path; from goldsrc_runtime import preflight; preflight(Path.cwd(), os.environ)'\n`+invocation);
 p.egg.scripts.installation.script=script;
 const restored=structuredClone(p);restored.egg.scripts.installation.script=original.egg.scripts.installation.script;
 assert.deepEqual(restored,original);
 fragment[key]=p;
}
fs.writeFileSync(base+'/recipes.pending.json',JSON.stringify(fragment,null,2)+'\n');
assert(fs.readFileSync(canonical).equals(before));
const ids=Object.entries({'FACT':6,'SETUP':4,'INSTALL':4,'CONSOLE':5,'SETTINGS':6,'LIFE':4,'FILES':2,'SCHEDULE':2,'DELIVERY':4}).flatMap(([prefix,n])=>Array.from({length:n},(_,i)=>prefix+'-'+(i+1)));
assert.equal(ids.length,37);
const files=['internal/panel/game_library/scripts/goldsrc-runtime.py','internal/panel/game_library/scripts/goldsrc-install.py','tools/runtime/test-goldsrc-wave58.py','tools/runtime/stage-goldsrc-wave58.mjs',base+'/recipes.pending.json'];
const report={scope:'SOURCE ONLY; unapplied fragments',outcome:'partial',native_promotion:false,canonical_sha256:hash(before),changes:files.map(file=>({file,sha256:hash(fs.readFileSync(file))})),fix:'Pure validation of settings, ports, update flags, Steam credential/branch/platform contract and ReHLDS version syntax before game acquisition; no writes on invalid prerequisites. CS1.6 does not opt into new preflight.',
 tests:{command:'wsl.exe -u root -e sh -lc "cd /mnt/c/Users/Veky/.t3/projects/pteroclone/ptero-go && python3 -B tools/runtime/test-goldsrc-wave58.py"',result:'17 tests passed',log:base+'/source-tests.log',boundary:'Python source fixtures only; network and publisher update/overlay mocked. No Go changed or Go tests run.'},
 failures:['Initial read used invalid PowerShell wildcard rg paths; subsequent exact reads succeeded. Initial cached-Go path listing returned no match; Go was not required.'],
 env_mapping:{seed_only:['Missing listip.cfg and banned.cfg empty operator ban lists'],always_applied:{HOSTNAME:'hostname in voltra_managed.cfg',SERVER_PASSWORD:'sv_password in voltra_managed.cfg',RCON_PASSWORD:'rcon_password in voltra_managed.cfg',PUBLIC_SERVER:'sv_lan in managed/bootstrap',SYS_TICRATE:'sys_ticrate in managed',SRV_SLOTS:'maxplayers in bootstrap',SRCDS_MAP:'map in bootstrap',HLDS_GAME:'-game argv and Steam app_set_config',VAC_PORT:'-sport argv, allocation owned',SERVER_PORT:'-port argv, allocation owned',SRV_SECURE:'-secure/-insecure argv',SRV_PINGBOOST:'-pingboost argv'},precedence:'server.cfg then voltra_managed.cfg; managed settings overwrite operator edits on each configure and retain private backups. No seed-only claim for managed settings. Wrapper/bootstrap regenerated. Unknown server.cfg and addon content preserved.'},
 boundaries:{os_bootstrap:'apt update/install runs before emitted Python preflight; no claim of refusal before OS bootstrap. Preflight runs before Python bundle and game acquisition.',version:'Syntax/branch validation only; nonexistent valid release tags can still fail after Steam acquisition; transactional working-install rollback across Steam/engine is not proved.',source_only:true,activation:false,appbuild:false,downloads:false,Docker:false,SSH:false,commits:false,nestedagents:false},
 root_integration_gaps:['Review/apply only the two recipe fragment keys; no canonical edits made. Do not regenerate other family profiles.','Installer needs SERVER_PORT and VOLTRA_ALLOCATED_PORTS. Root must verify allocation injection into actual install environment before integration.','Shared setup/UI owner retains secret classification and seed/always-applied labels; no metadata/schema guessed.','Generic mod/native settings support remains conservative; no CS1.6 gameplay schema copied to generic/ReHLDS.','Fresh integrated native/API/browser followup remains pending; shared Steam/native console hashes differ from historical proofs.'],cleanup:'TemporaryDirectory fixtures cleaned by unittest. No live resources created/touched; historical fixture cleanup is cited, not reverified.',recipes:[]};
for(let i=0;i<keys.length;i++){
 const proof='artifacts/goldsrc-'+(i?'rehlds':'half_life')+'-acceptance.json', b=fs.readFileSync(proof), old=JSON.parse(b);
 const supported={'FACT-1':'publisher_install and platform','INSTALL-1':'publisher_install','INSTALL-2':'native_query','INSTALL-3':'native_query','SETTINGS-2':'native_operator_config_reloaded','LIFE-1':'graceful_exit_codes','LIFE-3':'reinstall'};
 report.recipes.push({recipe:keys[i],current_profile_sha256:hash(JSON.stringify(profiles[keys[i]])),prior_proof:{file:proof,sha256:hash(b),verified_at:old.verified_at,publisher_install:old.publisher_install,limitations:old.limitations,cleanup:old.cleanup},source_comparison:Object.entries(old.source_scope).map(([emitted,value])=>{const file='internal/panel/game_library/scripts/'+emitted.replaceAll('_','-');return {emitted,historical_sha256:value.imported_sha256,current_sha256:fs.existsSync(file)?hash(fs.readFileSync(file)):null};}),checks:ids.map(id=>({id,status:id==='DELIVERY-3'?'pass':'pending',scope:id==='DELIVERY-3'?'source fixtures':'current integrated behavior not verified',evidence:id==='DELIVERY-3'?base+'/source-tests.log':proof,inherited_status:supported[id]?'pass':'unknown',inherited_evidence:supported[id]||'Prior aggregate receipt does not establish this individual checklist ID',limitation:id==='DELIVERY-3'?'No native promotion':'Historical observation retained; current source unapplied and not native verified'}))});
}
fs.writeFileSync(base+'/report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:base+'/report.json',fragment:base+'/recipes.pending.json',recipes:keys.length,checks_per_recipe:ids.length,canonical_unchanged:true}));
