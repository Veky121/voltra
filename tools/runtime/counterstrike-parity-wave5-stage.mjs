import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const source='internal/panel/game_library/scripts/counterstrike-preflight.py';
const rawSource=fs.readFileSync(source,'utf8');
const body=rawSource.replaceAll('\r\n','\n');
const payload=body.endsWith('\n')?body:body+'\n';
const delimiter='VOLTRA_COUNTERSTRIKE_PREFLIGHT_WAVE5';
assert(!body.split('\n').includes(delimiter));
const before=fs.readFileSync('internal/panel/game_library/overrides.json');
const profiles=JSON.parse(before),staged={},baselines={};
for(const [recipe,game,entry] of [
 ['counter_strike/counter_strike_source/egg-counter--strike--source.json','css','source_runtime.py'],
 ['counter_strike/counter_strike_1.6/egg-counter-strike1-6--vanilla.json','cs16','goldsrc_runtime.py'],
 ['counter_strike/counter_strike_1.6_rehlds/egg-cs 1.6-rehlds.json','rehlds','cs16_modules_runtime.py'],
]){
 const original=profiles[recipe],profile=structuredClone(original);
 assert(profile.egg.startup.endsWith('.voltra/'+entry)||profile.egg.startup.endsWith('.voltra/counterstrike_preflight.py '+game));
 if(profile.egg.startup.endsWith('.voltra/'+entry))profile.egg.startup=profile.egg.startup.slice(0,-entry.length)+'counterstrike_preflight.py '+game;
 profile.egg.scripts.installation.script=profile.egg.scripts.installation.script.replace(/\ncat > \.voltra\/counterstrike_preflight\.py <<'VOLTRA_COUNTERSTRIKE_PREFLIGHT_WAVE5'\n[\s\S]*?\nVOLTRA_COUNTERSTRIKE_PREFLIGHT_WAVE5\n/g,'');
 const header=`cat > .voltra/counterstrike_preflight.py <<'${delimiter}'\n`;
 profile.egg.scripts.installation.script+=`\n${header}${payload}${delimiter}\n`;
 const offset=profile.egg.scripts.installation.script.lastIndexOf(header)+header.length;
 assert.equal(profile.egg.scripts.installation.script.slice(offset,profile.egg.scripts.installation.script.indexOf(delimiter+'\n',offset)),payload,'Exact normalized canonical embed mismatch');
 assert.deepEqual(profile.egg.variables,original.egg.variables);
 const restored=structuredClone(profile);
 restored.egg.startup=original.egg.startup;restored.egg.scripts.installation.script=original.egg.scripts.installation.script;
 assert.deepEqual(restored,original,'Only entrypoint and helper embed may change');
 staged[recipe]=profile;
 baselines[recipe]={profile_sha256_compact_json:createHash('sha256').update(JSON.stringify(original)).digest('hex'),ordered_controls:profile.egg.variables.length};
}
assert(fs.readFileSync('internal/panel/game_library/overrides.json').equals(before));
const destination='artifacts/game-parity-20261029/counterstrike-wave5-profile.json';
fs.writeFileSync(destination,JSON.stringify(staged,null,2)+'\n');
const receipt={canonical_helper:source,canonical_raw_sha256:createHash('sha256').update(rawSource).digest('hex'),embedded_sha256:createHash('sha256').update(payload).digest('hex'),baseline_overrides_sha256:createHash('sha256').update(before).digest('hex'),baseline_profiles:baselines,exact_embeds_verified:3,canonical_overrides_changed:false};
fs.writeFileSync('artifacts/game-parity-20261029/counterstrike-wave5-integration.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({destination,...receipt}));
