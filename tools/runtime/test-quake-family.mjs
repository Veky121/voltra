import {spawnSync} from 'node:child_process';import path from 'node:path';
const r=spawnSync('docker',['run','--rm','--network','none','--mount',`type=bind,source=${path.resolve('.')},target=/workspace,readonly`,'-w','/workspace','python:3.13-slim','python3','-B','tools/runtime/test-quake-family.py'],{stdio:'inherit',windowsHide:true});process.exitCode=r.status??1;
