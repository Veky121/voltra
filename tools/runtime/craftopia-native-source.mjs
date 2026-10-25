import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {ownedStoppedServer} from './cache-owned-server.mjs';
const {receipt:s,node}=await ownedStoppedServer('.local/craftopia-native/private.json');
const profile=JSON.parse(fs.readFileSync(fs.existsSync('.local/craftopia-native/source-profile-current.json')?'.local/craftopia-native/source-profile-current.json':'.local/craftopia-native/source-profile.json'));
const names=[...profile.egg.scripts.installation.script.matchAll(/cat > \.voltra\/([^ ]+)/g)].map(m=>m[1]);
const code=`from pathlib import Path
import json,hashlib,base64
r=Path('/volume/.voltra')
names=json.loads(${JSON.stringify(JSON.stringify(names))})
print(json.dumps({n:{'sha256':hashlib.sha256((r/n).read_bytes()).hexdigest(),'body':base64.b64encode((r/n).read_bytes()).decode()} for n in names}))
`;
const r=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume,readonly`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:4e6});
if(r.status)throw Error(r.stderr);
const j=JSON.parse(r.stdout),tag=process.argv[2]??'first';
if(!/^[a-z0-9_-]+$/.test(tag))throw Error('Invalid tag');
const dir='.local/craftopia-native/installed-source-'+tag;if(fs.existsSync(dir))throw Error('Existing exact source snapshot');fs.mkdirSync(dir,{recursive:true});
for(const [name,value]of Object.entries(j)){fs.writeFileSync(dir+'/'+name,Buffer.from(value.body,'base64'));delete value.body;}
fs.writeFileSync(dir+'/manifest.json',JSON.stringify(j,null,2)+'\n');console.log('Actual installed sources archived',Object.keys(j).length);
