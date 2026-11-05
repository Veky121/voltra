import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {recipe, stageCloneProfile} from './clonehero-parity-wave4.mjs';

const profiles = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const catalog = JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
test('only the exact general native INI is declared, excluding identities and binaries', () => {
  const staged = stageCloneProfile(profiles, catalog)[recipe];
  assert.ok(staged.settings_documents.includes('clone/settings.ini'));
  assert.ok(!staged.settings_documents.includes('clone/banlist.txt'));
  assert.ok(!staged.settings_documents.includes('clone/Server'));
  assert.deepEqual(staged.egg, profiles[recipe].egg);
  assert.equal(staged.verification, profiles[recipe].verification);
});
test('original profile metadata and ordered variable rows remain unchanged', () => {
  const staged = stageCloneProfile(profiles, catalog)[recipe];
  if (profiles[recipe].settings_documents === undefined) delete staged.settings_documents;
  else staged.settings_documents = profiles[recipe].settings_documents;
  assert.deepEqual(staged, profiles[recipe]);
});
test('upstream/source drift refuses and repeated metadata staging is idempotent', () => {
  const changed = structuredClone(profiles);
  changed[recipe].upstream_sha256 = 'invalid';
  assert.throws(() => stageCloneProfile(changed, catalog), /Stale/);
  const staged = {...profiles, ...stageCloneProfile(profiles, catalog)};
  assert.deepEqual(stageCloneProfile(staged, catalog), stageCloneProfile(profiles, catalog));
});
