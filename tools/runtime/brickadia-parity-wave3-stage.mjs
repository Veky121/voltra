import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const key = 'brickadia/egg-brickadia.json';
const original = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json', 'utf8'))[key];
assert.ok(original.egg.startup.endsWith('.voltra/unreal_building.py run brickadia') ||
  original.egg.startup.endsWith('.voltra/brickadia_parity_wave3.py'), 'Unknown Brickadia launcher');
const profile = structuredClone(original);
const source = fs.readFileSync('internal/panel/game_library/scripts/brickadia-file-authority.py', 'utf8').replaceAll('\r\n', '\n');
const delimiter = 'VOLTRA_BRICKADIA_PARITY_WAVE3';
assert.ok(!source.includes(delimiter));
profile.revision = 'brickadia-native-file-authority-wave3';
profile.settings_documents = {...profile.settings_documents,
  '/.config/Epic/Brickadia/Saved/Config/LinuxServer/GameUserSettings.ini': 'ini'};
profile.egg.startup = profile.egg.startup.replace('.voltra/unreal_building.py run brickadia', '.voltra/brickadia_parity_wave3.py');
const header = `cat > .voltra/brickadia_parity_wave3.py <<'${delimiter}'\n`;
const script = profile.egg.scripts.installation.script.replaceAll('\r\n', '\n');
const start = script.indexOf(header);
if (start >= 0) {
  assert.equal(script.indexOf(header, start + 1), -1, 'Duplicate Brickadia embed');
  const end = script.indexOf(`\n${delimiter}\n`, start + header.length);
  assert.ok(end >= 0, 'Unterminated Brickadia embed');
  profile.egg.scripts.installation.script = script.slice(0, start) + header + source +
    script.slice(end);
} else {
  assert.ok(original.egg.startup.endsWith('.voltra/unreal_building.py run brickadia'),
    'Active adapter has no installer embed');
  profile.egg.scripts.installation.script = script + `\n${header}${source}\n${delimiter}\n`;
}
const embedded = profile.egg.scripts.installation.script.split(header)[1].split(`\n${delimiter}\n`)[0];
assert.equal(embedded, source, 'Brickadia embed differs from canonical source');
profile.detail = 'Brickadia-only native INI seed-once and preflight proposal. Offline fixtures passed; all current campaign native gates remain unverified.';
assert.deepEqual(profile.egg.variables, original.egg.variables);
assert.deepEqual(profile.egg.config, original.egg.config);
assert.deepEqual(profile.egg.docker_images, original.egg.docker_images);
assert.deepEqual(profile.defaults, original.defaults);
const upstream = JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json', 'utf8'))
  .entries.find(entry => entry.path === key);
assert.ok(upstream, 'Missing exact upstream recipe');
assert.deepEqual(profile.egg.variables, upstream.egg.variables, 'Original ordered controls changed');
const output = 'artifacts/game-parity-20261029/brickadia-wave3-profile.json';
fs.writeFileSync(output, JSON.stringify({[key]: profile}, null, 2) + '\n');
console.log(JSON.stringify({output, controls_preserved: profile.egg.variables.length,
  helper_sha256: crypto.createHash('sha256').update(source).digest('hex'), native_acceptance: false}));
