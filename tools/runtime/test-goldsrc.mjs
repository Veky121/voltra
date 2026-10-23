import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
let result = spawnSync(process.execPath, ['tools/runtime/sync-goldsrc-profiles.mjs'], {stdio:'inherit'});
assert.equal(result.status, 0);
const catalog = JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const profiles = JSON.parse(fs.readFileSync('.local/goldsrc-games/profiles.json'));
for (const [recipe, profile] of Object.entries(profiles)) {
  const original = catalog.entries.find(entry => entry.path === recipe).egg;
  for (const variable of original.variables) assert.ok(profile.egg.variables.some(next => next.env_variable === variable.env_variable), 'Lost ' + variable.env_variable);
  assert.equal(profile.required_ports, 2);
  assert.equal(profile.egg.config.stop, 'quit');
  assert.ok(profile.egg.scripts.installation.script.includes('+app_set_config'));
  assert.ok(profile.egg.scripts.installation.script.includes('goldsrc_install.py'));
  assert.ok(profile.egg.startup.includes('.voltra/goldsrc_runtime.py'));
}
result = spawnSync('docker', ['run', '--rm', '--network', 'none', '--mount', `type=bind,source=${process.cwd()},target=/workspace,readonly`, '-w', '/workspace', 'python:3.13-slim', 'python3', '-B', 'tools/runtime/test-goldsrc.py'], {stdio:'inherit',windowsHide:true});
assert.equal(result.status, 0);
console.log('GoldSrc original-variable/profile and native configuration tests passed');
