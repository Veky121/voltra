import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const dir='.local/holdfast-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),tag=process.argv[2];if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Invalid tag');const server=(await api('/api/application/servers/'+s.internal_id)).attributes;if(server.uuid!==s.uuid||server.egg!==s.egg_id||s.owner!=='racing_games')throw Error('Foreign fixture');
const code=`from pathlib import Path
import json
r=Path('/home/container');base=r/'holdfastnaw-dedicated';logs={}
for p in (base/'logs_output').glob('*'):
 if p.is_file():logs[str(p.relative_to(r))]=p.read_text(errors='replace')[-50000:]
listeners=[]
for proto in ['udp','udp6','tcp','tcp6']:
 for line in Path('/proc/net/'+proto).read_text().splitlines()[1:]:
  a=line.split();port=int(a[1].split(':')[1],16)
  if port in ${JSON.stringify(s.ports)}:listeners.append({'protocol':proto,'local':a[1],'state':a[3]})
print(json.dumps({'logs':logs,'listeners':listeners,'memory':Path('/sys/fs/cgroup/memory.current').read_text(),'peak':Path('/sys/fs/cgroup/memory.peak').read_text()}))`;
const p=spawnSync('docker',['exec',s.uuid,'/home/container/.voltra/python/bin/python3','-c',code],{windowsHide:true,encoding:'utf8',maxBuffer:2e6});if(p.status)throw Error(p.stderr);let value=JSON.parse(p.stdout);value.resources=await api('/api/client/servers/'+s.identifier+'/resources');for(const k in value.logs)value.logs[k]=value.logs[k].replaceAll(s.test_password,'[REDACTED]');fs.writeFileSync(dir+'/live-'+tag+'.json',JSON.stringify(value,null,2)+'\n',{flag:'wx'});console.log({...value,logs:Object.fromEntries(Object.entries(value.logs).map(([k,v])=>[k,v.slice(-6000)]))});
