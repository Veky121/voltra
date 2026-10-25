import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {api} from './openttd-compat-node.mjs';
const dir='.local/onset-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),node=JSON.parse(fs.readFileSync(s.node_receipt));
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(server.uuid!==s.uuid||server.node!==s.node||server.egg!==s.egg_id||server.external_id!=='onset-native-'+s.request_id||node.node!==s.node||node.node_uuid!==s.node_uuid)throw Error('Owned read identity mismatch');
const script=`from pathlib import Path
import json,hashlib
r=Path('/home/container');config=json.loads((r/'server_config.json').read_text());config['password_set']=bool(config.pop('password',''))
receipt=json.loads((r/'.voltra/steam-template-release.json').read_text())
processes=[]
for p in Path('/proc').glob('[0-9]*/cmdline'):
 try:processes.append(p.read_bytes().split(b'\\0')[0].decode(errors='replace'))
 except FileNotFoundError:pass
print(json.dumps({'config':config,'release':receipt,'processes':processes,'net':{name:Path('/proc/net/'+name).read_text() for name in ['udp','udp6','tcp','tcp6']},'package_files':[str(p.relative_to(r)) for p in (r/'packages').rglob('*') if p.is_file()]}))
`;
const r=spawnSync('docker',['exec','-i','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib',s.uuid,'.voltra/python/bin/python3','-B','-'],{windowsHide:true,encoding:'utf8',input:script,maxBuffer:4e6});
if(r.status)throw Error(r.stderr);
const result=JSON.parse(r.stdout),tag=process.argv[2]??'current';if(!/^[a-z0-9_-]+$/.test(tag))throw Error('Invalid tag');
fs.writeFileSync(dir+'/read-'+tag+'.json',JSON.stringify(result,null,2)+'\n');console.log(result);
