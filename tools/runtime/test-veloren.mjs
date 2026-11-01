// Source-only fixtures run locally. Runtime/Linux ownership checks belong to
// the separately admitted Windows Docker campaign; never default to SSH.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export function runVelorenSourceFixtures(){
 const script='RUNTIME_SOURCE='+JSON.stringify(fs.readFileSync('internal/panel/game_library/scripts/veloren-runtime.py','utf8'))+'\nINSTALL_SOURCE='+JSON.stringify(fs.readFileSync('internal/panel/game_library/scripts/veloren-install.py','utf8'))+'\n'+fs.readFileSync('tools/runtime/test-veloren.py','utf8');
 return spawnSync(process.platform==='win32'?'python':'python3',['-B','-'],{input:script,encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'},windowsHide:true,timeout:30000,maxBuffer:2*1024**2});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=runVelorenSourceFixtures();process.stdout.write((result.stdout||'')+(result.stderr||''));if(result.error)throw result.error;process.exitCode=result.status??1;
}
