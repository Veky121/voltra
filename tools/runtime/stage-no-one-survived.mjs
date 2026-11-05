import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const recipe='no_one_survived/egg-no-one-survived.json';
export function stage(current, body){
 const profile=structuredClone(current[recipe]);
 if(!profile?.egg)throw Error('Exact current No One Survived profile required');
 const install=profile.egg.scripts.installation;
 const invocation='python3 .voltra/wasteland-servers.py install noone';
 if(install.script.split(invocation).length!==2)throw Error('Unique original install invocation required');
 const marker='VOLTRA_NOONE_PREFLIGHT_SOURCE';
 if(body.includes(marker))throw Error('Unsafe heredoc body');
 install.script=install.script.replace(invocation,`cat > .voltra/no-one-survived.py <<'${marker}'\n${body.replaceAll('\r\n','\n')}\n${marker}\npython3 .voltra/no-one-survived.py install`);
 if(profile.egg.startup!=='exec python3 .voltra/wasteland-servers.py run noone')throw Error('Unexpected startup; review required');
 profile.egg.startup='exec python3 .voltra/no-one-survived.py run';
 return {[recipe]:profile};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const fragment=stage(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json','utf8')),fs.readFileSync('internal/panel/game_library/scripts/no-one-survived.py','utf8').replace(/^\uFEFF/,''));
 fs.mkdirSync('artifacts/game-parity-20261029/noone-resume',{recursive:true});
 fs.writeFileSync('artifacts/game-parity-20261029/noone-resume/profile.pending.json',JSON.stringify(fragment,null,2)+'\n');
}
