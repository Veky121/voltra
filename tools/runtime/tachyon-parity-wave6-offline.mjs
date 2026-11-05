import fs from 'node:fs';import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {digest} from './campaign-native-20261029.mjs';
const docker=args=>{const r=spawnSync('docker',['--context','desktop-linux',...args],{encoding:'utf8',windowsHide:true});if(r.status!==0){const e=new Error('Offline fixture failed');e.stdout=r.stdout;e.stderr=r.stderr;throw e;}return r.stdout+r.stderr;};
const files=['tachyon-preflight.py','native-config.py','native-console.py','steam-template.py'].map(x=>'internal/panel/game_library/scripts/'+x),before=files.map(file=>({file,sha256:digest(fs.readFileSync(file))}));
const code="import pathlib,subprocess,sys,json; proof={p:pathlib.Path('/sys/fs/cgroup/'+p).read_text().strip() for p in ['memory.max','memory.swap.max','cpu.max']};assert proof=={'memory.max':'268435456','memory.swap.max':'0','cpu.max':'100000 100000'}; print(json.dumps(proof),flush=True);subprocess.run([sys.executable,'-B','tools/runtime/tachyon-parity-wave6-test.py'],check=True)";
let output='';try{output=docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--tmpfs','/tmp:rw,exec,size=64m','--mount',`type=bind,source=${path.resolve('.')},target=/work,readonly`,'-w','/work','-e','PYTHONDONTWRITEBYTECODE=1','python:3.12-slim','python3','-B','-c',code]);}catch(e){output=String(e.stdout||'')+String(e.stderr||'');fs.writeFileSync('artifacts/game-parity-20261029/tachyon-wave6-offline.log',output);throw e;}
for(const x of before)if(digest(fs.readFileSync(x.file))!==x.sha256)throw Error('Source drift');
fs.writeFileSync('artifacts/game-parity-20261029/tachyon-wave6-offline.log',output);
fs.writeFileSync('artifacts/game-parity-20261029/tachyon-wave6-offline.json',JSON.stringify({at:new Date().toISOString(),tests:6,network:'none',source:'readonly',memory_mib:256,swap_mib:0,cpu:1,source_hashes:before,native_game:false},null,2)+'\n');console.log(output);
