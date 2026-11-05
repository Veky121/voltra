import fs from 'node:fs';
import path from 'node:path';
import {runtime,docker,verifyRuntime,activeLease} from './campaign-native-20261029.mjs';
await verifyRuntime();const s=JSON.parse(fs.readFileSync(path.join(runtime,'cubicodyssey-wave5/state.json')));activeLease(s.lease.lease_id,'cubicodyssey_native');
const code="from pathlib import Path;import json,hashlib,base64;r=Path('/v');names=['config/server_config.txt.sample','config/~server_config.txt','help/server_help.txt','help/server_manual.txt'];print(json.dumps({n:{'sha256':hashlib.sha256((r/n).read_bytes()).hexdigest(),'base64':base64.b64encode((r/n).read_bytes()).decode()} for n in names}))";
const result=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--user','988:988','--memory','256m','--memory-swap','256m','--cpus','1','--mount',`type=bind,source=/var/lib/voltra-parity-20261029/volumes/${s.server.uuid},target=/v,readonly`,'python:3.12-slim','python','-B','-c',code]));
fs.writeFileSync('tools/runtime/cubicodyssey-parity-wave5-publisher.sample',Buffer.from(result['config/server_config.txt.sample'].base64,'base64'));
for(const v of Object.values(result))delete v.base64;
fs.writeFileSync('artifacts/game-parity-20261029/cubicodyssey-wave5-publisher.json',JSON.stringify({at:new Date().toISOString(),server_uuid:s.server.uuid,source:'Actual anonymously acquired publisher app3858450 Windows payload; read-only bounded Docker scan',files:result},null,2)+'\n');console.log(JSON.stringify(result));
