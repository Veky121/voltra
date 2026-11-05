import fs from 'node:fs';import {spawnSync} from 'node:child_process';import * as h from './campaign-native-20261029.mjs';const out='artifacts/game-parity-20261029/wave413-nmrih-native-resume/',s=JSON.parse(fs.readFileSync(out+'state.json'));const checks={};for(const [k,p] of Object.entries({server:'/api/application/servers/'+s.server.id,egg:'/api/admin/eggs/'+s.egg.id,nest:'/api/admin/nests/'+s.nest.id})){const r=await fetch('http://127.0.0.1:18099'+p);await r.text();checks[k]=r.status===404;}checks.containers=!h.containers().some(x=>x.Name.includes(s.server.uuid));checks.allocations=!(await h.api('/api/application/nodes/1/allocations')).data.some(x=>s.allocations.some(a=>a.id===x.attributes.id));if(!Object.values(checks).every(Boolean))throw Error('API ownership cleanup incomplete');const code=`from pathlib import Path
import shutil,json
u='${s.server.uuid}';base=Path('/owned');removed=[]
for root in [base/'volumes',base/'tmp',base/'machine-id',base/'logs'/'install',Path('/hosttmp')]:
 if not root.exists():continue
 for p in list(root.rglob('*')):
  if u not in p.name:continue
  assert p.name==u or u in p.name
  if p.is_dir() and not p.is_symlink():shutil.rmtree(p)
  else:p.unlink(missing_ok=True)
  removed.append(str(p))
remaining=[str(p) for root in [base,Path('/hosttmp')] for p in root.rglob('*') if u in p.name]
print(json.dumps({'removed':removed,'remaining':remaining,'volume_absent':not (base/'volumes'/u).exists()}))
`;const r=spawnSync('docker',['--context','desktop-linux','run','--rm','--pull','never','--network','none','--memory','128m','--memory-swap','128m','--cpus','1','-v','/var/lib/voltra-parity-20261029:/owned','-v','/tmp:/hosttmp','python:3.12-slim','python','-B','-c',code],{encoding:'utf8',windowsHide:true});fs.writeFileSync(out+'cleanup-aux-diagnostics.json',JSON.stringify({status:r.status,stdout:r.stdout,stderr:r.stderr},null,2));if(r.status!==0)throw Error(r.stderr);const aux=JSON.parse(r.stdout);checks.volume=aux.volume_absent;checks.aux_absent=aux.remaining.length===0;fs.writeFileSync(out+'cleanup.json',JSON.stringify({at:new Date().toISOString(),checks,aux},null,2));if(!Object.values(checks).every(Boolean))throw Error('Residual cleanup incomplete');fs.writeFileSync(out+'lease-released.json',JSON.stringify(h.releaseNative(s.lease.lease_id,s.lease.owner,'tested',true),null,2));
