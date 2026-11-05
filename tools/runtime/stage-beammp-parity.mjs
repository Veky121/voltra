import fs from 'node:fs';
import crypto from 'node:crypto';
const output=process.argv[2] || 'artifacts/game-parity-20261029/resume-wave4-beammp';
const hashes={};
const path='beamng/beammp/egg-beam-m-p-server.json';
const profile=structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[path]);
profile.revision='beammp-native-v3';profile.verification='not_verified';profile.detail='BeamMP-only file-authoritative adapter; fixture validation only, all native gates pending.';
const egg=profile.egg;
egg.startup=egg.startup.replace('.voltra/racing-native.py run beammp','.voltra/beammp-native.py run');
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates\nmkdir -p .voltra\n';
for(const name of ['beammp-native.py','racing-native.py','native-release.py','native-config.py','native-console.py','steam-template.py','bundle-debian-python.py']){
 hashes[name]=crypto.createHash('sha256').update(fs.readFileSync('internal/panel/game_library/scripts/'+name)).digest('hex');
 const dest=name==='steam-template.py'?'steam_template.py':name;
 script+=`cat > .voltra/${dest} <<'VOLTRA_BEAMMP_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')}\nVOLTRA_BEAMMP_SOURCE\n`;
}
script+=`mkdir -p .voltra/beammp\ncat > .voltra/beammp/LICENSE <<'VOLTRA_BEAMMP_LICENSE'\n${fs.readFileSync('internal/panel/game_library/licenses/beammp-AGPL-3.0.txt','utf8')}\nVOLTRA_BEAMMP_LICENSE\npython3 .voltra/bundle-debian-python.py\npython3 .voltra/beammp-native.py install\n`;
egg.scripts.installation.script=script;
for(const v of egg.variables){
 if(['PRIVATE','LOGCHAT'].includes(v.env_variable)){v.field_type='switch';v.rules='required|boolean';}
 if(v.env_variable==='AUTHKEY')v.field_type='password';
 if(v.env_variable==='VERSION'){v.rules='required|in:v3.9.3';v.description='Reviewed and digest-pinned publisher v3.9.3. Other releases require a separately reviewed profile.';}
}
for(const [name,key,value,boolean] of [['Tags','TAGS','Freeroam',false],['Allow guests','ALLOW_GUESTS','true',true],['Unauthenticated server information','INFORMATION_PACKET','false',true],['Debug logging','DEBUG','false',true],['Resource folder','RESOURCE_FOLDER','Resources',false]]){
 if(!egg.variables.some(v=>v.env_variable===key)) egg.variables.push({name,env_variable:key,default_value:value,user_viewable:true,user_editable:true,description:'Initial setup value. After first start, edit ServerConfig.toml through native game settings.',rules:boolean?'required|boolean':'required|string|max:1024',field_type:boolean?'switch':'text'});
}
profile.setup_steps[2]='Both TCP and UDP use the allocation. Creation controls seed missing General keys only; existing native file values win thereafter. Edit ServerConfig.toml through Game settings. The provider environment prevents publisher config rewriting, preserving comments, unknown settings and operator files. Port always follows the allocation.';
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(output+'/beammp-profile.json',JSON.stringify({[path]:profile},null,2)+'\n');
fs.writeFileSync(output+'/helper-hashes.json',JSON.stringify(hashes,null,2)+'\n');
console.log('Staged BeamMP only in '+output+'; global overrides untouched.');
