import path from 'node:path';
import {spawnSync} from 'node:child_process';
const result=spawnSync('docker',['run','--rm','--network','none','--read-only','--tmpfs','/tmp:rw,size=64m','--memory','256m','--cpus','1','--mount','type=bind,source='+path.resolve('.')+',target=/source,readonly','python:3.13-slim','python3','-B','/source/tools/runtime/test-limbo-games.py'],{stdio:'inherit'});
if(result.error)throw result.error;process.exit(result.status??1);
