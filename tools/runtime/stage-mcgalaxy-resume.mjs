import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const recipe='classicube/mcgalaxy/egg-classi-cube--m-g-c.json';
const p=structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe]);
assert(p?.egg);
const original=structuredClone(p), file='properties/server.properties';
const rules=JSON.parse(p.egg.config.files);
assert(rules[file]);
// Native settings own gameplay values after the first installation. Wings owns the allocation.
rules[file].find={port:'{{server.build.default.port}}'};
p.egg.config.files=JSON.stringify(rules);
p.settings_documents=[file];
const marker='python3 .voltra/minecraft_special_install.py mcgalaxy';
assert.equal(p.egg.scripts.installation.script.split(marker).length,2);
const seed=fs.readFileSync('internal/panel/game_library/scripts/mcgalaxy-seed.py','utf8');
p.egg.scripts.installation.script=p.egg.scripts.installation.script.replace(marker,
 `cat > .voltra/mcgalaxy_seed.py <<'VOLTRA_MCGALAXY_SEED'\n${seed}\nVOLTRA_MCGALAXY_SEED\npython3 .voltra/mcgalaxy_seed.py\n${marker}`);
p.revision='mcgalaxy-native-authority-v2';
p.verification='not_verified';
p.detail='Candidate native authority correction; resume acceptance blocked by campaign physical headroom.';
p.setup_steps.push('Name, MOTD and public listing seed missing native settings once. Later edits belong to Game settings. The allocated TCP port remains managed.');
for(const key of ['variables','docker_images','startup'])assert.deepEqual(p.egg[key],original.egg[key]);
const dir='artifacts/game-parity-20261029/mcgalaxy-resume';fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(dir+'/profile.pending.json',JSON.stringify({[recipe]:p},null,2)+'\n');
fs.writeFileSync(dir+'/stage.json',JSON.stringify({recipe,baseline_sha256:crypto.createHash('sha256').update(JSON.stringify(original)).digest('hex'),controls_unchanged:true,canonical_modified:false,managed_port_only:true},null,2)+'\n');
