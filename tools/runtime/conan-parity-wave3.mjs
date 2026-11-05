// Root reviews and merges this metadata-only fragment. Never touches canonical overrides.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

export const variants = {
  'conan_exiles/egg-conan-exiles.json': 'WindowsServer',
  'conan_exiles/egg-conan-exiles-enhanced.json': 'LinuxServer',
};

export function stageProfiles(overrides, catalog) {
  const profiles = {};
  for (const [recipe, platform] of Object.entries(variants)) {
    const current = overrides[recipe];
    const upstream = catalog.entries.find(entry => entry.path === recipe);
    assert(current && upstream, 'Missing Conan recipe');
    assert.equal(current.upstream_sha256, upstream.sha256, 'Stale Conan upstream digest');
    const profile = structuredClone(current);
    const prefix = `/ConanSandbox/Saved/Config/${platform}/`;
    profile.settings_documents = {...profile.settings_documents,
      [prefix + 'ServerSettings.ini']: 'ini',
      [prefix + 'Engine.ini']: 'ini',
      [prefix + 'Game.ini']: 'ini',
    };
    assert.deepEqual(profile.egg, current.egg, 'Metadata changed installer or ordered controls');
    assert.equal(profile.verification, current.verification);
    profiles[recipe] = profile;
  }
  return profiles;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const overrides = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
  const catalog = JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
  const profiles = stageProfiles(overrides, catalog);
  const output = 'artifacts/game-parity-20261029/conan-wave3-profile.json';
  fs.writeFileSync(output, JSON.stringify(profiles, null, 2) + '\n');
  console.log(JSON.stringify({output, changes: Object.entries(profiles).map(([recipe, profile]) => ({
    recipe, settings_documents: profile.settings_documents, controls: profile.egg.variables.length,
  })), runtimeChanged: false}));
}
