import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const dir='.local/fortress-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),tag=process.argv[2];if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Invalid phase');
const n=JSON.parse(fs.readFileSync(s.node_receipt)),v=(await api('/api/application/servers/'+s.internal_id)).attributes;if(v.uuid!==s.uuid||v.node!==n.node||n.node_uuid!==s.node_uuid||v.egg!==s.egg_id||s.owner!=='game_batch_inventory')throw Error('Foreign fixture');
const code=`from pathlib import Path
import json
r=Path('/home/container');net={n:Path('/proc/net/'+n).read_text()for n in ['tcp','tcp6','udp','udp6']};listeners=[]
for proto,text in net.items():
 for line in text.splitlines()[1:]:
  row=line.split()
  if len(row)>9 and(row[3]=='0A'if proto.startswith('tcp')else row[2].endswith(':0000')):listeners.append({'protocol':proto,'local':row[1],'port':int(row[1].split(':')[1],16)})
world=r/'.config/unity3d/ProjectorGames/FortressCraft/Worlds/VoltraAcceptance'
print(json.dumps({'listeners':listeners,'world_exists':world.is_dir(),'world_files':[str(p.relative_to(r))for p in world.rglob('*')if p.is_file()],'memory_current':Path('/sys/fs/cgroup/memory.current').read_text(),'memory_peak':Path('/sys/fs/cgroup/memory.peak').read_text()}))
`;
const p=spawnSync('docker',['exec','-i','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib',s.uuid,'.voltra/python/bin/python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:8e6});if(p.status)throw Error(p.stderr);const result=JSON.parse(p.stdout);result.resources=await api('/api/client/servers/'+s.identifier+'/resources');fs.writeFileSync(dir+'/live-'+tag+'.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log({...result,world_files:result.world_files.length});
