import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {runtime,api,docker,verifyRuntime,activeLease,releaseInstaller,releaseNative,removeReaderFixture} from './campaign-native-20261029.mjs';
const file=path.join(runtime,'craftopia-wave5-native/state.json'),state=JSON.parse(fs.readFileSync(file));
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');
const owner='craftopia_native_wave5',fixture=state.fixture,uuid=fixture?.server?.uuid;
await verifyRuntime();activeLease(state.lease.lease_id,owner);
if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Activation paused');
if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(uuid))throw Error('Owned UUID required');
const ids=docker(['ps','-aq','--filter','name='+uuid]).trim().split(/\s+/).filter(Boolean),containers=ids.length?JSON.parse(docker(['inspect',...ids])):[];
if(containers.some(c=>c.State.Running))throw Error('Stop owned game and await actual installer terminal before cleanup');
if(state.reader&&!state.reader.user_removed)await removeReaderFixture(state.reader,async reader=>{state.reader=reader;save();});
if(!state.server_removed){const server=(await api('/api/application/servers/'+fixture.server.id)).attributes;if(server.uuid!==uuid||server.egg!==fixture.egg.id||server.node!==1)throw Error('Owned server identity mismatch');await api('/api/application/servers/'+fixture.server.id,'DELETE');state.server_removed=true;save();}
state.allocations_removed??=[];
for(const allocation of fixture.allocations){
 if(state.allocations_removed.includes(allocation.id))continue;
 const actual=(await api('/api/application/nodes/1/allocations')).data.map(v=>v.attributes).find(a=>a.id===allocation.id);
 if(!actual||actual.server_id!=null||actual.ip!=='127.0.0.1'||!state.lease.ports.includes(actual.port))throw Error('Owned unassigned allocation required');
 await api('/api/application/nodes/1/allocations/'+allocation.id,'DELETE');state.allocations_removed.push(allocation.id);save();
}
if(!state.egg_removed){const egg=(await api('/api/admin/eggs/'+fixture.egg.id)).attributes;if(egg.nest_id!==fixture.nest.id)throw Error('Owned egg/nest mismatch');await api('/api/admin/eggs/'+fixture.egg.id,'DELETE');state.egg_removed=true;save();}
if(!state.nest_removed){const nest=(await api('/api/admin/nests/'+fixture.nest.id)).attributes;if(nest.name!=='Campaign Craftopia native')throw Error('Owned nest name mismatch');await api('/api/admin/nests/'+fixture.nest.id,'DELETE');state.nest_removed=true;save();}
if(docker(['ps','-aq','--filter','name='+uuid]).trim())throw Error('Owned containers remain');
const code=`from pathlib import Path\nimport json,shutil\nroot=Path('/campaign')\nuuid='${uuid}'\nchecks=[]\nfor category in ('volumes','tmp','machine-id'):\n parent=root/category\n target=parent/uuid\n if parent.is_symlink() or target.is_symlink() or target.resolve().parent!=parent.resolve():raise RuntimeError('Unsafe campaign cleanup target')\n if target.exists():\n  if target.is_dir():shutil.rmtree(target)\n  else:target.unlink()\n checks.append({'category':category,'uuid':uuid,'absent':not target.exists()})\nprint(json.dumps(checks))`;
const image='sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704';
const cleanupArgs=['run','--rm','--pull','never','--network','none','--memory','128m','--memory-swap','128m','--cpus','1','--mount','type=bind,source=/var/lib/voltra-parity-20261029,target=/campaign',image,'python','-B','-c',code];
const cleanup=spawnSync('docker',['--context','desktop-linux',...cleanupArgs],{encoding:'utf8',windowsHide:true});
if(cleanup.status!==0){state.cleanup_failures??=[];state.cleanup_failures.push({at:new Date().toISOString(),status:cleanup.status,stdout:cleanup.stdout,stderr:cleanup.stderr});save();throw Error('Owned filesystem cleanup failed: '+cleanup.stderr);}
state.filesystem_cleanup=JSON.parse(cleanup.stdout);save();
if(!state.slot_released){releaseInstaller(state.slot);state.slot_released=true;save();}
const outcome=state.install_outcome?.success?'tested':'blocked';state.lease=releaseNative(state.lease.lease_id,owner,outcome,true);state.lease_released=true;state.cleanup_at=new Date().toISOString();save();
const report={at:state.cleanup_at,uuid,server_removed:state.server_removed,egg_removed:state.egg_removed,nest_removed:state.nest_removed,allocations_removed:state.allocations_removed,filesystem:state.filesystem_cleanup,lease_outcome:outcome,installer_slot_released:state.slot_released,native_completion:false};
fs.writeFileSync('artifacts/game-parity-20261029/craftopia-wave5-cleanup.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
