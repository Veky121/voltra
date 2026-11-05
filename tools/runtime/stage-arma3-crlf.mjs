// Refresh only Arma 3. Existing receipts and canonical overrides remain unchanged.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {refreshHelpers} from './refresh-profile-helpers.mjs';
const key = 'arma/arma3/egg-arma3.json';
const original = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[key];
const sources = new Map(['arma3_controls', 'arma_native'].map(name => [name,
  fs.readFileSync(`internal/panel/game_library/scripts/${name.replaceAll('_', '-')}.py`, 'utf8')]));
const {profiles} = refreshHelpers({[key]:original}, sources);
const metadata = p => {const m=structuredClone(p); delete m.egg.scripts.installation.script; return m;};
assert.deepEqual(metadata(profiles[key]), metadata(original));
assert.equal(profiles[key].egg.variables.length, 33);
assert.deepEqual(Object.keys(profiles), [key]);
for (const source of sources.values()) assert(profiles[key].egg.scripts.installation.script.replaceAll('\r\n','\n').includes(source.replaceAll('\r\n','\n').trimEnd()));
fs.mkdirSync('artifacts/game-parity-20261029/arma3-crlf-20261030', {recursive:true});
fs.writeFileSync('artifacts/game-parity-20261029/arma3-crlf-20261030/profile.json', JSON.stringify(profiles,null,2)+'\n');
console.log('PASS: Arma 3 only; 33 controls and all metadata preserved; helper embeds checked.');
