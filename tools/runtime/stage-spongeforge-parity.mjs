import fs from 'node:fs';
import assert from 'node:assert/strict';
const recipe='minecraft/java/spongeforge/egg-sponge-forge.json';
const profile=structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe]);
const boundary="python3 .voltra/java_fork_install.py 'spongeforge'";
assert.equal(profile.egg.scripts.installation.script.split(boundary).length,2);
profile.egg.scripts.installation.script=profile.egg.scripts.installation.script.replace(boundary,
 "cat > .voltra/spongeforge_install.py <<'VOLTRA_SPONGEFORGE_SCOPED'\n"+fs.readFileSync('internal/panel/game_library/scripts/spongeforge-install.py','utf8')+"\nVOLTRA_SPONGEFORGE_SCOPED\npython3 .voltra/spongeforge_install.py");
profile.revision='spongeforge-exact-loader-source-v1';
profile.verification='not_verified';
profile.detail='Exact legacy Forge build mapping and pre-acquisition validation; scoped offline evidence only. Native and panel activation remain blocked.';
fs.mkdirSync('artifacts/game-parity-20261029/spongeforge-owner',{recursive:true});
fs.writeFileSync('artifacts/game-parity-20261029/spongeforge-owner/profile.pending.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
