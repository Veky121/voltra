import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const dir='.local/game-parity-20261029/openra-wave8';fs.mkdirSync(dir,{recursive:true});
const result=spawnSync(process.platform==='win32'?'python':'python3',['-B','tools/runtime/openra-parity-wave8-tests.py'],{encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'},windowsHide:true,timeout:30000,maxBuffer:2*1024**2});
const log=(result.stdout||'')+(result.stderr||'');process.stdout.write(log);fs.writeFileSync(dir+'/source-tests.log',log);
if(result.error)throw result.error;
fs.writeFileSync('artifacts/game-parity-20261029/openra-wave8-source-tests.json',JSON.stringify({at:new Date().toISOString(),recipe:'openra/openra_red_alert/egg-open-r-a.json',boundary:'Local Windows Python source fixtures only; no Docker, acquisition or native game process',test_count:Number(/Ran (\d+) tests?/.exec(log)?.[1]||0),exit_code:result.status,log:dir+'/source-tests.log'},null,2)+'\n');
process.exitCode=result.status??1;
