import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const d='.local/plains-native',{receipt:s,node,image}=await ownedStoppedServer(d+'/private.json');
const code=`from pathlib import Path
import json,hashlib,base64
r=Path('/v');out={}
for p in r.rglob('*'):
 if p.is_file() and not p.is_symlink() and p.suffix.lower() in ('.txt','.md') and any(k in p.name.lower() for k in ('eula','license','agreement','readme')):
  assert p.stat().st_size<=2*1024**2;b=p.read_bytes();out[str(p.relative_to(r))]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'body':base64.b64encode(b).decode()}
print(json.dumps(out))`;
const r=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/v,readonly`,image,'python3','-B','-c',code],{windowsHide:true,encoding:'utf8',maxBuffer:16e6});if(r.status)throw Error(r.stderr);const j=JSON.parse(r.stdout);fs.mkdirSync(d+'/publisher-terms',{recursive:true});for(const[path,x]of Object.entries(j)){fs.writeFileSync(d+'/publisher-terms/'+path.replaceAll('/','__'),Buffer.from(x.body,'base64'));delete x.body;}fs.writeFileSync(d+'/publisher-terms/manifest.json',JSON.stringify(j,null,2)+'\n');console.log(Object.entries(j).filter(([p])=>!p.startsWith('.voltra/')).map(([path,v])=>({path,...v})));
