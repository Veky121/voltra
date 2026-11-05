import fs from 'node:fs';
const recipe='rdr/redm/egg-red-m.json';
const entry=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===recipe);
const prior=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
if(!entry || !prior) throw Error('Missing exact RedM source profile');
const profile=structuredClone(prior);
profile.revision='redm-owner-next-native-authority-v1';
profile.verification='not_verified';
profile.detail='Source-only native authority and pre-acquisition validation; no activation/native acceptance.';
profile.egg.variables=structuredClone(entry.egg.variables);
for(const v of prior.egg.variables) if(!entry.egg.variables.some(x=>x.env_variable===v.env_variable)) profile.egg.variables.push(structuredClone(v));
profile.egg.startup=prior.egg.startup.replace(' .voltra/fivem-runtime.py',' .voltra/redm-owner-next.py');
profile.egg.config.files='{}';
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates\nmkdir -p .voltra\n';
const helpers=['fivem-cfg.py','fivem-install.py','fivem-runtime.py','gta-install.py','gta-runtime.py','native-release.py','native-config.py','native-console.py','bundle-debian-python.py','redm-owner-next.py'];
for(const name of helpers) script+=`cat > .voltra/${name} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8').replaceAll('\r\n','\n')}\nVOLTRA_SOURCE\n`;
script+=`cat > .voltra/steam_template.py <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/steam-template.py','utf8')}\nVOLTRA_SOURCE\npython3 .voltra/redm-owner-next.py install 2>&1 | tee .voltra/fivem-install.log\npython3 .voltra/bundle-debian-python.py\n`;
profile.egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
profile.setup_steps=[
'Original ordered RedM variables, defaults and permissions retained exactly. CFX_VERSION=latest needs an explicitly reviewed FIVEM_RELEASE_SHA256; unknown versions never silently substitute.',
'Provide your own real Cfx key and review publisher terms. Existing server.cfg is authoritative for hostname, player limit, LAN mode, license and Steam key. Allocation owns endpoints; game is rdr3. Ambiguous exec/vstr/duplicate managed keys refuse unchanged to Files.',
'Existing 2 GB memory and 8 GB disk defaults remain provisional, without a verified publisher server capacity recommendation. Client requirements are not server recommendations.',
'Native stdout/stdin and quit reuse existing transport. Native readiness, logs, lifecycle, reinstall and player acceptance remain unverified. No activation authorized.'
];
const out='artifacts/game-parity-20261029/redm-owner-next/profile.json';
fs.mkdirSync('artifacts/game-parity-20261029/redm-owner-next',{recursive:true});
fs.writeFileSync(out,JSON.stringify({[recipe]:profile},null,2)+'\n');
console.log(out);
