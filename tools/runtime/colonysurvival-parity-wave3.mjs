// Stage native document discovery without modifying canonical profiles/runtime.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const recipe = 'colony_survival/egg-colony-survival.json';
const original = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json', 'utf8'))[recipe];
assert.ok(original, 'Colony Survival profile missing');
const source = fs.readFileSync('internal/panel/game_library/scripts/steam-native-next.py', 'utf8');
assert.ok(source.includes("target=confined(root,root/'server.config.json');config=json_unique"), 'Review changed config location/format');
const profile = structuredClone(original);
profile.settings_documents = {...profile.settings_documents, '/server.config.json': 'json'};
assert.deepEqual(profile.egg, original.egg);
fs.writeFileSync('artifacts/game-parity-20261029/colonysurvival-wave3-profile.json', JSON.stringify({[recipe]: profile}, null, 2) + '\n');
console.log('Staged Colony Survival JSON discovery. Fence runtime-owned paths before merging.');
