import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const dir='.local/solace-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),tag=process.argv[2];if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Invalid phase');
const n=JSON.parse(fs.readFileSync(s.node_receipt)),v=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(v.uuid!==s.uuid||v.node!==n.node||n.node_uuid!==s.node_uuid||v.egg!==s.egg_id||s.owner!=='game_batch_inventory')throw Error('Foreign fixture');
const script=`from pathlib import Path
import json,socket,struct,hashlib,stat
r=Path('/home/container');cfg=r/'.config/unity3d/Big Kitty Games/Solace Crafting/servercfg.dat';config=json.loads(cfg.read_text())
for k in config:
 if 'password' in k.lower():config[k]=bool(config[k])
net={name:Path('/proc/net/'+name).read_text() for name in ['tcp','tcp6','udp','udp6']}
listeners=[]
for proto,text in net.items():
 for line in text.splitlines()[1:]:
  row=line.split()
  if len(row)>9 and (row[3]=='0A' if proto.startswith('tcp') else row[2].endswith(':0000')):listeners.append({'protocol':proto,'local':row[1],'port':int(row[1].split(':')[1],16),'state':row[3],'inode':row[9]})
query={}
try:
 with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as client:
  client.settimeout(3);request=b'\\xff\\xff\\xff\\xffTSource Engine Query\\x00';client.sendto(request,('127.0.0.1',${s.ports[1]}));data,_=client.recvfrom(8192)
  if data.startswith(b'\\xff\\xff\\xff\\xffA'):
   client.sendto(request+data[5:9],('127.0.0.1',${s.ports[1]}));data,_=client.recvfrom(8192)
  query={'reply_hex':data.hex(),'bytes':len(data),'a2s_info':data.startswith(b'\\xff\\xff\\xff\\xffI')}
except Exception as error:query={'error':str(error)}
with socket.create_connection(('127.0.0.1',${s.ports[0]}),3):pass
files={}
for p in cfg.parent.rglob('*'):
 if p.is_file() and not p.is_symlink():
  st=p.stat();files[str(p.relative_to(r))]={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'size':st.st_size,'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid}
print(json.dumps({'config':config,'listeners':listeners,'network':net,'query':query,'game_tcp_connected':True,'files':files,'memory':Path('/sys/fs/cgroup/memory.current').read_text(),'memory_peak':Path('/sys/fs/cgroup/memory.peak').read_text()}))
`;
const p=spawnSync('docker',['exec','-i',s.uuid,'python3','-B','-'],{windowsHide:true,input:script,encoding:'utf8',maxBuffer:5e6});if(p.status)throw Error(p.stderr);
const value=JSON.parse(p.stdout);value.resources=await api('/api/client/servers/'+s.identifier+'/resources');fs.writeFileSync(dir+'/live-'+tag+'.json',JSON.stringify(value,null,2)+'\n',{flag:'wx'});console.log({...value,network:undefined,files:Object.keys(value.files).length});
