import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stage,recipe} from './stage-no-one-survived.mjs';
const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json','utf8'));
const body=fs.readFileSync('internal/panel/game_library/scripts/no-one-survived.py','utf8');
// The stager deliberately refuses an already adopted wrapper. Exercise its
// original input from the immutable integration snapshot as well.
if(current[recipe].egg.startup==='exec python3 .voltra/no-one-survived.py run'){
 assert.throws(()=>stage(current,body),/Unique original/);
 const original=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/root-exclusive-wave5-source/before.json','utf8'));
 current[recipe]=original[recipe];
}
const before=JSON.stringify(current);
const fragment=stage(current,body);
assert.deepEqual(Object.keys(fragment),[recipe]);
assert.equal(JSON.stringify(current),before);
assert.deepEqual(fragment[recipe].egg.variables,current[recipe].egg.variables);
assert.deepEqual(fragment[recipe].defaults,current[recipe].defaults);
assert.deepEqual(fragment[recipe].egg.config,current[recipe].egg.config);
assert.deepEqual(fragment[recipe].port_rules,current[recipe].port_rules);
assert.throws(()=>stage(fragment,body),/Unique original/);
console.log('PASS exact recipe isolation, unchanged controls/defaults/permissions/ports/config, idempotence refusal');
