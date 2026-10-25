import fs from 'node:fs';import path from 'node:path';import {spawnSync}from'node:child_process';import {ownedStoppedServer}from'./cache-owned-server.mjs';
const d='.local/mordhau-native',tag=process.argv[2];if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Tag');const {receipt:s,node,image}=await ownedStoppedServer(d+'/private.json');
const code=`from pathlib import Path
import json,hashlib,base64,stat
r=Path('/v');files={};total=0
for name in ['Mordhau/Saved','.config','.local/share']:
 p=r/name
 if not p.exists():continue
 assert not p.is_symlink()
 for q in p.rglob('*'):
  if not q.is_file():continue
  assert not q.is_symlink() and q.resolve().is_relative_to(r.resolve());st=q.stat();assert stat.S_ISREG(st.st_mode);total+=st.st_size;assert total<=128*1024**2;b=q.read_bytes();files[str(q.relative_to(r))]={'body':base64.b64encode(b).decode(),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'mode':oct(st.st_mode&0o777),'uid':st.st_uid,'gid':st.st_gid}
print(json.dumps({'files':files}))`;
const r=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/v,readonly`,image,'python3','-B','-c',code],{windowsHide:true,encoding:'utf8',maxBuffer:180e6});if(r.status)throw Error(r.stderr);
const j=JSON.parse(r.stdout),out=d+'/native-state-'+tag;if(fs.existsSync(out))throw Error('Immutable archive exists');fs.mkdirSync(out);
for(const[n,v]of Object.entries(j.files)){if(n.includes('..')||path.isAbsolute(n))throw Error('Unsafe path');const p=path.join(out,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.from(v.body,'base64'));delete v.body;}
fs.writeFileSync(out+'/manifest.json',JSON.stringify(j,null,2)+'\n');console.log({files:Object.keys(j.files).length,bytes:Object.values(j.files).reduce((n,v)=>n+v.bytes,0)});
