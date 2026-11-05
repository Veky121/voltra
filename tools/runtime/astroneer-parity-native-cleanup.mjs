import fs from 'node:fs';
import {api,docker,containers,verifyRuntime,activeLease,releaseNative,digest} from './campaign-native-20261029.mjs';
const id='2b0703e0-e216-4b1a-b48a-0d2afe4f7d00',uuid='ade0b289-f128-4cf9-8f3b-9c0ca4ef94e4',dir='.local/game-parity-20261029/astroneer-native/'+id,file=dir+'/state.json';
const s=JSON.parse(fs.readFileSync(file));const save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');
if(process.argv[2]!=='root-approved-cleanup')throw Error('Explicit root cleanup direction required');
await verifyRuntime();activeLease(id,'astroneer_native');
const queue=JSON.parse(fs.readFileSync('.local/game-parity-20261029/runtime/queue.json'));
if(queue.activation_pause||queue.installer_slot?.lease_id===id)throw Error('Pause or owned installer slot remains');
if(s.server.uuid!==uuid||s.server.id!==35||s.egg.id!==30||s.nest.id!==31||!s.public_ip_probe.restored_at)throw Error('Exact owned/restored fixture required');
const owned=containers().filter(c=>c.Name.includes(uuid));if(owned.some(c=>c.State.Running||c.State.Pid))throw Error('Owned process active');
if(!s.cleanup_server_removed){const a=(await api('/api/application/servers/35')).attributes;if(a.uuid!==uuid||a.node!==1||a.egg!==30||a.container?.startup_command!=='exec python3 .voltra/astroneer-parity.py')throw Error('Owned server drift');await api('/api/application/servers/35','DELETE');s.cleanup_server_removed=true;save();}
s.cleanup_allocations??=[];
for(const allocation of s.allocations){if(s.cleanup_allocations.includes(allocation.id))continue;const a=(await api('/api/application/nodes/1/allocations')).data.map(x=>x.attributes).find(x=>x.id===allocation.id);if(a){if(a.server_id!=null||a.ip!=='127.0.0.1'||a.port!==29101)throw Error('Allocation ownership differs');await api('/api/application/nodes/1/allocations/'+a.id,'DELETE');}s.cleanup_allocations.push(allocation.id);save();}
if(!s.cleanup_egg_removed){const a=(await api('/api/admin/eggs/30')).attributes;if(a.nest_id!==31)throw Error('Egg nest mismatch');await api('/api/admin/eggs/30','DELETE');s.cleanup_egg_removed=true;save();}
if(!s.cleanup_nest_removed){const a=(await api('/api/admin/nests/31')).attributes;if(a.name!=='Campaign Astroneer readiness')throw Error('Nest identity differs');await api('/api/admin/nests/31','DELETE');s.cleanup_nest_removed=true;save();}
if(containers().some(c=>c.Name.includes(uuid)))throw Error('Owned containers remain');
const code=`from pathlib import Path\nimport json,shutil\nroot=Path('/campaign');uuid='${uuid}';rows=[]\nfor category in ('volumes','tmp','machine-id'):\n parent=root/category;target=parent/uuid\n if parent.is_symlink() or target.is_symlink() or target.resolve().parent!=parent.resolve():raise ValueError('Unsafe owned cleanup path')\n if target.exists():\n  if target.is_dir():shutil.rmtree(target)\n  else:target.unlink()\n rows.append({'category':category,'uuid':uuid,'absent':not target.exists()})\nprint(json.dumps(rows))`;
s.cleanup_filesystem=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--memory','256m','--memory-swap','256m','--cpus','1','--mount','type=bind,source=/var/lib/voltra-parity-20261029,target=/campaign','sha256:27b7c9d4f13ca20bb1170148f02095d50a5dfce1f7f2dabf5ca273727e43b7ea','python3','-B','-c',code]));save();
const receipt={at:new Date().toISOString(),uuid,server_removed:true,egg_removed:true,nest_removed:true,allocation_ids:s.cleanup_allocations,filesystem:s.cleanup_filesystem,private_receipts_retained:true,native_completion:false,outcome:'tested'};
fs.writeFileSync(dir+'/cleanup.json',JSON.stringify(receipt,null,2)+'\n');releaseNative(id,'astroneer_native','tested',true);s.lease_released_at=new Date().toISOString();save();const reportFile='artifacts/game-parity-20261029/astroneer-native-readiness.json',r=JSON.parse(fs.readFileSync(reportFile));r.cleanup={...receipt,lease_released:true,receipt_sha256:digest(fs.readFileSync(dir+'/cleanup.json'))};fs.writeFileSync(reportFile,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r.cleanup));


