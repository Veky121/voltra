// Stage reviewed shared-installer refresh only. Never mutate canonical profiles.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {refreshHelpers} from './refresh-profile-helpers.mjs';
const input = 'internal/panel/game_library/overrides.json';
const sourceFile = 'internal/panel/game_library/minecraft-install.py';
const source = fs.readFileSync(sourceFile, 'utf8');
const original = JSON.parse(fs.readFileSync(input));
const result = refreshHelpers(original, new Map([['minecraft_install', source]]));
const profiles = {};
for (const {recipe, module} of result.changes) {
  assert.equal(module, 'minecraft_install');
  assert(recipe.startsWith('minecraft/java/'));
  const next = result.profiles[recipe];
  const comparison = structuredClone(next);
  comparison.egg.scripts.installation.script = original[recipe].egg.scripts.installation.script;
  assert.deepEqual(comparison, original[recipe], 'Unexpected metadata change: ' + recipe);
  profiles[recipe] = next;
}
const output = 'artifacts/game-parity-20261029/catalog-readiness-java-profile.json';
fs.writeFileSync(output, JSON.stringify(profiles, null, 2) + '\n');
const receipt = {
  source: sourceFile,
  source_sha256: crypto.createHash('sha256').update(source).digest('hex'),
  changes: result.changes,
  preserved: 'All profile fields, original ordered variables/defaults/permissions, verification and installer structure outside this helper remain identical.',
  validation: [
    'Windows Docker Desktop desktop-linux, cached Python image sha256:27b7c9d4f13ca20bb1170148f02095d50a5dfce1f7f2dabf5ca273727e43b7ea',
    'test-minecraft-packs.py:14 passed; test-minecraft-special.py:7 passed; minecraft_install_test.py:10 passed',
    'Each fixture used --pull never --network none --read-only source bind --cap-drop ALL --security-opt no-new-privileges, 256MiB memory/no swap,1CPU,128PIDs,/tmp128MiB tmpfs',
  ],
  coverage: 'Canonical installer streaming/archive/scratch regressions plus existing pack publication/preservation and special-server fixtures. No Java/game downloads, execution, EULA acceptance or native promotion.',
  initial_runner_failures: ['unittest discover matched zero hyphen-named files; reran explicit file paths', 'Inline Python runner lost quotes crossing PowerShell/Docker; no test executed; explicit file commands passed'],
};
fs.writeFileSync('artifacts/game-parity-20261029/catalog-readiness-java-refresh.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({output, count: Object.keys(profiles).length, source_sha256: receipt.source_sha256}));
