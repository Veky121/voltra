import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const canonical='internal/panel/game_library/overrides.json';
const destination='artifacts/game-parity-20261029/source-pair-wave4-profile.json';
const before=fs.readFileSync(canonical);
const run=()=>execFileSync(process.execPath,['tools/runtime/source-pair-parity-wave4-stage.mjs'],{encoding:'utf8',windowsHide:true});
run();const first=fs.readFileSync(destination);run();const second=fs.readFileSync(destination);
assert(first.equals(second),'Repeated staging changed the fragment');
assert(fs.readFileSync(canonical).equals(before),'Staging mutated canonical profiles');
const staged=JSON.parse(second),current=JSON.parse(before);
for(const [recipe,profile] of Object.entries(staged)){
 assert.deepEqual(profile.egg.variables,current[recipe].egg.variables,'Original ordered controls changed');
 assert.equal((profile.egg.scripts.installation.script.match(/cat > \.voltra\/source_pair_preflight\.py/g)||[]).length,1,'Duplicate preflight embeds');
 assert.deepEqual(profile,current[recipe],'Merged canonical helper/profile should stage unchanged');
}
console.log('PASS: two deterministic stages, exact merged profiles, original controls, one helper, canonical bytes unchanged.');
fs.writeFileSync('artifacts/game-parity-20261029/source-pair-wave4-stager.json',JSON.stringify({at:new Date().toISOString(),scope:'SourcePair stage idempotence only',checks:{repeated_fragment_bytes_identical:true,canonical_bytes_unchanged:true,staged_equals_integrated_canonical:true,single_helper_embed:true,ordered_controls_preserved:true},recipes:Object.entries(staged).map(([recipe,p])=>({recipe,controls:p.egg.variables.length})),native_game_actions:false,complete:false},null,2)+'\n');
