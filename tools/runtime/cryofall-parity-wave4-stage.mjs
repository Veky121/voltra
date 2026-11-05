import fs from 'node:fs';
import assert from 'node:assert/strict';
const recipe = 'cryofall/egg-cryo-fall.json';
const overrides = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const original = overrides[recipe], profile = structuredClone(original);
const canonical = 'internal/panel/game_library/scripts/cryofall-file-authority.py';
const source = fs.readFileSync(canonical, 'utf8').replaceAll('\r\n', '\n');
assert.ok(profile.egg.startup.endsWith('.voltra/cryofall_runtime.py'));
assert.ok(!source.includes('VOLTRA_CRYOFALL_AUTHORITY_WAVE4'));
const marker = 'python3 .voltra/bundle_debian_python.py';
assert.equal(profile.egg.scripts.installation.script.split(marker).length, 2);
profile.egg.scripts.installation.script = profile.egg.scripts.installation.script.replace(marker,
  `cat > .voltra/cryofall_file_authority.py <<'VOLTRA_CRYOFALL_AUTHORITY_WAVE4'\n${source}\nVOLTRA_CRYOFALL_AUTHORITY_WAVE4\n${marker}`);
profile.egg.startup = profile.egg.startup.replace('.voltra/cryofall_runtime.py', '.voltra/cryofall_file_authority.py');
profile.revision += '-native-authority-wave4';
profile.detail += ' CryoFall-only source fixtures preserve existing native controls and honor the original automatic-update control; no additional native acceptance.';
profile.setup_steps.push('Native XML values take precedence over creation defaults for name, player count, listing, client-mod restrictions and operators. Allocated listener port/IP remain runtime-owned. A dedicated nested XML settings editor still needs root integration.');
assert.deepEqual(profile.egg.variables, original.egg.variables);
for (const key of ['upstream_sha256', 'verification', 'platforms', 'required_ports', 'port_rules', 'defaults']) assert.deepEqual(profile[key], original[key]);
for (const key of ['config', 'docker_images', 'features']) assert.deepEqual(profile.egg[key], original.egg[key]);
// Merge only together with root's exact recipe/path CryoFall parser dispatch.
profile.settings_documents = {...profile.settings_documents, '/Data/SettingsServer.xml':'xml'};
const target = 'artifacts/game-parity-20261029/cryofall-wave4-profile.json';
fs.writeFileSync(target, JSON.stringify({[recipe]: profile}, null, 2) + '\n');
console.log(JSON.stringify({target, controls_preserved: profile.egg.variables.length, native_acceptance: false}));
