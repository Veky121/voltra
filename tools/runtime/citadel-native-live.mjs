import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {api} from './openttd-compat-node.mjs';
const dir='.local/citadel-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),tag=process.argv[2];
if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Invalid observation tag');
const n=JSON.parse(fs.readFileSync(s.node_receipt)),server=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(server.uuid!==s.uuid||server.node!==n.node||n.node_uuid!==s.node_uuid||server.egg!==s.egg_id||s.owner!=='game_batch_inventory')throw Error('Foreign fixture');
const code=`from pathlib import Path
import json,os,hashlib,stat
r=Path('/home/container');secret=${JSON.stringify(s.test_password)};processes=[];listeners=[];saved=[];configs={}
for p in Path('/proc').iterdir():
 if not p.name.isdecimal():continue
 try:
  argv=(p/'cmdline').read_bytes().replace(b'\\0',b' ').decode(errors='replace');cwd=os.readlink(p/'cwd')
  if 'Citadel' in argv or 'fantasy_worlds_runtime' in argv:processes.append({'pid':p.name,'argv':argv.replace(secret,'[redacted]'),'cwd':cwd})
 except (OSError,PermissionError):pass
for proto in ('tcp','tcp6','udp','udp6'):
 for line in Path('/proc/net/'+proto).read_text().splitlines()[1:]:
  row=line.split()
  if len(row)>9 and(row[3]=='0A'if proto.startswith('tcp')else row[2].endswith(':0000')):listeners.append({'protocol':proto,'local':row[1],'port':int(row[1].split(':')[1],16)})
for folder in ('Config','Citadel/Saved','Engine/Saved'):
 for p in (r/folder).rglob('*'):
  if p.is_symlink()or not p.is_file():continue
  st=p.stat();relative=p.relative_to(r).as_posix()
  with p.open('rb')as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
  saved.append({'path':relative,'bytes':st.st_size,'sha256':digest,'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid})
  if p.suffix=='.ini'and st.st_size<1024*1024:configs[relative]=p.read_text(errors='replace').replace(secret,'[redacted]')
print(json.dumps({'processes':processes,'listeners':listeners,'saved_files':saved,'configs':configs,'memory_current':Path('/sys/fs/cgroup/memory.current').read_text(),'memory_peak':Path('/sys/fs/cgroup/memory.peak').read_text()}))
`;
const result=spawnSync('docker',['exec','-i','--user','988:988',s.uuid,'python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',timeout:15000,maxBuffer:3e6});
if(result.status)throw Error(result.stderr);
const value=JSON.parse(result.stdout);value.resources=await api('/api/client/servers/'+s.identifier+'/resources');value.at=new Date().toISOString();
fs.writeFileSync(dir+'/live-'+tag+'.json',JSON.stringify(value,null,2)+'\n',{flag:'wx'});
console.log({processes:value.processes,listeners:value.listeners,saved_files:value.saved_files.length,memory_peak:value.memory_peak.trim(),panel_state:value.resources.attributes.current_state});
