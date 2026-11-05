import fs from 'node:fs';
const key='mount_blade_II_bannerlord/egg-mount--blade-i-i--bannerlord.json';
const profile=structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[key]);
if(!profile)throw Error('Missing existing Bannerlord profile');
const base='internal/panel/game_library/scripts/';
const sources=['bannerlord-native.py','melee-native.py','native-config.py','native-console.py','steam-template.py','source-install.py','bundle-debian-python.py'];
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
for(const name of sources)script+=`cat > .voltra/${name==='steam-template.py'?'steam_template.py':name} <<'VOLTRA_BANNERLORD_SOURCE'\n${fs.readFileSync(base+name,'utf8')}\nVOLTRA_BANNERLORD_SOURCE\n`;
script+='python3 .voltra/bundle-debian-python.py\npython3 .voltra/bannerlord-native.py install\n';
profile.egg.scripts.installation.script=script;
profile.egg.startup=profile.egg.startup.replace('.voltra/melee-native.py run bannerlord','.voltra/bannerlord-native.py run');
// Preserve integration-owned resource policy, including operator-facing defaults.
profile.revision='bannerlord-prerequisite-v2';
profile.verification='not_verified';
profile.detail='Source-only prerequisite gate; no served integration or native acceptance. Requires legitimate pre-staged module/config/scene prerequisites before acquisition.';
const dir='artifacts/bannerlord-deferred-review';
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(dir+'/profile.pending.json',JSON.stringify({[key]:profile},null,2)+'\n');
console.log('Staged exact Bannerlord fragment with current helper embeds.');
