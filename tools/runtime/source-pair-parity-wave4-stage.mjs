// Root merges only after its active native snapshot is no longer frozen.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const canonical='internal/panel/game_library/scripts/source-pair-preflight.py';
const source=fs.existsSync(canonical)?canonical:'tools/runtime/source-pair-parity-wave4.py';
const body=fs.readFileSync(source,'utf8').replaceAll('\r\n','\n').replace(/\n$/,'');
const delimiter='VOLTRA_SOURCE_PAIR_PREFLIGHT_WAVE4';
assert(!body.split('\n').includes(delimiter));
const original=fs.readFileSync('internal/panel/game_library/overrides.json');
const profiles=JSON.parse(original);
const staged={};
for(const [recipe,app,adapter] of [
 ['black_mesa/egg-black-mesa.json','346680','source_variant_runtime.py'],
 ['contagion/egg-contagion.json','293030','source_next_runtime.py'],
]){
 const current=profiles[recipe],profile=structuredClone(current);
 const integratedSuffix='.voltra/source_pair_preflight.py '+app;
 assert(profile.egg.startup.endsWith('.voltra/'+adapter)||profile.egg.startup.endsWith(integratedSuffix));
 assert.equal(profile.egg.variables.find(v=>v.env_variable==='SRCDS_APPID').default_value,app);
 if(!profile.egg.startup.endsWith(integratedSuffix))profile.egg.startup=profile.egg.startup.slice(0,-adapter.length)+'source_pair_preflight.py '+app;
 const block=`\ncat > .voltra/source_pair_preflight.py <<'${delimiter}'\n${body}\n${delimiter}\n`;
 const script=profile.egg.scripts.installation.script;
 const marker=`\ncat > .voltra/source_pair_preflight.py <<'${delimiter}'\n`;
 const start=script.indexOf(marker);
 if(start<0)profile.egg.scripts.installation.script+=block;
 else{
  assert.equal(script.indexOf(marker,start+marker.length),-1,'Ambiguous duplicate preflight helper embeds');
  const end=script.indexOf('\n'+delimiter+'\n',start+marker.length);
  assert(end>=0,'Existing helper heredoc is unterminated');
  profile.egg.scripts.installation.script=script.slice(0,start)+block+script.slice(end+delimiter.length+2);
 }
 assert.deepEqual(profile.egg.variables,current.egg.variables);
 const preserved=structuredClone(profile);
 preserved.egg.startup=current.egg.startup;
 preserved.egg.scripts.installation.script=current.egg.scripts.installation.script;
 assert.deepEqual(preserved,current,'Only scoped entrypoint and helper embed may differ');
 staged[recipe]=profile;
}
assert(fs.readFileSync('internal/panel/game_library/overrides.json').equals(original),'Canonical profiles changed while staging');
const destination='artifacts/game-parity-20261029/source-pair-wave4-profile.json';
fs.writeFileSync(destination,JSON.stringify(staged,null,2)+'\n');
console.log(JSON.stringify({destination,recipes:Object.keys(staged),original_controls:Object.fromEntries(Object.entries(staged).map(([p,v])=>[p,v.egg.variables.length])),helper_source:source,helper_sha256:createHash('sha256').update(body+'\n').digest('hex'),canonical_changed:false}));
