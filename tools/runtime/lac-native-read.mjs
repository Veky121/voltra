import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {api} from './openttd-compat-node.mjs';
const dir='.local/lac-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),node=JSON.parse(fs.readFileSync(s.node_receipt));
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(server.uuid!==s.uuid||server.node!==s.node||server.egg!==s.egg_id||s.node!==node.node||s.node_uuid!==node.node_uuid||s.owner!=='unreal_survival')throw Error('Owned native read identity mismatch');
const script=`from pathlib import Path
import json,hashlib,os
root=Path('/home/container');config=root/'.config/unity3d/MA/LAC'
files={}
for p in config.rglob('*'):
 if p.is_file():
  entry={'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
  if p.name=='ServerConfig.txt':entry['text']=p.read_text()
  files[str(p.relative_to(root))]=entry
net={}
for name in ['udp','udp6','tcp','tcp6']:
 net[name]=Path('/proc/net/'+name).read_text()
processes=[]
for p in Path('/proc').glob('[0-9]*/cmdline'):
 try:
  first=p.read_bytes().split(b'\\0')[0].decode(errors='replace')
  processes.append({'argv0':first,'signals':[l for l in (p.parent/'status').read_text().splitlines() if l.startswith(('Name:','SigIgn:','SigCgt:'))]})
 except FileNotFoundError:pass
print(json.dumps({'files':files,'net':net,'processes':processes}))
`;
const r=spawnSync('docker',['exec','-i','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib',s.uuid,'.voltra/python/bin/python3','-B','-'],{input:script,windowsHide:true,encoding:'utf8',maxBuffer:4e6});
if(r.status)throw Error(r.stderr);const out=JSON.parse(r.stdout),tag=process.argv[2]??'current';if(!/^[a-z0-9_-]+$/.test(tag))throw Error('Invalid tag');
fs.writeFileSync(dir+'/read-'+tag+'.json',JSON.stringify(out,null,2)+'\n');console.log(out);
