// Read-only native SQLite identity, no world/blob/credential values printed.
import fs from 'node:fs';
import path from 'node:path';
import {runtime,docker,verifyRuntime,activeLease,observePower,digest} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'craftopia-wave5-native'),file=path.join(dir,'state.json'),s=JSON.parse(fs.readFileSync(file)),phase=process.argv[2];
if(!['baseline','after-runtime'].includes(phase))throw Error('Explicit identity phase required');
await verifyRuntime();activeLease(s.lease.lease_id,'craftopia_native_wave5');if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Activation paused');if((await observePower(s.fixture)).current_state!=='offline')throw Error('Stopped native world required');
const uuid=s.fixture.server.uuid;if(!/^[a-f0-9-]{36}$/.test(uuid))throw Error('Owned UUID required');
const code=String.raw`from pathlib import Path
import sqlite3,json,hashlib
root=Path('/owned/DedicatedServerSave')
out=[]
for file in sorted([root/'Craftopia.db',root/'Settings.db',*list((root/'Worlds').glob('*.db'))]):
 db=sqlite3.connect(file.as_uri()+'?mode=ro&immutable=1',uri=True)
 entities=[]
 for key,value in db.execute('SELECT id,value FROM Entity ORDER BY id'):
  try:
   obj=json.loads(value)
   keys=sorted(obj.keys()) if isinstance(obj,dict) else []
  except (ValueError,TypeError):
   obj=None;keys=[]
  identities={}
  def walk(node,prefix='',depth=0):
   if depth>4:return
   if isinstance(node,dict):
    for k,v in node.items():
     path=prefix+'/'+str(k)
     if str(k).casefold() in ('id','worldid','worldname','name','seed','worldseed','createtime','creationtime','createdat') and isinstance(v,(str,int,float,bool)):
      identities[path]=hashlib.sha256(json.dumps(v,sort_keys=True).encode()).hexdigest()
     elif isinstance(v,(dict,list)):walk(v,path,depth+1)
   elif isinstance(node,list):
    for i,v in enumerate(node[:1000]):walk(v,prefix+'/'+str(i),depth+1)
  walk(obj)
  entities.append({'entity_id_sha256':hashlib.sha256(str(key).encode()).hexdigest(),'json_keys':keys,'stable_identity_hashes':identities})
 integrity=db.execute('PRAGMA integrity_check').fetchone()[0];db.close()
 out.append({'file':str(file.relative_to(root)),'integrity':integrity,'entities':entities})
print(json.dumps(out))`;
const rows=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','128m','--memory-swap','128m','--cpus','1','--mount','type=bind,source=/var/lib/voltra-parity-20261029/volumes/'+uuid+',target=/owned,readonly','sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704','python','-B','-c',code]));
const output=path.join(dir,'world-identity-'+phase+'.json');if(phase==='baseline'&&fs.existsSync(output))throw Error('Original identity baseline preserved');
fs.writeFileSync(output,JSON.stringify(rows,null,2)+'\n');s.world_identity??={};s.world_identity[phase]={file:output,sha256:digest(fs.readFileSync(output))};
if(phase==='after-runtime'){const before=JSON.parse(fs.readFileSync(s.world_identity.baseline.file));if(JSON.stringify(before)!==JSON.stringify(rows))throw Error('Native world identity/schema changed; inspect before claiming reload');s.world_identity.native_reload_identical=true;}
fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');console.log(JSON.stringify({phase,rows}));
