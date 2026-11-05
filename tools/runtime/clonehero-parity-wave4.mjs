// Root reviews this metadata-only fragment; canonical overrides stay frozen.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

export const recipe = 'clone_hero/egg-clone-hero.json';
export function stageCloneProfile(overrides, catalog) {
  const original = overrides[recipe];
  const upstream = catalog.entries.find(entry => entry.path === recipe);
  assert(original && upstream, 'Missing Clone Hero recipe');
  assert.equal(original.upstream_sha256, upstream.sha256, 'Stale Clone Hero upstream digest');
  assert.equal(original.egg.startup, 'exec python3 .voltra/small_games_family_runtime.py clone', 'Review changed native adapter before staging');
  const profile = structuredClone(original);
  const declared = original.settings_documents || [];
  const documents = Array.isArray(declared) ? declared : Object.keys(declared).map(file => file.replace(/^\//, ''));
  profile.settings_documents = [...new Set([...documents, 'clone/settings.ini'])];
  const unchanged = structuredClone(profile);
  if (original.settings_documents === undefined) delete unchanged.settings_documents;
  else unchanged.settings_documents = original.settings_documents;
  assert.deepEqual(unchanged, original, 'Only native discovery metadata may change');
  return {[recipe]: profile};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = fs.readFileSync('internal/panel/game_library/overrides.json');
  const staged = stageCloneProfile(JSON.parse(source), JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')));
  const receipt = JSON.parse(fs.readFileSync('.local/small-games-family/clone/before-reinstall.json'));
  assert.ok(receipt.files?.['clone/settings.ini']?.bytes > 0, 'Historical generated native path evidence missing');
  const output = 'artifacts/game-parity-20261029/clonehero-wave4-profile.json';
  fs.writeFileSync(output, JSON.stringify(staged, null, 2) + '\n');
  assert.ok(fs.readFileSync('internal/panel/game_library/overrides.json').equals(source));
  console.log(JSON.stringify({output, controls: staged[recipe].egg.variables.length, canonicalChanged: false, nativeAcceptance: false}));
}
