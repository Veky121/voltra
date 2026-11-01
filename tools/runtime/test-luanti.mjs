// Pure Python fixtures run locally; game acquisition and runtime are separate.
import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const encode=JSON.stringify;
const script='RUNTIME_SOURCE='+encode(fs.readFileSync('internal/panel/game_library/scripts/luanti-runtime.py','utf8'))+'\nINSTALL_SOURCE='+encode(fs.readFileSync('internal/panel/game_library/scripts/luanti-game-install.py','utf8'))+'\nPATCH_SOURCE='+encode(fs.readFileSync('internal/panel/game_library/scripts/luanti-patch-console.py','utf8'))+'\n'+fs.readFileSync('tools/runtime/test-luanti.py','utf8');
const result=spawnSync(process.platform==='win32'?'python':'python3',['-B','-'],{input:script,encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'},windowsHide:true,timeout:30000,maxBuffer:2*1024**2});
process.stdout.write((result.stdout||'')+(result.stderr||''));if(result.error)throw result.error;process.exitCode=result.status??1;
