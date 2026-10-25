import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/aapg-native',tag=process.argv[2];if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Invalid tag');
const {receipt:s,node}=await ownedStoppedServer(dir+'/private.json');
if(s.owner!=='game_batch_inventory'||s.uuid!=='5d09b841-5642-48fa-9287-a65eed284e0e')throw Error('Foreign fixture');
const code=`from pathlib import Path
import json,hashlib,stat,os
r=Path('/volume');files={};configs={};mtimes={};directories=[];links={}
for prefix in ('AAGame','AAPG','AAEngine'):
 base=r/prefix
 if base.is_dir():directories.append({'path':prefix,'children':[p.name for p in base.iterdir()]})
for relative in ('AAGame/Config','AAGame/Cloud','AAGame/Saved','AAGame/SaveData','AAGame/Logs','AAGame/ServerConfig','AAGame/Profiles','AAPG/Config','AAPG/Saved','AAPG/ServerConfig','AAEngine/Config','Binaries/Linux/pb'):
 base=r/relative
 for p in base.rglob('*')if base.is_dir()else[]:
  if p.is_symlink():links[p.relative_to(r).as_posix()]={'target':os.readlink(p),'uid':p.lstat().st_uid,'gid':p.lstat().st_gid};continue
  if not p.is_file():continue
  st=p.stat();name=p.relative_to(r).as_posix()
  with p.open('rb')as source:digest=hashlib.file_digest(source,'sha256').hexdigest()
  files[name]={'sha256':digest,'bytes':st.st_size,'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid};mtimes[name]=st.st_mtime_ns
  if p.suffix.lower()in('.ini','.cfg','.dat')and st.st_size<=1024*1024:configs[name]=p.read_text(errors='replace')
print(json.dumps({'files':files,'links':links,'configs':configs,'mtimes_ns':mtimes,'actual_directories':directories}))
`;
const out=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--user','988:988','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--memory','256m','--cpus','1','--pids-limit','32','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume,readonly`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',timeout:30000,maxBuffer:6e6});
if(out.status)throw Error(out.stderr);const result=JSON.parse(out.stdout);result.at=new Date().toISOString();
fs.writeFileSync(dir+'/snapshot-'+tag+'.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log({files:Object.keys(result.files).length,actual_directories:result.actual_directories,aagame_state_files:Object.keys(result.files).filter(p=>p.startsWith('AAGame/'))});
