import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {policy} from './campaign-native-20261029.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const recipe='icarus/egg-icarus--dedicated.json', base='internal/panel/game_library/scripts/';
const original=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===recipe);
const profile=structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe]);
assert.deepEqual(profile.egg.variables.slice(0,original.egg.variables.length),original.egg.variables);
const embedded={};
let script=profile.egg.scripts.installation.script;
// Refresh every existing embedded module from its retained shared source.
script=script.replace(/cat > \.voltra\/([^ ]+) <<'VOLTRA_SPACE_SURVIVAL_SOURCE'\n[\s\S]*?\nVOLTRA_SPACE_SURVIVAL_SOURCE\n/g,(_,destination)=>{
 const source=destination==='steam_template.py'?'steam-template.py':destination;
 const bytes=fs.readFileSync(base+source,'utf8').replaceAll('\r\n','\n');
 embedded[destination]=sha(bytes);return `cat > .voltra/${destination} <<'VOLTRA_SPACE_SURVIVAL_SOURCE'\n${bytes}\nVOLTRA_SPACE_SURVIVAL_SOURCE\n`;
});
const wrapper=fs.readFileSync(base+'icarus-native.py','utf8').replaceAll('\r\n','\n');
embedded['icarus-native.py']=sha(wrapper);
script=script.replace('python3 .voltra/space-survival.py install icarus',`cat > .voltra/icarus-native.py <<'VOLTRA_ICARUS_SOURCE'\n${wrapper}\nVOLTRA_ICARUS_SOURCE\npython3 .voltra/icarus-native.py install`);
assert.ok(script.includes(wrapper));assert.ok(Object.keys(embedded).length>10);
profile.egg.scripts.installation.script=script;
profile.egg.startup='exec /usr/bin/python3 .voltra/icarus-native.py run';
profile.egg.config.startup='{}'; // Engine initialization alone is not native readiness.
profile.revision='icarus-byte-preservation-v2';
profile.verification='not_verified';
profile.detail='Source fixtures only; unserved candidate. Engine-init readiness marker removed. Byte-preserving legacy migration; shared log/stop/install retained.';
const out='artifacts/game-parity-20261029/icarus-owner-20261030';fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/profile.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
fs.writeFileSync(out+'/source-receipt.json',JSON.stringify({recipe,original_sha256:original.sha256,profile_sha256:sha(fs.readFileSync(out+'/profile.json')),embedded_sha256:embedded,original_variables_preserved:true,defaults:profile.defaults,resource_policy:policy,boundary:'source only; no acquisition, activation, native run or lease',native_resources_created:[]},null,2)+'\n');
console.log('Icarus-only profile staged; original ordered variables verified; embedded hashes recorded.');
