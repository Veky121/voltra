// Source-only declaration staging. Does not mutate canonical overrides or runtime.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const recipe = 'among_us/impostor_server/egg-among-us--impostor-server.json';
const profiles = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json', 'utf8'));
const original = profiles[recipe];
assert.ok(original, 'Impostor override missing');
const runtime = fs.readFileSync('internal/panel/game_library/scripts/among-us-runtime.py', 'utf8');
assert.ok(runtime.includes("root/'impostor/config.json'"), 'Review changed native config location before staging');
assert.ok(runtime.includes('config=json.loads(path.read_text())'), 'Review changed native format before staging');
const profile = structuredClone(original);
profile.settings_documents = {...profile.settings_documents, '/impostor/config.json': 'json'};
assert.deepEqual(profile.egg, original.egg, 'Declaration must preserve the exact installed egg and controls');
fs.writeFileSync('artifacts/game-parity-20261029/impostor-wave2-profile.json', JSON.stringify({[recipe]: profile}, null, 2) + '\n');
console.log('Staged Impostor native JSON discovery; root must fence managed listeners before merging.');
