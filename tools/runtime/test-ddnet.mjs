import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const base='internal/panel/game_library/scripts/';
const script=[['NATIVE_SOURCE','native-release.py'],['INSTALL_SOURCE','ddnet-install.py'],['RUNTIME_SOURCE','ddnet-runtime.py']].map(([key,name])=>key+'='+JSON.stringify(fs.readFileSync(base+name,'utf8'))).join('\n')+'\n'+fs.readFileSync('tools/runtime/test-ddnet.py','utf8');
const r=spawnSync('ssh',['-o','BatchMode=yes','home-server-ai','python3 -'],{input:script,encoding:'utf8'});console.log(r.stdout+r.stderr);process.exitCode=r.status??1;
