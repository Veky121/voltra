import fs from 'node:fs';import path from 'node:path';
import {runtime,verifyRuntime,activeLease,docker,api,releaseNative} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'css-native'),file=path.join(dir,'state.json'),s=JSON.parse(fs.readFileSync(file));
if(s.cleanup?.lease_released){console.log('Owned cleanup already complete');process.exit(0);}
await verifyRuntime();activeLease(s.lease.lease_id,'css_native');
const f=s.fixture;if(!f?.server)throw Error('No owned fixture to clean');const uuid=f.server.uuid,save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');
if(!s.cleanup){
 const server=(await api('/api/application/servers/'+f.server.id)).attributes;
 if(server.uuid!==uuid||server.egg!==f.egg.id||server.nest!==f.nest.id||server.node!==1||server.name!=='Campaign Counter-Strike Source native')throw Error('Foreign fixture');
 const c=JSON.parse(docker(['inspect',uuid]))[0];
 if(c.State.Running||c.State.ExitCode!==0||c.State.OOMKilled)throw Error('Expected native clean raw0, no OOM');
 if(c.Mounts.find(m=>m.Destination==='/home/container')?.Source!=='/var/lib/voltra-parity-20261029/volumes/'+uuid)throw Error('Foreign game volume');
 const last=s.power_waits?.at(-1);if(last?.signal!=='stop'||last.container!==c.Id||fs.readFileSync(last.wait,'utf8').trim()!=='0')throw Error('Exact requested stop/Docker wait0 proof missing');
 const logs=docker(['logs',c.Id],true);if(!/^quit\r?$/m.test(logs.toString()))throw Error('Actual publisher quit command acknowledgement missing');
 fs.writeFileSync(path.join(dir,'final-native.log'),logs);s.cleanup={at:new Date().toISOString(),uuid,final_exit:0,final_oom:false,publisher_stop_ack:true};save();
}
if(!s.cleanup.server_removed){await api('/api/application/servers/'+f.server.id,'DELETE');s.cleanup.server_removed=true;save();}
if(!s.cleanup.allocations_removed){
 for(const expected of f.allocations){
  const a=(await api('/api/application/nodes/1/allocations')).data.map(x=>x.attributes).find(a=>a.id===expected.id);
  if(!a||a.server_id!=null||a.ip!=='127.0.0.1'||a.port!==expected.port||!s.lease.ports.includes(a.port))throw Error('Foreign allocation');
  await api('/api/application/nodes/1/allocations/'+a.id,'DELETE');
 }
 s.cleanup.allocations_removed=true;save();
}
if(!s.cleanup.egg_removed){const egg=(await api('/api/admin/eggs/'+f.egg.id)).attributes;if(egg.nest_id!==f.nest.id||egg.uuid!==f.egg.uuid)throw Error('Foreign egg');await api('/api/admin/eggs/'+f.egg.id,'DELETE');s.cleanup.egg_removed=true;save();}
if(!s.cleanup.nest_removed){const nest=(await api('/api/admin/nests/'+f.nest.id)).attributes;if(nest.uuid!==f.nest.uuid||nest.name!=='Campaign Counter-Strike Source native')throw Error('Foreign nest');await api('/api/admin/nests/'+f.nest.id,'DELETE');s.cleanup.nest_removed=true;save();}
if(docker(['ps','-aq','--filter','name='+uuid]).trim())throw Error('Owned container remains');
docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','128m','--memory-swap','128m','--cpus','1','--mount','type=bind,source=/var/lib/voltra-parity-20261029/volumes,target=/volumes,readonly','python:3.12-slim','python3','-B','-c',`from pathlib import Path;assert not Path('/volumes/${uuid}').exists()`]);
const absent=async p=>(await fetch('http://127.0.0.1:18099'+p)).status===404;
if(!await absent('/api/application/servers/'+f.server.id)||!await absent('/api/admin/eggs/'+f.egg.id)||!await absent('/api/admin/nests/'+f.nest.id))throw Error('Fixture API record remains');
s.cleanup.containers_removed=true;s.cleanup.volume_removed=true;s.cleanup.api_absent=true;save();
releaseNative(s.lease.lease_id,'css_native','tested',true);s.cleanup.lease_released=true;save();
fs.writeFileSync('artifacts/game-parity-20261029/css-wave7-native-cleanup.json',JSON.stringify(s.cleanup,null,2)+'\n');console.log(JSON.stringify(s.cleanup));
