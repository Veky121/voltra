import fs from 'node:fs';
const out='artifacts/game-parity-20261029/forest-credentials-owner';fs.mkdirSync(out,{recursive:true});
const recipe='the_forest/egg-the-forest.json';
const profile=structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe]);
if(!profile)throw Error('Missing canonical profile');
const names=['forest-native.py','forest-survival.py','forest-survival-pins.json','private-wine-prerequisites.py','steam-native-next.py','steam-template.py','native-config.py','native-release.py','native-console.py'];
profile.revision='forest-native-config-credentials-source-v2';profile.verification='not_verified';
profile.egg.startup='exec python3 .voltra/forest-native.py run';
profile.egg.config.files='{}';
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\ncd /mnt/server\nmkdir -p .voltra\n';
for(const name of names){const emitted=name==='steam-template.py'?'steam_template.py':name;script+=`cat > .voltra/${emitted} <<'VOLTRA_FOREST_NATIVE_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8').replace(/^\uFEFF/,'').replaceAll('\r\n','\n')}\nVOLTRA_FOREST_NATIVE_SOURCE\n`;}
script+='python3 .voltra/forest-native.py install\n';
profile.egg.scripts.installation.script=script;
profile.detail='Forest source-only native authority adapter; allocations override ports, native gameplay/access seeded only when missing. No native acceptance.';
fs.writeFileSync(out+'/profile-fragment.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
