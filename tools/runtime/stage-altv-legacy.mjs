import fs from 'node:fs';
import crypto from 'node:crypto';

const recipe = 'gta/altv/egg-alt--v.json';
const catalog = JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const entry = catalog.entries.find(e => e.path === recipe);
if (!entry) throw Error('Exact alt:V catalog row missing');
const egg = structuredClone(entry.egg);
// Preserve every original control, default, permission, image and startup string.
// Refuse before apt, directory creation, archive lookup or config writes.
egg.scripts.installation.script = '#!/bin/bash\nset -eu\nprintf "%s\\n" "alt:V has shut down. New installation and acquisition are disabled. Preserve operator resources and plan migration. No mirror is selected." >&2\nexit 78\n';
const inspector = fs.readFileSync('tools/runtime/altv-legacy-inspect.py', 'utf8');
const profile = {upstream_sha256: entry.sha256, revision: 'altv-shutdown-refusal-v2',
  verification: 'not_verified', egg, detail: 'Retired legacy catalog entry; no current supported download or native acceptance.',
  setup_steps: ['alt:V official homepage reports shutdown. New installation is disabled. Existing files are retained; no licence consent or replacement binary is inferred.'],
  legacy_boundary: {support: 'shutdown', acquisition: 'disabled', native_acceptance: false,
    read_only_inspector: {path: 'altv-legacy-inspect.py', sha256: crypto.createHash('sha256').update(inspector).digest('hex')}}};
const out = 'artifacts/game-parity-20261029/altv-owner';
fs.mkdirSync(out, {recursive: true});
fs.writeFileSync(`${out}/profiles.fragment.json`, JSON.stringify({[recipe]: profile}, null, 2) + '\n');
fs.writeFileSync(`${out}/altv-legacy-inspect.py`, inspector);
console.log('Staged exact alt:V legacy fragment and current inspector; canonical profiles untouched.');
