// Root-review candidate using Go overlays. Existing source stays unchanged.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const base = 'artifacts/game-parity-20261029/sevendays-wave3';
const sourcePath = 'internal/panel/game_settings_recipe_managed.go';
const input = fs.readFileSync(sourcePath, 'utf8');
const marker = 'func gameSettingsRecipeManaged(egg M, file, key string) bool {';
const branch = `
 // The launcher and private-console client own this connection. Change its
 // port/password through Runtime so XML and client credentials stay in sync.
 if steamGameID(egg) == "7days" && file == sevenDaysSettingsPath {
  switch key {
  case "TelnetEnabled", "TelnetPort", "TelnetPassword":
   return true
  }
 }
`;
assert.equal(input.split(marker).length, 2, 'Expected one integration point');
const candidate = input.replace(marker, marker + branch);
const candidatePath = base + '-candidate.go.txt';
fs.writeFileSync(candidatePath, candidate);
const testPath = path.resolve('internal/panel/game_settings_sevendays_wave3_test.go');
const testSource = path.resolve('tools/runtime/sevendays-parity-wave3-test.go.txt');
const results = [];
for (const [phase, fixes] of [['red', false], ['green', true]]) {
 const overlay = { Replace: { [testPath]: testSource } };
 if (fixes) overlay.Replace[path.resolve(sourcePath)] = path.resolve(candidatePath);
 const overlayPath = base + '-' + phase + '-overlay.json';
 fs.writeFileSync(overlayPath, JSON.stringify(overlay, null, 2) + '\n');
 const run = spawnSync('go', ['test', '-overlay', overlayPath, './internal/panel', '-run', '^TestSevenDaysWave3ManagedConsoleBoundary$', '-count=1'], {encoding:'utf8', windowsHide:true, timeout:180000});
 fs.writeFileSync(base + '-' + phase + '.log', (run.stdout || '') + (run.stderr || ''));
 if (run.error) throw run.error;
 results.push({phase, exit:run.status, log:base + '-' + phase + '.log'});
 assert.equal(run.status, fixes ? 0 : 1, 'Unexpected ' + phase + ' regression result');
}
assert.equal(fs.readFileSync(sourcePath, 'utf8'), input, 'Existing source changed');
fs.writeFileSync(base + '-checks.json', JSON.stringify({results, existing_source_unchanged:true,
 source:sourcePath, sha256:createHash('sha256').update(input).digest('hex'), candidate:candidatePath,
 profile_fragment:null, reason:'Managed bridge has no recipe override; native XML already discovers. Root must integrate the exact shared managed-key guard.'}, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
