import fs from 'node:fs';
const recipe='truck-simulator/american-truck-simulator/egg-american-truck-simulator-dedicated-server.json';
const profile=structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe]);
if(!profile)throw Error('Missing original ATS profile');
const base='internal/panel/game_library/scripts/';
const helper=fs.readFileSync(base+'ats-native.py','utf8').replace(/^\uFEFF/,'');
let script='#!/bin/bash\nset -euo pipefail\ncd /mnt/server\npython3 - preflight <<\'ATS_PREFLIGHT\'\n'+helper+'\nATS_PREFLIGHT\n';
script+='export DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y --no-install-recommends ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
for(const name of ['ats-native.py','truck-trackmania-native.py','native-config.py','native-release.py','native-console.py','steam-template.py','source-install.py','bundle-debian-python.py']){
 const emitted=name==='steam-template.py'?'steam_template.py':name;
 script+=`cat > .voltra/${emitted} <<'ATS_SOURCE'\n${fs.readFileSync(base+name,'utf8').replace(/^\uFEFF/,'')}\nATS_SOURCE\n`;
}
script+='python3 .voltra/bundle-debian-python.py\npython3 .voltra/ats-native.py install\n';
profile.revision='ats-native-file-authority-v2';profile.verification='not_verified';
profile.egg.startup=profile.egg.startup.replace('truck-trackmania-native.py run ats','ats-native.py run');
profile.egg.scripts.installation={container:'python:3.13-slim-bookworm',entrypoint:'bash',script};
profile.detail='Source-only ATS prerequisite gate and seed-once native authority; integration/native acceptance pending.';
profile.setup_steps=[...profile.setup_steps,'Before installation, upload your own matching server_packages.sii and server_packages.dat under .local/share/American Truck Simulator. Existing server_config.sii owns lobby/token/gameplay settings; creation variables seed only a missing file. Allocation ports remain managed. No package contents or ready session are inferred from preflight.'];
const out='artifacts/game-parity-20261029/ats-owner';fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/profile-fragment.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
console.log('Staged exact ATS fragment only');
