import {test} from 'node:test';
import assert from 'node:assert/strict';
import {refreshHelpers} from './refresh-profile-helpers.mjs';

test('selected helpers refresh literally while settings and reviewed evidence survive', () => {
  const script = "cat > .voltra/steam_template.py <<'PY_HELPER'\nold\nPY_HELPER\ncat > other.py <<'OTHER'\nuntouched\nOTHER\n";
  const input = {game: {verification: 'runtime_verified', detail: 'native proof', egg: {variables: [{name: 'original'}], scripts: {installation: {script}}}}};
  const source = "literal = \"$' $& $`\"\n";
  const result = refreshHelpers(input, new Map([['steam_template', source]]));
  assert.equal(result.changes.length, 1);
  assert(result.profiles.game.egg.scripts.installation.script.includes(source));
  assert(result.profiles.game.egg.scripts.installation.script.includes('untouched'));
  assert.equal(result.profiles.game.verification, 'runtime_verified');
  assert.equal(result.profiles.game.detail, 'native proof');
  assert.deepEqual(result.profiles.game.egg.variables, input.game.egg.variables);
  assert.equal(input.game.egg.scripts.installation.script, script);
  assert.equal(refreshHelpers(result.profiles, new Map([['steam_template', source]])).changes.length, 0);
  assert.throws(() => refreshHelpers(input, new Map([['steam_template', 'PY_HELPER']])), /collision/);
});

test('hyphenated installed filenames use the same source lookup as underscore names', () => {
  const input = {game: {verification: 'runtime_verified', egg: {scripts: {installation: {
    script: "cat > .voltra/native-release.py <<'RELEASE'\nold\nRELEASE\ncat > .voltra/native_release.py <<'OTHER'\nold\nOTHER\n",
  }}}}};
  const result = refreshHelpers(input, new Map([['native_release', 'boundary_checked = True\n']]));
  assert.equal(result.changes.length, 2);
  assert.equal(result.profiles.game.egg.scripts.installation.script.match(/boundary_checked = True/g).length, 2);
  assert.equal(result.profiles.game.verification, 'runtime_verified');
  assert.equal(refreshHelpers(result.profiles, new Map([['native_release', 'boundary_checked = True\n']])).changes.length, 0);
});

test('source trailing blank lines remain literal and refresh is idempotent', () => {
  const source = 'def checked():\n    return True\n\n';
  const input = {game: {egg: {scripts: {installation: {script: "cat > native-console.py <<'PY'\ndef checked():\n    return True\nPY\n"}}}}};
  const result = refreshHelpers(input, new Map([['native_console', source]]));
  assert.equal(result.changes.length, 1);
  assert(result.profiles.game.egg.scripts.installation.script.includes(source));
  assert.equal(refreshHelpers(result.profiles, new Map([['native_console', source]])).changes.length, 0);
});
