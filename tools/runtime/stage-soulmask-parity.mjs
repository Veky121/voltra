import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
const key='soulmask/egg-soulmask.json';
// Read the historical source proposal without running its three-game stager.
const profile=structuredClone(JSON.parse(fs.readFileSync('.local/frontier-servers/profiles.json'))[key]);
const original=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===key);
assert.equal(profile.upstream_sha256,original.sha256);
assert.deepEqual(profile.egg.variables.slice(0,original.egg.variables.length),original.egg.variables);
profile.revision='soulmask-parity-20261029-v1';
profile.verification='not_verified';
profile.egg.variables.push({name:'Native gameplay settings authority',env_variable:'SOULMASK_SETTINGS_AUTHORITY',default_value:'startup',rules:'required|in:startup,file',user_viewable:true,user_editable:true,field_type:'text',description:'Startup preserves original character-transfer control behavior. File seeds a missing GameXishu.json, then preserves existing native gameplay settings exactly. Startup transfer control is a seed only in file mode.'});
profile.egg.startup='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/soulmask-parity.py run';
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
for(const file of ['soulmask-parity.py','frontier-native.py','melee-native.py','native-config.py','native-console.py','steam-template.py','source-install.py','bundle-debian-python.py']){
 const source=fs.readFileSync('internal/panel/game_library/scripts/'+file,'utf8');
 assert.ok(!source.split('\n').includes('VOLTRA_SOULMASK_SOURCE'));
 script+=`cat > .voltra/${file==='steam-template.py'?'steam_template.py':file} <<'VOLTRA_SOULMASK_SOURCE'\n${source}\nVOLTRA_SOULMASK_SOURCE\n`;
}
script+='python3 .voltra/bundle-debian-python.py\npython3 .voltra/soulmask-parity.py install\n';
profile.egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script};
profile.setup_steps.push('Original AUTO_UPDATE is normalized when the shared runtime flag is absent. Optional file authority seeds a missing native gameplay document and preserves existing bytes. Non-finite JSON is rejected before acquisition or publication. All five native gates remain unverified.');
const output=process.argv[2] || 'artifacts/game-parity-20261029/soulmask-profile.json';
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify({[key]:profile},null,2)+'\n');
console.log('Staged only Soulmask; original ordered variable rows preserved.');
