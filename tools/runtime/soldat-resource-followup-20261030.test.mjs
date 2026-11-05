import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {reviewCleanup,resourceEgg} from './soldat-resource-followup-20261030.mjs';
const prior=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/soldat-resource-proof-20261030/report.json'));
test('retry binds exact authoritative cleanup receipt and concrete fix',()=>{
 const r=reviewCleanup(prior,'a'.repeat(64));assert.equal(r.lease_id,prior.resources.lease.lease_id);assert.equal(r.resources_removed,true);assert.match(r.fix_reason,/unbound/);
 for(const key of ['lease_released','server_removed','slot_released']){const p=structuredClone(prior);p.resources[key]=false;assert.throws(()=>reviewCleanup(p,'a'.repeat(64)),/incomplete/);}
 const p=structuredClone(prior);p.filesystem_cleanup[0].absent=false;assert.throws(()=>reviewCleanup(p,'a'.repeat(64)),/incomplete/);
});
test('controller uses automatic waiter without manual configure or fallback',()=>{
 const source=fs.readFileSync('tools/runtime/soldat-resource-followup-20261030.mjs','utf8');assert.match(source,/await g.waitNativeInstaller\(s,/);assert.doesNotMatch(source,/g.configureInstallerSupplement|claimNativeUtility|requeue/);
 const profile=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/soldat-resource-proof-20261030/served-profile.json'))['soldat/egg-soldat.json'];
 const egg=resourceEgg(profile,'11111111-1111-1111-1111-111111111111');assert.deepEqual(egg.variables,profile.egg.variables);assert.doesNotMatch(egg.scripts.installation.script,/steamcmd|curl|wget|apt-get/);
});
