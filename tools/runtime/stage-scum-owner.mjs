import fs from 'node:fs';
const recipe='scum/egg-scum.json', base='artifacts/game-parity-20261029/scum-owner';
const source=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
const profile=structuredClone(source);
profile.revision='scum-native-authority-v3';
profile.egg.startup=profile.egg.startup.replace('zombie-native.py run scum','scum-native.py run');
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\n';
// The existing Debian installer needs its interpreter before Python validation.
// Bootstrap tooling first; validation still precedes game acquisition and any
// server-volume helper/config publication.
script+='apt-get update\napt-get install -y --no-install-recommends python3 ca-certificates\n';
script+='work=$(mktemp -d)\ntrap \'rm -rf -- "$work"\' EXIT\n';
for(const name of ['scum-native.py','zombie-native.py','melee-native.py','arma-native.py','native-config.py','native-console.py','steam-template.py','source-install.py','bundle-debian-python.py']) {
 const emitted=name==='steam-template.py'?'steam_template.py':name;
 script+=`cat > "$work/${emitted}" <<'VOLTRA_SCUM_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')}\nVOLTRA_SCUM_SOURCE\n`;
}
script+='python3 "$work/scum-native.py" preflight\napt-get install -y --no-install-recommends lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\ncp "$work/"*.py .voltra/\npython3 .voltra/bundle-debian-python.py\npython3 .voltra/scum-native.py install\n';
profile.egg.scripts.installation.script=script;
profile.detail='Source-only SCUM native-authority adapter; runtime, network and publisher dependencies remain unverified.';
profile.setup_steps=[...profile.setup_steps,'SCUM v3 seeds ServerSettings.ini only if absent. Existing native files are authoritative. MaxPlayers remains an explicit original startup override. AUTO_UPDATE uses the shared typed updater after full preflight. The Debian installer bootstraps Python and CA tooling first, then validates before native-library setup, server-volume publication or game acquisition. Native package availability remains unverified.'];
fs.mkdirSync(base,{recursive:true});fs.writeFileSync(base+'/profile.pending.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
