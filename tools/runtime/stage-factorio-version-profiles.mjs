// Source-only proposal. Root integrates canonical overrides after review.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const sourcePath = 'internal/panel/game_library/scripts/factorio-install.py';
const source = fs.readFileSync(sourcePath, 'utf8');
const keys = ['factorio/factorio/egg-factorio.json', 'factorio/factorio-modupdate/egg-factorio-modupdate.json', 'factorio/factorio/egg-factorio-a-r-m64.json'];
export function stageProfiles(originals, installerSource = source) {
const profiles = {};
for (const key of keys) {
  const profile = structuredClone(originals[key]);
  const arm = key.endsWith('egg-factorio-a-r-m64.json');
  let script = profile.egg.scripts.installation.script;
  const pinGuard = /^case "\$FACTORIO_VERSION" in 2\.0\.77\).*\n/m;
  const embedded = /(cat > "\$stage\/factorio-install\.py" <<'FACTORIO_INSTALL_PY'\n)[\s\S]*?(\nFACTORIO_INSTALL_PY\n)/;
  if (!pinGuard.test(script) && !embedded.test(script)) throw Error(`Missing reviewed installer: ${key}`);
  script = script.replace(pinGuard, '');
  script = script.replace(/apk add --no-cache ([^\n]+)/, (_, packages) => `apk add --no-cache ${[...new Set([...packages.split(/\s+/), 'python3'])].join(' ')}`);
  const acquisition = /curl --fail --location --retry 3 --output "\$stage\/server\.tar\.xz"[\s\S]*?cp -a "\$stage\/factorio\/\." \/mnt\/server\//;
  if (embedded.test(script)) {
    script = script.replace(embedded, (_, start, end) => start + installerSource + end);
  } else {
  if (!acquisition.test(script)) throw Error(`Missing reviewed acquisition block: ${key}`);
  script = script.replace(acquisition, () => `cat > "$stage/factorio-install.py" <<'FACTORIO_INSTALL_PY'\n${installerSource}\nFACTORIO_INSTALL_PY
python3 "$stage/factorio-install.py" --root /mnt/server --version "$FACTORIO_VERSION" --architecture ${arm ? 'box64' : 'x64'}
FACTORIO_VERSION=$(python3 -c 'import json; print(json.load(open("/mnt/server/.voltra/factorio-installed.json"))["version"])')
export FACTORIO_VERSION`);
  }
  // Existing initialization needs the outer stage. Its settings/default logic and
  // the independently audited mod updater remain byte-for-byte intact.
  script = script.replace("echo 'Factorio 2.0.77 installed with verified downloads. Existing saves, mods and settings preserved.'",
    'echo "Factorio $FACTORIO_VERSION installed with verified downloads. Saves, mods and settings preserved; compatibility across versions requires your backups."');
  const runtimeAnchor = 'case "$SAVE_NAME" in';
  const guard = `installed=$(.voltra/jq -er '.version' .voltra/factorio-installed.json) || { echo 'Missing installed-version receipt. Reinstall this profile.'; exit 2; }
case "$FACTORIO_VERSION" in latest|stable|experimental) ;; "$installed") ;; *) echo 'Requested Factorio version differs from installed version. Back up saves/config and reinstall before starting.'; exit 2 ;; esac
base_version=$(.voltra/jq -er '.version' data/base/info.json)
[ "$installed" = "$base_version" ] || { echo 'Installed Factorio metadata differs from receipt. Reinstall before starting.'; exit 2; }
`;
  script = script.split(guard).join('');
  const index = script.indexOf(runtimeAnchor);
  if (index === -1) throw Error(`Missing reviewed launcher: ${key}`);
  script = script.slice(0, index) + guard + script.slice(index);
  profile.egg.scripts.installation.script = script;
  const variable = profile.egg.variables.find(v => v.env_variable === 'FACTORIO_VERSION');
  if (variable.default_value !== '2.0.77') throw Error(`Unexpected default version: ${key}`);
  variable.rules = String.raw`required|string|regex:/\A(?:latest|stable|experimental|(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,3}))\z/`;
  variable.description = 'Default 2.0.77. Choose a literal X.Y.Z, stable, latest (stable), or experimental. Installer requires an exact official headless checksum. Back up saves/config before changing versions; downgrades are refused. Clients need the same version/mods.';
  profile.revision = arm ? 'factorio-arm64-version-choice-v2' : key.includes('modupdate') ? 'factorio-modupdate-version-choice-v2' : 'factorio-version-choice-v2';
  const evidence = 'Prior verification applies only to the original pinned 2.0.77 recipe. Version-choice changes have source/offline-fixture verification only; no new game acquisition or cross-version runtime acceptance.';
  profile.detail = `${(profile.detail || '').split(evidence).join('').trim()} ${evidence}`.trim();
  profile.egg.description = profile.egg.description.replace('Factorio 2.0.77 headless', 'Factorio headless (default 2.0.77)');
  const setup = 'Back up saves, mods and config before a version change. The installer verifies an exact official archive, preserves mutable files, and refuses known downgrades. Cross-version save/config compatibility is not guaranteed.';
  profile.setup_steps = [setup, ...profile.setup_steps.filter(step => step !== setup)];
  profiles[key] = profile;
}
return profiles;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
const originals = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json', 'utf8'));
const profiles = stageProfiles(originals);
const output = '.local/factorio-version-choice';
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'profiles.json'), JSON.stringify(profiles, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'source-receipt.json'), JSON.stringify({
  kind: 'source-only-factorio-version-choice', canonical_modified: false,
  installer: { path: sourcePath, sha256: crypto.createHash('sha256').update(source).digest('hex') },
  profiles: keys, default_version: '2.0.77', runtime_acceptance: false,
}, null, 2) + '\n');
console.log(`Staged ${keys.length} Factorio profiles in ${output}; canonical overrides unchanged.`);
}
