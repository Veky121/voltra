import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const dir='.local/scpsl-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),n=JSON.parse(fs.readFileSync(s.node_receipt));const a=(await api('/api/application/servers/'+s.internal_id)).attributes;if(a.uuid!==s.uuid||a.node!==n.node||a.egg!==s.egg_id||a.external_id!=='scpsl-native-'+s.request_id)throw Error('Owned identity');
const code=`from pathlib import Path
import json,hashlib
r=Path('/home/container')
print(json.dumps({'files':[str(p.relative_to(r)) for p in r.glob('*')],'config_files':[str(p.relative_to(r)) for p in (r/'.config').rglob('*') if p.is_file()],'release':json.loads((r/'.voltra/steam-template-release.json').read_text()),'processes':[p.read_bytes().split(b'\\0')[0].decode(errors='replace') for p in Path('/proc').glob('[0-9]*/cmdline') if p.exists()],'icu76':any(Path('/lib/x86_64-linux-gnu').glob('libicuuc.so.76*'))}))`;
const c=spawnSync('docker',['exec','-i',s.uuid,'python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:2e6});if(c.status)throw Error(c.stderr);const j=JSON.parse(c.stdout);fs.writeFileSync(dir+'/first-eula-inventory.json',JSON.stringify(j,null,2)+'\n');console.log({files:j.files.length,config_files:j.config_files,release:j.release,processes:j.processes,icu76:j.icu76});
