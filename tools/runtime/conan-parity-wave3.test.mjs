import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stageProfiles, variants} from './conan-parity-wave3.mjs';

const current = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const catalog = JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));

test('both Conan profiles expose only exact platform native INI paths', () => {
  const profiles = stageProfiles(current, catalog);
  assert.deepEqual(Object.keys(profiles), Object.keys(variants));
  for (const [recipe, platform] of Object.entries(variants)) {
    const docs = profiles[recipe].settings_documents;
    for (const name of ['ServerSettings.ini', 'Engine.ini', 'Game.ini']) {
      assert.equal(docs[`/ConanSandbox/Saved/Config/${platform}/${name}`], 'ini');
    }
    assert(!Object.keys(docs).some(file => file.includes(platform === 'WindowsServer' ? '/LinuxServer/' : '/WindowsServer/')));
  }
});

test('staging preserves every profile byte-equivalent value except discovery metadata', () => {
  const before = JSON.stringify(current);
  for (const [recipe, profile] of Object.entries(stageProfiles(current, catalog))) {
    const expected = structuredClone(current[recipe]);
    delete expected.settings_documents;
    const actual = structuredClone(profile);
    delete actual.settings_documents;
    assert.deepEqual(actual, expected);
  }
  assert.equal(JSON.stringify(current), before);
});

test('stale upstream recipe hashes refuse before staging', () => {
  const input = structuredClone(current);
  input[Object.keys(variants)[0]].upstream_sha256 = 'stale';
  assert.throws(() => stageProfiles(input, catalog), /Stale Conan upstream digest/);
});

test('metadata stager is idempotent', () => {
  const staged = stageProfiles(current, catalog);
  assert.deepEqual(stageProfiles({...current, ...staged}, catalog), staged);
});
