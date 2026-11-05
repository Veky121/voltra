import fs from 'node:fs';
const recipe='tower_unite/egg-tower-unite.json';
const profile=structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe]);
const sources=['tower-native.py','vr-tower-ohd.py','ark-family.py','native-config.py','native-console.py','steam-template.py','bundle-debian-python.py'];
let script='#!/bin/bash\nset -euo pipefail\ncd /mnt/server\nmkdir -p .voltra\n';
for(const name of sources)script+=`cat > .voltra/${name.replaceAll('-','_')} <<'VOLTRA_TOWER_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')}\nVOLTRA_TOWER_SOURCE\n`;
// Python must already be available for mutation-free prerequisite validation.
script+='python3 .voltra/tower_native.py validate\nexport DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\npython3 .voltra/bundle_debian_python.py\npython3 .voltra/tower_native.py install\n';
profile.egg.scripts.installation.script=script;
profile.egg.startup='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/tower_native.py run';
profile.revision='tower-native-authority-v2';profile.verification='not_verified';
profile.detail='Staged Tower-only native authority, AUTO_UPDATE and full operator-state retention; offline tests only. Python preflight prerequisite and native acceptance remain unresolved.';
fs.mkdirSync('artifacts/game-parity-20261029/tower-unite-owner',{recursive:true});
fs.writeFileSync('artifacts/game-parity-20261029/tower-unite-owner/profile-proposal.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
