import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const dir='.local/jc3-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),tag=process.argv[2];if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Invalid phase');
const n=JSON.parse(fs.readFileSync(s.node_receipt)),v=(await api('/api/application/servers/'+s.internal_id)).attributes;if(v.uuid!==s.uuid||v.node!==n.node||n.node_uuid!==s.node_uuid||v.egg!==s.egg_id||s.owner!=='game_batch_inventory')throw Error('Foreign fixture');
const code=`from pathlib import Path
import json,socket,urllib.request
r=Path('/home/container');config=json.loads((r/'config.json').read_text());config['password_set']=bool(config.pop('password',''))
net={name:Path('/proc/net/'+name).read_text() for name in ['tcp','tcp6','udp','udp6']};listeners=[]
for proto,text in net.items():
 for line in text.splitlines()[1:]:
  row=line.split()
  if len(row)>9 and (row[3]=='0A' if proto.startswith('tcp') else row[2].endswith(':0000')):listeners.append({'protocol':proto,'local':row[1],'port':int(row[1].split(':')[1],16)})
query={}
try:
 with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as client:
  client.settimeout(3);request=b'\\xff\\xff\\xff\\xffTSource Engine Query\\x00';client.sendto(request,('127.0.0.1',config['queryPort']));data,_=client.recvfrom(8192)
  if data.startswith(b'\\xff\\xff\\xff\\xffA'):client.sendto(request+data[5:9],('127.0.0.1',config['queryPort']));data,_=client.recvfrom(8192)
  query={'reply_hex':data.hex(),'a2s_info':data.startswith(b'\\xff\\xff\\xff\\xffI')}
except Exception as error:query={'error':str(error)}
try:
 with urllib.request.urlopen('http://127.0.0.1:'+str(config['httpPort'])+'/',timeout=3)as response:http={'status':response.status,'body':response.read(4096).decode(errors='replace')}
except urllib.error.HTTPError as error:http={'status':error.code,'body':error.read(4096).decode(errors='replace')}
except Exception as error:http={'error':str(error)}
processes=[]
for p in Path('/proc').glob('[0-9]*'):
 try:
  exe=(p/'exe').resolve().name
  if exe in('Server','Xvfb'):
   env=dict(v.split(b'=',1)for v in(p/'environ').read_bytes().split(b'\\0')if b'='in v)
   processes.append({'executable':exe,'pid':int(p.name),'LD_LIBRARY_PATH':env.get(b'LD_LIBRARY_PATH',b'').decode(),'XVFB':env.get(b'XVFB',b'').decode()})
 except (FileNotFoundError,PermissionError,ProcessLookupError):pass
print(json.dumps({'config':config,'query':query,'http':http,'listeners':listeners,'processes':processes,'memory_current':Path('/sys/fs/cgroup/memory.current').read_text(),'memory_peak':Path('/sys/fs/cgroup/memory.peak').read_text(),'data_files':[str(p.relative_to(r))for p in(r/'data').rglob('*')if p.is_file()][:120]}))
`;
const p=spawnSync('docker',['exec','-i',s.uuid,'python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:4e6});if(p.status)throw Error(p.stderr);const result=JSON.parse(p.stdout);result.resources=await api('/api/client/servers/'+s.identifier+'/resources');fs.writeFileSync(dir+'/live-'+tag+'.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log({...result,data_files:result.data_files.length});
