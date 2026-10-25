import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/romestead-native',{receipt:s,node,image}=await ownedStoppedServer(dir+'/private.json');
const code=`from pathlib import Path
import json,hashlib
r=Path('/fixture');out={}
for name in ['saved_worlds','worlds','saves','.local/share','.config']:
 p=r/name;out[name]={'exists':p.exists(),'entries':[{'path':str(x.relative_to(r)),'is_file':x.is_file(),'bytes':x.stat().st_size,'sha256':hashlib.sha256(x.read_bytes()).hexdigest()if x.is_file()else None}for x in p.rglob('*')]if p.exists()else[]}
c=json.loads((r/'config.json').read_text());c['Password_set']=bool(c.pop('Password',''));print(json.dumps({'saves':out,'config':c}))`;
const r=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/fixture,readonly`,image,'python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8'});if(r.status)throw Error(r.stderr);fs.writeFileSync(dir+'/menu-save-inspection.json',r.stdout);console.log(r.stdout);
