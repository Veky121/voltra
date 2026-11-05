// Stage discovery hints only. No panel, Docker, downloads or canonical writes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const recipe = 'abiotic_factor/egg-abiotic-factor.json';
const target = 'artifacts/game-parity-20261029/abiotic-wave2-profile.json';
const source = fs.readFileSync('internal/panel/game_library/overrides.json');
const profile = JSON.parse(source)[recipe];
assert.ok(profile?.egg?.startup.endsWith('unreal_survival_runtime.py abiotic'));
const files = [
  '/AbioticFactor/Saved/Config/WindowsServer/GameUserSettings.ini',
  '/AbioticFactor/Saved/Config/WindowsServer/Settings.ini',
];
// A retained historical file manifest establishes exact native paths. This is
// discovery evidence only; neither file contents nor native acceptance are read.
const receiptPath = '.local/abiotic-native/before-retention-reinstall.json';
const receipt = JSON.parse(fs.readFileSync(receiptPath));
for (const file of files) {
  const metadata = receipt.files?.[file.slice(1)];
  assert.ok(metadata && Number.isInteger(metadata.bytes) && /^[a-f0-9]{64}$/.test(metadata.sha256));
}
const staged = structuredClone(profile);
staged.settings_documents = { ...staged.settings_documents, ...Object.fromEntries(files.map(file => [file, 'ini'])) };
const unchanged = structuredClone(staged);
if (profile.settings_documents === undefined) delete unchanged.settings_documents;
else unchanged.settings_documents = profile.settings_documents;
assert.deepEqual(unchanged, profile, 'Only discovery hints may change');
assert.ok(fs.readFileSync('internal/panel/game_library/overrides.json').equals(source), 'Canonical source changed during staging');
fs.writeFileSync(target, JSON.stringify({ [recipe]: staged }, null, 2) + '\n');
console.log(JSON.stringify({ recipe, target, documents: files, metadata_only: true,
  canonical_sha256: createHash('sha256').update(source).digest('hex'),
  path_receipt: receiptPath, native_acceptance: false }, null, 2));
