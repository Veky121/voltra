// Parent-approved bounded SIGTERM cleanup of the failed initial native menu.
// This is never recorded as successful normal native stop.
import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const dir='.local/romestead-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),node=JSON.parse(fs.readFileSync(s.node_receipt)),v=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(s.owner!=='unreal_survival'||v.uuid!==s.uuid||v.node!==node.node||v.egg!==s.egg_id||v.external_id!=='romestead-native-'+s.request_id)throw Error('Foreign native fixture');
const code=`from pathlib import Path
import os,signal,json
matches=[]
for p in Path('/proc').glob('[0-9]*/cmdline'):
 try:args=p.read_bytes().split(b'\\0')
 except FileNotFoundError:continue
 if len(args)>1 and args[0].endswith(b'/dotnet')and args[1]==b'/home/container/Server.dll':matches.append(int(p.parent.name))
assert len(matches)==1, 'Require exact single native child'
pid=matches[0];assert os.getpgid(pid)==pid,'Require native child group';os.killpg(pid,signal.SIGTERM);print(json.dumps({'native_pid':pid,'signal':'SIGTERM','normal_stop_pass':False}))`;
const result=spawnSync('docker',['exec','-i','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib',s.uuid,'.voltra/python/bin/python3','-B','-'],{windowsHide:true,encoding:'utf8',input:code});
if(result.status)throw Error(result.stderr);fs.writeFileSync(dir+'/first-menu-forced-cleanup.json',result.stdout);console.log(result.stdout);
