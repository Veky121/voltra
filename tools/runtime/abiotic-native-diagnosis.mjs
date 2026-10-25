import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';const d='.local/abiotic-native',{receipt:s,node,image}=await ownedStoppedServer(d+'/private.json');const code=`from pathlib import Path
import hashlib,json,struct
r=Path('/v');files=[]
for p in r.rglob('*'):
 if p.is_file() and (p.name.lower() in ('steam_appid.txt','steamclient64.dll','steamclient.dll','tier0_s64.dll','vstdlib_s64.dll','steam_api64.dll','steamclient.so','lsteamclient.so') or p.name.endswith('.log') and 'Saved/Logs' in str(p)):
  z=p.stat();item={'path':str(p.relative_to(r)),'bytes':z.st_size,'mode':oct(z.st_mode&0o777),'uid':z.st_uid,'gid':z.st_gid}
  if z.st_size<=100*1024**2:
   b=p.read_bytes();item['sha256']=hashlib.sha256(b).hexdigest()
   if p.suffix=='.dll' and b[:2]==b'MZ':o=struct.unpack_from('<I',b,60)[0];item['pe_machine']=hex(struct.unpack_from('<H',b,o+4)[0])
   if p.name=='steam_appid.txt':item['appid']=b.decode(errors='replace')
   if p.name.endswith('.log') and 'Saved/Logs' in str(p):item['prefix']=b[:60000].decode(errors='replace');item['tail']=b[-12000:].decode(errors='replace')
  files.append(item)
print(json.dumps({'files':files}))`;const c=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--cap-drop','ALL','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/v,readonly`,image,'python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:2e6});if(c.status)throw Error(c.stderr);const j=JSON.parse(c.stdout);fs.writeFileSync(d+'/stopped-diagnosis.json',JSON.stringify(j,null,2));console.log(j.files.filter(f=>!f.path.endsWith('.log')));for(const f of j.files.filter(f=>f.prefix))console.log(f.prefix.replaceAll(s.test_password,'[REDACTED]').split('\n').filter(l=>/Steam|Error|Warning|AppId|AppID|libvulkan|LogInit:/.test(l)).slice(0,40).join('\n'));
