// Delete only this worker's stopped acceptance server and exact owned resources.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const receiptPath=process.argv[2],s=JSON.parse(fs.readFileSync(receiptPath));
if(s.node!==202||!['cs16_modules','cs16','half_life','rehlds'].includes(s.kind)||!s.request_id||s.allocation_ids.length!==2||!s.lease_id)throw Error('Invalid owned GoldSrc receipt');
if(fs.existsSync(receiptPath+'.cleanup-request.json'))throw Error('Cleanup already requested; observe existing operation');
const api=async(p,method='GET',body)=>{const r=await fetch('http://127.0.0.1:8088'+p,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const raw=await r.text();if(!r.ok)throw Error(p+' HTTP '+r.status);return raw?JSON.parse(raw):null};
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;
const nest=(await api('/api/application/nests/'+s.nest_id)).attributes;
const egg=(await api('/api/admin/eggs/'+s.egg_id)).attributes;
if(server.uuid!==s.uuid||server.node!==s.node||server.egg!==s.egg_id||egg.nest_id!==s.nest_id||nest.name!=='GoldSrc batch acceptance '+s.request_id||server.external_id!=='goldsrc-acceptance-'+s.request_id)throw Error('Owned identity mismatch');
if((await api('/api/client/servers/'+s.identifier+'/resources')).attributes.current_state!=='offline')throw Error('Gracefully stop the own server first');
const allocations=(await api('/api/admin/nodes/202/allocations')).data.map(row=>row.attributes);
for(const [index,id] of s.allocation_ids.entries()){
 const allocation=allocations.find(row=>row.id===id);
 if(!allocation||allocation.ip!=='127.0.0.1'||allocation.port!==s.ports[index])throw Error('Owned allocation mismatch');
}
const inspect=spawnSync('docker',['inspect',s.uuid],{encoding:'utf8'});
if(inspect.status)throw Error('Own container inspection failed');
const info=JSON.parse(inspect.stdout)[0];
if(info.State.Running||!info.Mounts.some(m=>m.Source==='/var/lib/voltra-batch-20261023/volumes/'+s.uuid&&m.Destination==='/home/container'))throw Error('Owned stopped volume mismatch');
const marker={uuid:s.uuid,requested_at:new Date().toISOString(),phase:'requesting'};
const save=()=>fs.writeFileSync(receiptPath+'.cleanup-request.json',JSON.stringify(marker,null,2)+'\n');save();
await api('/api/application/servers/'+s.internal_id,'DELETE');marker.phase='server_deleted';save();
for(const id of s.allocation_ids)await api('/api/admin/nodes/202/allocations','DELETE',{allocations:[id]});
await api('/api/admin/eggs/'+s.egg_id,'DELETE');await api('/api/admin/nests/'+s.nest_id,'DELETE');
marker.phase='api_resources_deleted';save();
console.log({goldsrc_owned_api_resources_deleted:true,uuid:s.uuid});
