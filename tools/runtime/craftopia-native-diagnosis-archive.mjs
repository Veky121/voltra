import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ownedStoppedServer} from './cache-owned-server.mjs';
const d='.local/craftopia-native',{receipt:s,node,image}=await ownedStoppedServer(d+'/private.json');
const code=`from pathlib import Path
import json,hashlib,base64,stat
r=Path('/v');names=['Craftopia_Data/Managed/AD__Overcraft.dll','Craftopia_Data/Managed/PocketpairSave.dll','ServerSetting.ini','DefaultServerSetting.ini'];out={};total=0
for name in names:
 p=r/name
 if not p.exists():continue
 assert not p.is_symlink()and p.resolve().is_relative_to(r.resolve());st=p.stat();assert stat.S_ISREG(st.st_mode);total+=st.st_size;assert total<16*1024**2;b=p.read_bytes();out[name]={'body':base64.b64encode(b).decode(),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'mode':oct(st.st_mode&0o777),'uid':st.st_uid,'gid':st.st_gid}
print(json.dumps({'files':out,'mutable_inventory':{n:[{'name':str(p.relative_to(r)),'bytes':p.stat().st_size}for p in(r/n).rglob('*')if p.is_file()and not p.is_symlink()]if(r/n).is_dir()else[]for n in ['DedicatedServerSave','PPSave','.config','.local/share']}}))`;
const r=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/v,readonly`,image,'python3','-B','-c',code],{windowsHide:true,encoding:'utf8',maxBuffer:24e6});if(r.status)throw Error(r.stderr);const j=JSON.parse(r.stdout),out=d+'/first-failure-inputs';if(fs.existsSync(out))throw Error('Immutable archive exists');fs.mkdirSync(out);for(const[n,v]of Object.entries(j.files)){if(n.includes('..')||path.isAbsolute(n))throw Error('Archivepath');const p=path.join(out,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.from(v.body,'base64'));delete v.body;}fs.writeFileSync(out+'/manifest.json',JSON.stringify(j,null,2));console.log({files:Object.keys(j.files),mutable_paths:Object.fromEntries(Object.entries(j.mutable_inventory).map(([n,v])=>[n,v.length]))});
