import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const base='internal/panel/game_library/scripts/';
const script=[['NATIVE_SOURCE','native-release.py'],['ZIP_SOURCE','native-zip-release.py'],['INSTALL_SOURCE','xonotic-install.py'],['RUNTIME_SOURCE','xonotic-runtime.py']].map(([key,name])=>key+'='+JSON.stringify(fs.readFileSync(base+name,'utf8'))).join('\n')+'\n'+fs.readFileSync('tools/runtime/test-xonotic.py','utf8');
const result=spawnSync('ssh',['-o','BatchMode=yes','home-server-ai','python3 -'],{input:script,encoding:'utf8'});
console.log(result.stdout+result.stderr);process.exitCode=result.status??1;
