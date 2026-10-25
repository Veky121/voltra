import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {api} from './openttd-compat-node.mjs';
const dir='.local/aapg-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),tag=process.argv[2];if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Invalid tag');
const n=JSON.parse(fs.readFileSync(s.node_receipt)),v=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(v.uuid!==s.uuid||v.node!==n.node||n.node_uuid!==s.node_uuid||v.egg!==s.egg_id||s.owner!=='game_batch_inventory')throw Error('Foreign fixture');
const code=`from pathlib import Path
import os,json,hashlib,stat
r=Path('/home/container');processes=[];listeners=[];files=[]
for p in Path('/proc').iterdir():
 if not p.name.isdecimal():continue
 try:
  argv=(p/'cmdline').read_bytes().replace(b'\\0',b' ').decode(errors='replace')
  if 'AAPG' in argv or 'tactical_next_runtime' in argv:processes.append({'pid':p.name,'argv':argv,'cwd':os.readlink(p/'cwd')})
 except OSError:pass
for proto in ('tcp','tcp6','udp','udp6'):
 for line in Path('/proc/net/'+proto).read_text().splitlines()[1:]:
  row=line.split()
  if len(row)>9 and(row[3]=='0A'if proto.startswith('tcp')else row[2].endswith(':0000')):listeners.append({'protocol':proto,'local':row[1],'port':int(row[1].split(':')[1],16)})
for folder in ('AAGame/Config','AAGame/Saved','AAGame/SaveData','AAGame/Logs','AAPG/Config','AAPG/Saved','AAPG/ServerConfig','AAEngine/Config'):
 for p in (r/folder).rglob('*'):
  if p.is_symlink()or not p.is_file():continue
  st=p.stat()
  with p.open('rb')as source:digest=hashlib.file_digest(source,'sha256').hexdigest()
  files.append({'path':p.relative_to(r).as_posix(),'bytes':st.st_size,'sha256':digest,'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid})
print(json.dumps({'processes':processes,'listeners':listeners,'state_files':files,'memory_current':Path('/sys/fs/cgroup/memory.current').read_text(),'memory_peak':Path('/sys/fs/cgroup/memory.peak').read_text()}))
`;
const out=spawnSync('docker',['exec','-i','--user','988:988',s.uuid,'env','PYTHONHOME=/home/container/.voltra/python','LD_LIBRARY_PATH=/home/container/.voltra/python/lib','/home/container/.voltra/python/bin/python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',timeout:20000,maxBuffer:4e6});
if(out.status)throw Error(out.stderr);const result=JSON.parse(out.stdout);result.resources=await api('/api/client/servers/'+s.identifier+'/resources');result.at=new Date().toISOString();
fs.writeFileSync(dir+'/live-'+tag+'.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log({processes:result.processes,listeners:result.listeners,state_files:result.state_files.length,memory_peak:result.memory_peak.trim(),panel_state:result.resources.attributes.current_state});
