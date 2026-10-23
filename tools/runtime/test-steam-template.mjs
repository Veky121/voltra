import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const script='STEAM_SOURCE='+JSON.stringify(fs.readFileSync('internal/panel/game_library/scripts/steam-template.py','utf8'))+'\n'+fs.readFileSync('tools/runtime/test-steam-template.py','utf8');
const result=spawnSync('ssh',['-o','BatchMode=yes','home-server-ai','python3 -'],{windowsHide:true,input:script,encoding:'utf8'});
console.log(result.stdout+result.stderr);process.exitCode=result.status??1;
