import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';const d='.local/thefront-native',{receipt:s,node,image}=await ownedStoppedServer(d+'/private.json');const code=`from pathlib import Path
import json,base64,hashlib
r=Path('/v/TheFrontManager/new/Saved/Logs');files={};total=0
for p in r.glob('*.log'):
 assert not p.is_symlink();b=p.read_bytes();total+=len(b);assert total<8*1024**2;files[p.name]={'body':base64.b64encode(b).decode(),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
print(json.dumps(files))`;const c=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/v,readonly`,image,'python3','-c',code],{windowsHide:true,encoding:'utf8',maxBuffer:12e6});if(c.status)throw Error(c.stderr);const j=JSON.parse(c.stdout),out=d+'/native-file-logs-final';fs.mkdirSync(out);for(const [name,v]of Object.entries(j)){if(name.includes('/')||name.includes('..'))throw Error('Unsafe logname');fs.writeFileSync(out+'/'+name,Buffer.from(v.body,'base64'));delete v.body;}fs.writeFileSync(out+'/manifest.json',JSON.stringify(j,null,2));console.log(j);

