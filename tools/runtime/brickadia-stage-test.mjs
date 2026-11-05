import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const root = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brickadia-stage-'));
const key = 'brickadia/egg-brickadia.json';
const original = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const output = 'artifacts/game-parity-20261029/brickadia-wave3-profile.json';
function write(name, value) {
  const target = path.join(temporary, name);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.writeFileSync(target, value);
}
function run(success = true) {
  const result = spawnSync(process.execPath, [path.join(root, 'tools/runtime/brickadia-parity-wave3-stage.mjs')],
    {cwd:temporary, encoding:'utf8', windowsHide:true});
  assert.equal(result.status === 0, success, result.stderr);
}
try {
  fs.mkdirSync(path.join(temporary, path.dirname(output)), {recursive:true});
  for (const file of ['internal/panel/game_library/upstream/catalog.json',
    'internal/panel/game_library/scripts/brickadia-file-authority.py']) write(file, fs.readFileSync(file));
  write('internal/panel/game_library/overrides.json', JSON.stringify(original));
  run();
  const first = fs.readFileSync(path.join(temporary, output));
  const staged = JSON.parse(first);
  write('internal/panel/game_library/overrides.json', JSON.stringify(staged));
  run();
  assert.deepEqual(fs.readFileSync(path.join(temporary, output)), first, 'Restaging must be byte stable');
  staged[key].egg.scripts.installation.script += "\ncat > .voltra/brickadia_parity_wave3.py <<'VOLTRA_BRICKADIA_PARITY_WAVE3'\nbad\nVOLTRA_BRICKADIA_PARITY_WAVE3\n";
  write('internal/panel/game_library/overrides.json', JSON.stringify(staged));
  run(false);
  assert.deepEqual(fs.readFileSync(path.join(temporary, output)), first, 'Refusal must preserve prior stage');
  console.log('PASS: current launcher, canonical embed, upstream controls, idempotence, duplicate refusal preserves stage');
} finally {
  fs.rmSync(temporary, {recursive:true});
}
