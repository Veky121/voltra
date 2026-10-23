import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const script='RUNTIME_SOURCE='+JSON.stringify(fs.readFileSync('internal/panel/game_library/scripts/vintage-story-runtime.py','utf8'))+'\nINSTALL_SOURCE='+JSON.stringify(fs.readFileSync('internal/panel/game_library/scripts/vintage-story-install.py','utf8'))+'\n'+fs.readFileSync('tools/runtime/test-vintage-story.py','utf8');
const result=spawnSync('ssh',['-o','BatchMode=yes','home-server-ai','python3 -'],{input:script,encoding:'utf8'});
console.log(result.stdout+result.stderr);process.exitCode=result.status??1;
