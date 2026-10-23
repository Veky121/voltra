import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const script='RUNTIME_SOURCE='+JSON.stringify(fs.readFileSync('internal/panel/game_library/scripts/veloren-runtime.py','utf8'))+'\nINSTALL_SOURCE='+JSON.stringify(fs.readFileSync('internal/panel/game_library/scripts/veloren-install.py','utf8'))+'\n'+fs.readFileSync('tools/runtime/test-veloren.py','utf8');
const r=spawnSync('ssh',['-o','BatchMode=yes','home-server-ai','python3 -'],{input:script,encoding:'utf8'});console.log(r.stdout+r.stderr);process.exitCode=r.status??1;
