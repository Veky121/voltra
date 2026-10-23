import {spawnSync} from 'node:child_process';import path from 'node:path';
const r=spawnSync('docker',['run','--rm','--network','none','--cap-drop','ALL','--mount',`type=bind,source=${path.resolve('.')},target=/repo,readonly`,'python:3.13-slim','python3','-B','/repo/tools/runtime/test-id-family.py'],{stdio:'inherit',windowsHide:true});process.exitCode=r.status??1;
