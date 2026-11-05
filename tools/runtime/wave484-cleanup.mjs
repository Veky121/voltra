import fs from 'node:fs';import path from 'node:path';import * as h from './campaign-native-20261029.mjs';const key=process.argv[2],d=path.resolve('artifacts/game-parity-20261029/wave484-id-family-native'),s=JSON.parse(fs.readFileSync(d+'/'+key+'-state.json')),save=(n,x)=>fs.writeFileSync(d+'/'+key+'-'+n+'.json',JSON.stringify(x,null,2));await h.verifyRuntime();if((await h.observePower(s)).current_state!=='offline')throw Error('Stop before cleanup');await h.api('/api/application/servers/'+s.server.id,'DELETE');for(const a of s.allocations)await h.api('/api/application/nodes/1/allocations/'+a.id,'DELETE');await h.api('/api/admin/eggs/'+s.egg.id,'DELETE');await h.api('/api/admin/nests/'+s.nest.id,'DELETE');
const disk=JSON.parse(h.docker(['run','--name','wave484-'+key+'-cleanup','--rm','--pull','never','--network','none','--memory','128m','--memory-swap','128m','--cpus','1','-v','/var/lib/voltra-parity-20261029:/campaign','-v','/tmp:/hosttmp','-v',d+':/out','python:3.12-slim','python','-B','-c',`import pathlib,os,shutil,json
u='${s.server.uuid}';r=pathlib.Path('/campaign');checks={}
assert not os.path.lexists(r/'volumes'/u)
for section in ['tmp','machine-id','passwd']:
 p=r/section/u
 if p.is_dir() and not p.is_symlink():shutil.rmtree(p)
 elif os.path.lexists(p):p.unlink()
for root in [r/'logs',pathlib.Path('/hosttmp')]:
 for p in list(root.rglob('*')) if root.exists() else []:
  if u in p.name:
   if p.is_file():shutil.copy2(p,pathlib.Path('/out')/('${key}-owned-'+p.name));p.unlink()
   elif p.is_dir():shutil.rmtree(p)
for section in ['volumes','tmp','machine-id','passwd']:checks[section]=not os.path.lexists(r/section/u)
checks['logs']=not any(u in p.name for p in (r/'logs').rglob('*'))
checks['hosttmp']=not any(u in p.name for p in pathlib.Path('/hosttmp').rglob('*'))
print(json.dumps(checks))`]));const checks={...disk};for(const [k,url]of Object.entries({server:'/api/application/servers/'+s.server.id,egg:'/api/admin/eggs/'+s.egg.id,nest:'/api/admin/nests/'+s.nest.id})){const r=await fetch('http://127.0.0.1:18099'+url);await r.text();checks[k]=r.status===404;}checks.containers=!h.containers().some(c=>c.Name.includes(s.server.uuid)||c.Name.includes('wave484-'+key));checks.allocations=!(await h.api('/api/application/nodes/1/allocations')).data.some(x=>s.allocations.some(a=>a.id===x.attributes.id));save('cleanup',checks);if(!Object.values(checks).every(Boolean))throw Error('Cleanup incomplete');save('release',h.releaseNative(s.lease.lease_id,s.lease.owner,'blocked',true));console.log(JSON.stringify(checks));
