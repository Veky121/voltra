import fs from 'node:fs';
import path from 'node:path';
import {runtime,verifyRuntime,activeLease,docker,api,releaseNative} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'cs2d-native'),file=path.join(dir,'state.json'),s=JSON.parse(fs.readFileSync(file));
await verifyRuntime();activeLease(s.lease.lease_id,'cs2d_native');
const f=s.fixture,uuid=f.server.uuid,save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');
if(!s.cleanup?.definitions_removed){
const server=(await api('/api/application/servers/'+f.server.id)).attributes;
if(server.uuid!==uuid||server.egg!==f.egg.id||server.nest!==f.nest.id||server.node!==1||server.name!=='Campaign CS2D native')throw Error('Foreign fixture');
const c=JSON.parse(docker(['inspect',uuid]))[0];
if(c.State.Running||c.State.ExitCode!==0||c.State.OOMKilled)throw Error('Expected owned clean stopped native container');
if(c.Mounts.find(m=>m.Destination==='/home/container')?.Source!=='/var/lib/voltra-parity-20261029/volumes/'+uuid)throw Error('Foreign game volume');
fs.writeFileSync(path.join(dir,'final-native.log'),docker(['logs',c.Id],true));
s.cleanup={at:new Date().toISOString(),uuid,final_exit:c.State.ExitCode,final_oom:c.State.OOMKilled};save();
await api('/api/application/servers/'+f.server.id,'DELETE');s.cleanup.server_removed=true;save();
for(const expected of f.allocations){
 const a=(await api('/api/application/nodes/1/allocations')).data.map(x=>x.attributes).find(a=>a.id===expected.id);
 if(!a||a.server_id!=null||a.ip!=='127.0.0.1'||a.port!==expected.port||!s.lease.ports.includes(a.port))throw Error('Foreign allocation');
 await api('/api/application/nodes/1/allocations/'+a.id,'DELETE');
}
s.cleanup.allocations_removed=true;save();
const egg=(await api('/api/admin/eggs/'+f.egg.id)).attributes,nest=(await api('/api/admin/nests/'+f.nest.id)).attributes;
if(egg.nest_id!==f.nest.id||nest.uuid!==f.nest.uuid||nest.name!=='Campaign CS2D native')throw Error('Foreign definitions');
await api('/api/admin/eggs/'+f.egg.id,'DELETE');await api('/api/admin/nests/'+f.nest.id,'DELETE');
s.cleanup.definitions_removed=true;save();
}
for(const name of [uuid,uuid+'_installer']){let exists=true;try{docker(['inspect',name]);}catch{exists=false;}if(exists)throw Error('Owned container remains');}
docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','128m','--memory-swap','128m','--cpus','1','--mount','type=bind,source=/var/lib/voltra-parity-20261029/volumes,target=/volumes,readonly','sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704','python3','-B','-c',`from pathlib import Path; assert not Path('/volumes/${uuid}').exists()`]);
s.cleanup.containers_removed=true;s.cleanup.volume_removed=true;
const absent=async p=>(await fetch('http://127.0.0.1:18099'+p)).status===404;
if(!await absent('/api/application/servers/'+f.server.id)||!await absent('/api/admin/eggs/'+f.egg.id)||!await absent('/api/admin/nests/'+f.nest.id))throw Error('Fixture API record remains');
s.cleanup.api_absent=true;save();
releaseNative(s.lease.lease_id,'cs2d_native','tested',true);s.cleanup.lease_released=true;save();
fs.writeFileSync('artifacts/game-parity-20261029/cs2d-wave5-native-cleanup.json',JSON.stringify(s.cleanup,null,2)+'\n');
console.log(JSON.stringify(s.cleanup));
