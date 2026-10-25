import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const dir='.local/wurm-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),tag=process.argv[2];if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Invalid phase');
const n=JSON.parse(fs.readFileSync(s.node_receipt)),v=(await api('/api/application/servers/'+s.internal_id)).attributes;if(v.uuid!==s.uuid||v.node!==n.node||n.node_uuid!==s.node_uuid||v.egg!==s.egg_id||s.owner!=='game_batch_inventory')throw Error('Foreign fixture');
const code=`from pathlib import Path
import json,socket,sqlite3
r=Path('/home/container');net={n:Path('/proc/net/'+n).read_text()for n in ['tcp','tcp6','udp','udp6']};listeners=[]
for proto,text in net.items():
 for line in text.splitlines()[1:]:
  row=line.split()
  if len(row)>9 and(row[3]=='0A'if proto.startswith('tcp')else row[2].endswith(':0000')):listeners.append({'protocol':proto,'local':row[1],'port':int(row[1].split(':')[1],16)})
query={}
try:
 with socket.socket(socket.AF_INET,socket.SOCK_DGRAM)as client:
  client.settimeout(3);request=b'\\xff\\xff\\xff\\xffTSource Engine Query\\x00';client.sendto(request,('127.0.0.1',${s.ports[1]}));data,_=client.recvfrom(8192)
  if data.startswith(b'\\xff\\xff\\xff\\xffA'):client.sendto(request+data[5:9],('127.0.0.1',${s.ports[1]}));data,_=client.recvfrom(8192)
  query={'reply_hex':data.hex(),'a2s_info':data.startswith(b'\\xff\\xff\\xff\\xffI')}
except Exception as error:query={'error':str(error)}
database=[]
for p in(r/'dist/Adventure').rglob('*.db'):
 connection=sqlite3.connect('file:'+str(p)+'?mode=ro',uri=True,timeout=2)
 try:database.append({'path':str(p.relative_to(r)),'tables':[v[0]for v in connection.execute(\"select name from sqlite_master where type='table'\")],'quick_check':connection.execute('pragma quick_check').fetchone()[0]})
 finally:connection.close()
processes=[]
for p in Path('/proc').glob('[0-9]*'):
 try:
  name=(p/'exe').resolve().name
  if name in('java','WurmServerLauncher','Xvfb'):processes.append({'executable':name,'pid':int(p.name)})
 except (FileNotFoundError,PermissionError,ProcessLookupError):pass
print(json.dumps({'listeners':listeners,'query':query,'database':database,'processes':processes,'memory_current':Path('/sys/fs/cgroup/memory.current').read_text(),'memory_peak':Path('/sys/fs/cgroup/memory.peak').read_text()}))
`;
const p=spawnSync('docker',['exec','-i',s.uuid,'python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:5e6});if(p.status)throw Error(p.stderr);const result=JSON.parse(p.stdout);result.resources=await api('/api/client/servers/'+s.identifier+'/resources');fs.writeFileSync(dir+'/live-'+tag+'.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log({...result,database:result.database.map(v=>({path:v.path,tables:v.tables.length,quick_check:v.quick_check}))});
