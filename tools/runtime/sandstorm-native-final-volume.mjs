import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const d='.local/sandstorm-native',{receipt:s,node,image}=await ownedStoppedServer(d+'/private.json');
const code=`from pathlib import Path
import hashlib,json,os,stat
root=Path('/v');files={};links={};total=0
for base,dirs,names in os.walk(root,followlinks=False):
 for name in list(dirs):
  p=Path(base)/name
  if p.is_symlink():links[str(p.relative_to(root))]=os.readlink(p);dirs.remove(name)
 for name in names:
  p=Path(base)/name;st=p.lstat();rel=str(p.relative_to(root))
  if stat.S_ISLNK(st.st_mode):links[rel]=os.readlink(p);continue
  assert stat.S_ISREG(st.st_mode)
  h=hashlib.sha256()
  with p.open('rb') as f:
   while b:=f.read(1024*1024):h.update(b)
  now=p.stat();assert (st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)==(now.st_ino,now.st_size,now.st_mtime_ns,now.st_ctime_ns)
  total+=st.st_size;assert total<=32*1024**3
  files[rel]={'sha256':h.hexdigest(),'bytes':st.st_size,'mode':oct(st.st_mode&0o777),'uid':st.st_uid,'gid':st.st_gid}
print(json.dumps({'files':files,'symlinks_not_followed':links,'total_regular_bytes':total}))`;
const r=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--read-only','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/v,readonly`,image,'python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:20e6,timeout:120000});if(r.status)throw Error(r.stderr);const j=JSON.parse(r.stdout);fs.writeFileSync(d+'/final-full-volume-manifest.json',JSON.stringify(j,null,2)+'\n',{flag:'wx'});console.log({files:Object.keys(j.files).length,bytes:j.total_regular_bytes,symlinks:Object.keys(j.symlinks_not_followed).length});
