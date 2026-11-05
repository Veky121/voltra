import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';import {stage} from './stage-cuberite-parity.mjs';
test('single-game fragment preserves ordered controls, allocations, stop and genuine readiness',()=>{
 const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));const before=JSON.stringify(current);const out=stage(current);const key='minecraft/java/cuberite/egg-cuberite.json';
 assert.deepEqual(Object.keys(out),[key]);assert.equal(JSON.stringify(current),before);
 assert.deepEqual(out[key].egg.variables,current[key].egg.variables);
 for(const field of ['port_rules','required_ports','platforms','defaults'])assert.deepEqual(out[key][field],current[key][field]);
 for(const field of ['startup','stop','logs'])assert.equal(out[key].egg.config[field],current[key].egg.config[field]);
 const staged=structuredClone(out[key]), original=structuredClone(current[key]);
 delete staged.egg.scripts.installation.script;delete original.egg.scripts.installation.script;assert.deepEqual(staged,original);
 for(const [name,file] of [['cuberite_parity_runtime.py','cuberite-parity-runtime.py'],['cuberite_parity_install.py','cuberite-parity-install.py'],['native_config.py','native-config.py']]){
 const script=out[key].egg.scripts.installation.script;const start=script.indexOf(`cat > .voltra/${name} <<`);assert.ok(start>=0);const lines=script.slice(start).split('\n');const marker=lines.shift().match(/<<'([^']+)'/)[1];const end=lines.findIndex(x=>x.trim()===marker);assert.equal(lines.slice(0,end).join('\n').trimEnd().replaceAll('\r',''),fs.readFileSync(`internal/panel/game_library/scripts/${file}`,'utf8').trimEnd().replaceAll('\r',''));}
assert.match(out[key].egg.scripts.installation.script,/python3 .voltra\/cuberite_parity_install.py/);
});
