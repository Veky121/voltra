// Stage DayZ only. Root reviews after its active native source freeze.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const recipe = 'dayz/egg-dayz.json';
const bytes = fs.readFileSync('internal/panel/game_library/overrides.json');
const current = JSON.parse(bytes)[recipe];
const profile = structuredClone(current);
const wrapper = fs.readFileSync('internal/panel/game_library/scripts/dayz-preflight.py', 'utf8').replaceAll('\r\n', '\n');
const planning = fs.readFileSync('internal/panel/game_library/scripts/arma-native.py', 'utf8').replaceAll('\r\n', '\n');
assert(planning.includes('def plan_keys(') && planning.includes('def plan_lowercase_tree('));
const marker = /(cat > \.voltra\/arma-native\.py <<'VOLTRA_ZOMBIE_SOURCE'\n)[\s\S]*?(\nVOLTRA_ZOMBIE_SOURCE\n)/;
assert(marker.test(profile.egg.scripts.installation.script), 'Exact Arma helper embed missing');
assert(!planning.includes('\nVOLTRA_ZOMBIE_SOURCE\n'));
profile.egg.scripts.installation.script = profile.egg.scripts.installation.script.replace(marker, (_, start, end) => start + planning + end);
const anchor = 'python3 .voltra/bundle-debian-python.py\n';
assert.equal(profile.egg.scripts.installation.script.split(anchor).length, 2);
assert(!wrapper.includes('\nVOLTRA_DAYZ_PREFLIGHT\n'));
const wrapperBlock = /cat > \.voltra\/dayz_preflight\.py <<'VOLTRA_DAYZ_PREFLIGHT'\n[\s\S]*?\nVOLTRA_DAYZ_PREFLIGHT\n/;
const embedded = `cat > .voltra/dayz_preflight.py <<'VOLTRA_DAYZ_PREFLIGHT'\n${wrapper}\nVOLTRA_DAYZ_PREFLIGHT\n`;
if (wrapperBlock.test(profile.egg.scripts.installation.script)) {
  profile.egg.scripts.installation.script = profile.egg.scripts.installation.script.replace(wrapperBlock, () => embedded);
} else {
  profile.egg.scripts.installation.script = profile.egg.scripts.installation.script.replace(anchor, () => embedded + anchor);
}
assert(/\.voltra\/(?:zombie-native|dayz_preflight)\.py run dayz$/.test(profile.egg.startup));
profile.egg.startup = profile.egg.startup.replace('.voltra/zombie-native.py run dayz', '.voltra/dayz_preflight.py run dayz');
const restored = structuredClone(profile);
restored.egg.startup = current.egg.startup;
restored.egg.scripts.installation.script = current.egg.scripts.installation.script;
assert.deepEqual(restored, current, 'Unrelated profile metadata or ordered controls changed');
assert.deepEqual(profile.egg.variables, current.egg.variables);
const output = 'artifacts/game-parity-20261029/dayz-resume-profile.json';
fs.writeFileSync(output, JSON.stringify({[recipe]:profile}, null, 2) + '\n');
assert(fs.readFileSync('internal/panel/game_library/overrides.json').equals(bytes));
console.log(JSON.stringify({output, controls:profile.egg.variables.length, canonicalChanged:false, nativeAcceptance:false}));

const digest = value => createHash('sha256').update(value).digest('hex');
const embeds = [];
for (const match of profile.egg.scripts.installation.script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)) {
  const [, path, , body] = match;
  embeds.push({path, sha256:digest(body + '\n')});
  if (path === '.voltra/dayz_preflight.py') assert.equal(body.trimEnd(), wrapper.trimEnd());
}
fs.writeFileSync('artifacts/game-parity-20261029/dayz-resume-hashes.json', JSON.stringify({recipe, profile_sha256:digest(fs.readFileSync(output)), installer_sha256:digest(profile.egg.scripts.installation.script), source_wrapper_sha256:digest(fs.readFileSync('internal/panel/game_library/scripts/dayz-preflight.py')), controls:profile.egg.variables.length, embeds},null,2)+'\n');
