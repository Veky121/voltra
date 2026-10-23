// Runs pure Python fixtures on the existing SSH host; creates no node/service/container.
import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const encode=JSON.stringify;
const script='RUNTIME_SOURCE='+encode(fs.readFileSync('internal/panel/game_library/scripts/luanti-runtime.py','utf8'))+'\nINSTALL_SOURCE='+encode(fs.readFileSync('internal/panel/game_library/scripts/luanti-game-install.py','utf8'))+'\nPATCH_SOURCE='+encode(fs.readFileSync('internal/panel/game_library/scripts/luanti-patch-console.py','utf8'))+'\n'+fs.readFileSync('tools/runtime/test-luanti.py','utf8');
const result=spawnSync('ssh',['-o','BatchMode=yes','home-server-ai','python3 -'],{input:script,encoding:'utf8'});
console.log(result.stdout+result.stderr);process.exitCode=result.status??1;
