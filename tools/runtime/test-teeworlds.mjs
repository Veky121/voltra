import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const base='internal/panel/game_library/scripts/';
const script=[['RUNTIME_SOURCE','teeworlds-runtime.py'],['INSTALL_SOURCE','teeworlds-install.py'],['ADAPTER_SOURCE','teeworlds-console.cpp.inc']].map(([key,name])=>key+'='+JSON.stringify(fs.readFileSync(base+name,'utf8'))).join('\n')+'\n'+fs.readFileSync('tools/runtime/test-teeworlds.py','utf8');
const r=spawnSync(process.platform==='win32'?'python':'python3',['-B','-'],{input:script,encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'},windowsHide:true,timeout:30000,maxBuffer:2*1024**2});
process.stdout.write((r.stdout||'')+(r.stderr||''));if(r.error)throw r.error;process.exitCode=r.status??1;
