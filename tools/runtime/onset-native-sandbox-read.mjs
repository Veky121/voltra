import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const s=JSON.parse(fs.readFileSync('.local/onset-native/private.json'));const v=(await api('/api/application/servers/'+s.internal_id)).attributes;if(v.uuid!==s.uuid||v.external_id!=='onset-native-'+s.request_id)throw Error('Foreign fixture');
const code=`from pathlib import Path
import json
r=Path('/home/container/packages/sandbox');out={}
for p in r.rglob('*.lua'):
 b=p.read_text(errors='replace')
 if 'world.json' in b:out[str(p.relative_to(r))]=b
print(json.dumps(out))`;
const r=spawnSync('docker',['exec','-i','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib',s.uuid,'.voltra/python/bin/python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:1000000});if(r.status)throw Error(r.stderr);fs.writeFileSync('.local/onset-native/sandbox-source.json',r.stdout);console.log(r.stdout.slice(0,18000));
