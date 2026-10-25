import fs from 'node:fs';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const tag=process.argv[2];assert(/^[a-z0-9-]+$/.test(tag));const d='.local/reforger-native',{receipt:s,node,image}=await ownedStoppedServer(d+'/private.json');const out=d+'/payload-'+tag+'.json';assert(!fs.existsSync(out));
const code=`from pathlib import Path
import json,hashlib,os,stat
r=Path('/v');files={};total=0
for base,dirs,names in os.walk(r,followlinks=False):
 for name in list(dirs):
  p=Path(base)/name
  if p.is_symlink():raise ValueError('Unexpected payload link')
 for name in names:
  p=Path(base)/name;st=p.lstat();assert stat.S_ISREG(st.st_mode);h=hashlib.sha256()
  with p.open('rb') as f:
   while b:=f.read(1024*1024):h.update(b)
  total+=st.st_size;assert total<=64*1024**3;files[str(p.relative_to(r))]={'sha256':h.hexdigest(),'bytes':st.st_size,'mode':oct(st.st_mode&0o777),'uid':st.st_uid,'gid':st.st_gid}
print(json.dumps({'files':files,'total_bytes':total}))`;
const r=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--read-only','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/v,readonly`,image,'python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:20e6,timeout:120000});assert.equal(r.status,0,r.stderr);const j=JSON.parse(r.stdout);fs.writeFileSync(out,JSON.stringify(j,null,2)+'\n',{flag:'wx'});console.log({files:Object.keys(j.files).length,bytes:j.total_bytes});
