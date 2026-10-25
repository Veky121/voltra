import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const d='.local/reforger-native',tag=process.argv[2];assert(/^[a-z0-9-]+$/.test(tag));const {receipt:s,node,image}=await ownedStoppedServer(d+'/private.json');
const code=`from pathlib import Path
import json,hashlib,base64,stat
r=Path('/v');files={};total=0
for name in ['profile','tmp','config.json','.config','.local/share','battleye/EULA','License.txt','Readme.txt']:
 p=r/name
 if not p.exists():continue
 assert not p.is_symlink()
 for q in ([p] if p.is_file() else p.rglob('*')):
  if not q.is_file():continue
  assert not q.is_symlink() and q.resolve().is_relative_to(r.resolve());st=q.stat();assert stat.S_ISREG(st.st_mode);total+=st.st_size;assert total<=128*1024**2;b=q.read_bytes();files[str(q.relative_to(r))]={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'mode':oct(st.st_mode&0o777),'uid':st.st_uid,'gid':st.st_gid,'mtime_ns':st.st_mtime_ns,'body':base64.b64encode(b).decode()}
print(json.dumps({'files':files,'bytes':total}))`;
const r=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--read-only','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/v,readonly`,image,'python3','-B','-c',code],{windowsHide:true,encoding:'utf8',maxBuffer:180e6});assert.equal(r.status,0,r.stderr);const j=JSON.parse(r.stdout),out=d+'/native-state-'+tag;assert(!fs.existsSync(out));fs.mkdirSync(out);for(const[n,v]of Object.entries(j.files)){const target=path.join(out,n);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,Buffer.from(v.body,'base64'));delete v.body;}fs.writeFileSync(out+'/manifest.json',JSON.stringify(j,null,2)+'\n');console.log({files:Object.keys(j.files).length,bytes:j.bytes,battleye_terms:Object.keys(j.files).filter(x=>x.startsWith('battleye/EULA/')).length});
