import fs from 'node:fs';
import assert from 'node:assert/strict';
import {refreshHelpers} from './refresh-profile-helpers.mjs';

const file='internal/panel/game_library/overrides.json',original=fs.readFileSync(file);
const all=JSON.parse(original),recipes=['ddnet/egg-d-d-net.json','ddracenetwork/egg-d-d-race-network.json'];
const selected=Object.fromEntries(recipes.map(recipe=>[recipe,structuredClone(all[recipe])]));
const source=fs.readFileSync('internal/panel/game_library/scripts/ddnet-install.py','utf8');
const result=refreshHelpers(selected,new Map([['ddnet_install',source]]));
const disclosure='Latest selects the newest stable Linux x86-64 release with one official SHA-256 checksum. Newer announcements without one are skipped with a warning that names the selected version. Pin an explicit version to require it; missing or ambiguous checksums then stop installation. DDRace nightly remains a separate opt-in.';
for(const [recipe,profile] of Object.entries(result.profiles)){
 profile.setup_steps=[...(profile.setup_steps||[]).filter(step=>step!==disclosure),disclosure];
 assert.deepEqual(profile.egg.variables,all[recipe].egg.variables,'Original ordered variables changed');
 const preserved=structuredClone(profile);
 preserved.egg.scripts.installation.script=all[recipe].egg.scripts.installation.script;
 preserved.setup_steps=all[recipe].setup_steps;
 assert.deepEqual(preserved,all[recipe],'Unexpected profile change');
 assert(profile.egg.scripts.installation.script.includes(source.replaceAll('\r\n','\n').replace(/\n$/,'')));
}
assert.equal(result.changes.length,2,'Expected exactly two helper refreshes');
assert(fs.readFileSync(file).equals(original),'Canonical overrides changed while staging');
const output='artifacts/game-parity-20261029/ddnet-latest-wave4-profile.json';
fs.writeFileSync(output,JSON.stringify(result.profiles,null,2)+'\n');
console.log(JSON.stringify({output,recipes,helper_changes:result.changes,variables:Object.fromEntries(recipes.map(recipe=>[recipe,all[recipe].egg.variables.length])),canonical_overrides_changed:false}));
