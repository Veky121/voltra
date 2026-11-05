import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const file = 'internal/panel/game_library/overrides.json';
const originalBytes = fs.readFileSync(file);
const overrides = JSON.parse(originalBytes);
const canonical = 'internal/panel/game_library/scripts/cube-preflight.py';
const source = canonical;
const helper = fs.readFileSync(source, 'utf8').replaceAll('\r\n', '\n');
assert(!helper.includes('VOLTRA_CUBE_PREFLIGHT_WAVE5'));
const result = {};
for (const [recipe, game] of [['cubeengine/assaultcube/egg-assault-cube.json','assaultcube'], ['cubeengine/cube2/egg-cube2--sauerbraten.json','sauerbraten']]) {
  const current = overrides[recipe];
  const profile = structuredClone(current);
  const command = 'python3 .voltra/bundle_debian_python.py\n';
  assert.equal(profile.egg.scripts.installation.script.split(command).length, 2);
  assert(profile.egg.startup.endsWith(`.voltra/cube_runtime.py ${game}`));
  profile.egg.startup = profile.egg.startup.replace(`.voltra/cube_runtime.py ${game}`, `.voltra/cube_preflight.py ${game}`);
  profile.egg.scripts.installation.script = profile.egg.scripts.installation.script.replace(command,
    `cat > .voltra/cube_preflight.py <<'VOLTRA_CUBE_PREFLIGHT_WAVE5'\n${helper}\nVOLTRA_CUBE_PREFLIGHT_WAVE5\n${command}`);
  profile.revision += '-preflight-wave5';
  profile.detail += ' Source-only Cube preflight rejects invalid native controls, missing payloads and incomplete allocated game/query ports before credential/config publication. Existing native config grammars and supervisor semantics are unchanged.';
  profile.setup_steps.push('Read-only startup preflight validates both consecutive allocated UDP ports, native controls and managed paths before generating credentials/configuration. Native options and executable CubeScript remain in Files; no generic INI editor is applied.');
  assert.deepEqual(profile.egg.variables, current.egg.variables);
  for (const key of ['upstream_sha256','platforms','required_ports','consecutive_ports','defaults','verification','settings_documents']) assert.deepEqual(profile[key], current[key]);
  for (const key of ['config','docker_images','features']) assert.deepEqual(profile.egg[key], current.egg[key]);
  result[recipe] = profile;
}
assert(fs.readFileSync(file).equals(originalBytes), 'Canonical source changed during staging');
const output = 'artifacts/game-parity-20261029/cube-wave5-profile.json';
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({output, variants:Object.entries(result).map(([recipe,p])=>({recipe,controls:p.egg.variables.length})), helper_sha256:crypto.createHash('sha256').update(helper).digest('hex'), native_acceptance:false}));
