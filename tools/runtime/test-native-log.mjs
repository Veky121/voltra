import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const files=['internal/panel/game_library/scripts/native-log.py','tools/runtime/test-native-log.py','tools/runtime/test-native-log.mjs','internal/panel/game_library/scripts/steam-template.py'];
const result=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--cpus','1','--mount',`type=bind,source=${path.resolve('.')},target=/workspace,readonly`,'-w','/workspace','python:3.13-slim','python3','-B','tools/runtime/test-native-log.py'],{windowsHide:true,encoding:'utf8'});
fs.mkdirSync('.local/native-log-relay',{recursive:true});
fs.writeFileSync('.local/native-log-relay/tests.json',JSON.stringify({at:new Date().toISOString(),files:Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')])),exit:result.status,stdout:result.stdout,stderr:result.stderr,network:'none',memoryMiB:256,sourceMount:'readonly',image:'python:3.13-slim',nativeResources:false},null,2)+'\n');
console.log(result.stdout+result.stderr);process.exitCode=result.status??1;
