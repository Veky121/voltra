// Stage one current profile; root alone merges canonical overrides.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const recipe = 'beamng/kissmp/egg-kissmp.json';
const target = 'artifacts/game-parity-20261029/kissmp-wave2-profile.json';
const overrides = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const original = overrides[recipe];
const profile = structuredClone(original);
const helper = fs.readFileSync('internal/panel/game_library/scripts/kissmp-controls.py', 'utf8');
assert(!helper.includes('\nVOLTRA_KISSMP_AUTHORITY\n'));
profile.settings_documents = {...profile.settings_documents, '/config.json': 'json'};
profile.egg.startup = profile.egg.startup.replace('.voltra/racing-native.py run kissmp', '.voltra/kissmp-controls.py');
assert(profile.egg.startup.endsWith('.voltra/kissmp-controls.py'));
profile.egg.scripts.installation.script = profile.egg.scripts.installation.script.replace(
  /\ncat > \.voltra\/kissmp-controls.py <<'VOLTRA_KISSMP_AUTHORITY'\n[\s\S]*?\nVOLTRA_KISSMP_AUTHORITY\n/g, '');
profile.egg.scripts.installation.script += `\ncat > .voltra/kissmp-controls.py <<'VOLTRA_KISSMP_AUTHORITY'\n${helper}\nVOLTRA_KISSMP_AUTHORITY\n`;
profile.setup_steps = profile.setup_steps.map(text => text.replace(
  'Existing config.json remains editable in Files. Empty optional Startup controls retain native values;',
  'Existing config.json is authoritative in Game settings. Startup controls seed missing values only;'));
assert.deepEqual(profile.egg.variables, original.egg.variables);
assert.equal(profile.verification, original.verification);
fs.writeFileSync(target, JSON.stringify({[recipe]: profile}, null, 2) + '\n');
console.log(JSON.stringify({target, recipe, controlsPreserved: profile.egg.variables.length,
  documents: profile.settings_documents, nativeAcceptance: false}));
