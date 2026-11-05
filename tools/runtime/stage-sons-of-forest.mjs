import fs from 'node:fs';
const out='artifacts/game-parity-20261029/sons-of-forest-owner';fs.mkdirSync(out,{recursive:true});
const recipe='sonsoftheforest/egg-sons-of-the-forest.json';
const profile=structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe]);
if(!profile)throw Error('Missing canonical profile');
const names=['sons-of-forest.py','forest-survival.py','forest-survival-pins.json','private-wine-prerequisites.py','steam-native-next.py','steam-template.py','native-config.py','native-release.py','native-console.py'];
profile.revision='sons-native-authority-source-v2';profile.verification='not_verified';
profile.egg.startup='exec python3 .voltra/sons-of-forest.py run';
profile.egg.config.files='{}';
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\ncd /mnt/server\nmkdir -p .voltra\n';
for(const name of names){const emitted=name==='steam-template.py'?'steam_template.py':name;script+=`cat > .voltra/${emitted} <<'VOLTRA_SONS_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8').replace(/^\uFEFF/,'').replaceAll('\r\n','\n')}\nVOLTRA_SONS_SOURCE\n`;}
script+='python3 .voltra/sons-of-forest.py install\n';
profile.egg.scripts.installation.script=script;
profile.detail='Source-only Sons adapter. Native config seeded once; only allocation ports/IP override file. Existing startup controls remain ordered with canonical defaults/permissions and become initial seeds for gameplay/access. Later edits use native Game settings. Shared parser eligibility integration pending. No native acceptance.';
profile.setup_steps.push('Accept Windows runtime licenses before acquisition. Existing dedicatedserver.cfg owns gameplay/access after initial seed; original startup controls are seeds only. Allocations own the three UDP ports. Native settings UI eligibility must be integrated by root before exposing writable controls.');
fs.writeFileSync(out+'/profile-fragment.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
