import fs from 'node:fs';
const recipe='starbound/egg-starbound.json',base='internal/panel/game_library/scripts/';
const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
const profile=structuredClone(current);
profile.revision='starbound-owner-source-v2';
profile.egg.startup='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/starbound_runtime.py';
const names=['steam-template','native-config','native-console','bundle-debian-python','valheim-vrising-install','stationeers-wurm-starbound-install','starbound-runtime','starbound-install'];
let script=`#!/bin/bash
set -euo pipefail
# No current secure private Steam transport is accepted by steam_template.arguments.
# Refuse before apt, helper publication, download or server-volume writes.
echo 'Starbound requires entitlement; private Steam transport remains disabled pending shared verification.' >&2
exit 1
cd /mnt/server
export HOME=/mnt/server
apt-get update
apt-get install -y --no-install-recommends python3 curl ca-certificates lib32gcc-s1 lib32stdc++6
mkdir -p .voltra
`;
for(const name of names)script+=`cat > .voltra/${name.replaceAll('-','_')}.py <<'VOLTRA_SOURCE'\n${fs.readFileSync(base+name+'.py','utf8')}\nVOLTRA_SOURCE\n`;
script+='python3 .voltra/bundle_debian_python.py\npython3 .voltra/starbound_install.py\n';
profile.egg.scripts.installation.script=script;
profile.detail='Source candidate only. Entitled acquisition blocked by existing shared private Steam transport guard. Native config remains authoritative; shared signal supervisor; no new online marker.';
fs.mkdirSync('artifacts/game-parity-20261029/starbound-owner',{recursive:true});
fs.writeFileSync('artifacts/game-parity-20261029/starbound-owner/profiles.pending.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
console.log('Staged Starbound only; canonical controls and shared overrides unchanged.');
