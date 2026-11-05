// Stage only the reviewed adapter and current native writer; preserve all metadata.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {refreshHelpers} from './refresh-profile-helpers.mjs';
const overrides = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const fragments = {};
for (const key of ['arma/arma3/egg-arma3.json', 'arma/arma_reforger/egg-arma-reforger.json']) {
const original = overrides[key];
const names = key.includes('/arma3/') ? ['arma3_controls', 'arma_native'] : ['arma_native'];
const sources = new Map(names.map(name => [name, fs.readFileSync(`internal/panel/game_library/scripts/${name.replaceAll('_', '-')}.py`, 'utf8')]));
const {profiles} = refreshHelpers({[key]: original}, sources);
const staged = profiles[key];
for (const name of names) {
  assert(staged.egg.scripts.installation.script.replaceAll('\r\n', '\n').includes(sources.get(name).replaceAll('\r\n', '\n').trimEnd()));
}
const metadata = profile => {
  const result = structuredClone(profile);
  delete result.egg.scripts.installation.script;
  return result;
};
assert.deepEqual(metadata(staged), metadata(original));
if (key.includes('/arma3/')) assert.equal(staged.egg.variables.length, 33);
Object.assign(fragments, profiles);
}
fs.writeFileSync('artifacts/game-parity-20261029/arma3-review-profile.json', JSON.stringify(fragments, null, 2) + '\n');
console.log('Staged Arma 3 review fragment: 33 controls; all metadata preserved; both current shared helper embeds staged.');
