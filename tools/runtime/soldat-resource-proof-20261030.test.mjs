import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resourceEgg} from './soldat-resource-proof-20261030.mjs';
const profile=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/soldat-resource-proof-20261030/served-profile.json'))['soldat/egg-soldat.json'];
test('resource fixture preserves exact ordered variables/defaults/perms and original profile',()=>{
 const before=JSON.stringify(profile),egg=resourceEgg(profile,'11111111-1111-1111-1111-111111111111');
 assert.deepEqual(egg.variables,profile.egg.variables);assert.equal(JSON.stringify(profile),before);
 assert.match(egg.name,/RESOURCE PROOF ONLY/);assert.equal(egg.startup,'exec sleep 120');
 assert.doesNotMatch(egg.scripts.installation.script,/apt-get|steamcmd|curl|wget/);
 assert.match(egg.scripts.installation.script,/campaign-release-11111111/);
});
test('fixture refuses changed baseline and invalid gate token',()=>{
 assert.throws(()=>resourceEgg({...profile,defaults:{memory:1024,disk:4096}},'x'),/baseline/);
 assert.throws(()=>resourceEgg(profile,'bad'),/token/);
});
