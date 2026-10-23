// Remove only resources named in a stopped DST acceptance receipt.
// Usage: node tools/runtime/cleanup-dst.mjs receipt.json
import fs from 'node:fs';
const state=JSON.parse(fs.readFileSync(process.argv[2]));
const api=async(path,method='GET',body)=>{const response=await fetch('http://127.0.0.1:8088'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await response.text();if(!response.ok)throw Error('Owned cleanup API HTTP '+response.status);return text?JSON.parse(text):null;};
const server=(await api('/api/application/servers/'+state.internal_id)).attributes,nest=(await api('/api/application/nests/'+state.nest_id)).attributes,egg=(await api('/api/admin/eggs/'+state.egg_id)).attributes;
if(server.uuid!==state.uuid||server.node!==147||server.egg!==state.egg_id||egg.nest_id!==state.nest_id||nest.name!=='DST isolated acceptance '+state.request_id)throw Error('Owned cleanup identity mismatch');
if((await api('/api/client/servers/'+state.identifier+'/resources')).attributes.current_state!=='offline')throw Error('Stop both native shards before cleanup');
const expected=state.original_allocation_ids?[...state.original_allocation_ids.map((id,index)=>({id,port:23560+index})),...state.lan_allocation_ids.map((id,index)=>({id,port:10998+index}))]:state.allocation_ids.map((id,index)=>({id,port:[10998,10999,23562,23563,23564,23565][index]}));
let rows=(await api('/api/admin/nodes/147/allocations')).data.map(item=>item.attributes);
for(const owned of expected){const row=rows.find(item=>item.id===owned.id);if(!row||row.ip!=='192.168.178.89'||row.port!==owned.port)throw Error('Owned allocation changed');}
await api('/api/application/servers/'+state.internal_id,'DELETE');
for(const owned of expected){
 rows=(await api('/api/admin/nodes/147/allocations')).data.map(item=>item.attributes);const row=rows.find(item=>item.id===owned.id);
 if(!row||row.assigned||row.ip!=='192.168.178.89'||row.port!==owned.port)throw Error('Owned allocation not released');
 await api('/api/admin/nodes/147/allocations','DELETE',{allocations:[owned.id]});
}
await api('/api/admin/eggs/'+state.egg_id,'DELETE');await api('/api/admin/nests/'+state.nest_id,'DELETE');
console.log({owned_dst_resources_removed:true,allocations:expected.length});
