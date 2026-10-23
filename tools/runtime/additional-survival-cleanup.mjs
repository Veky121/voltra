import fs from'node:fs';import{execFileSync}from'node:child_process';import{api,rows}from'./openttd-compat-node.mjs';
const dir=process.argv[2];if(!/^\.local\/additional-survival\/barotrauma(?:-development)?$/.test(dir||''))throw Error('Specify owned Barotrauma receipt directory');
const s=JSON.parse(fs.readFileSync(dir+'/private.json'));const server=(await api('/api/application/servers/'+s.internal_id)).attributes;
const nest=(await api('/api/application/nests/'+s.nest_id)).attributes,egg=(await api('/api/admin/eggs/'+s.egg_id)).attributes;
if(server.uuid!==s.uuid||server.node!==147||server.egg!==s.egg_id||egg.nest_id!==s.nest_id||nest.name!=='Barotrauma isolated acceptance '+s.request_id)throw Error('Owned identity mismatch');
if((await api('/api/client/servers/'+s.identifier+'/resources')).attributes.current_state!=='offline')throw Error('Stop the owned native game first');
let allocations=rows(await api('/api/admin/nodes/147/allocations'));
for(let i=0;i<s.ports.length;i++){const a=allocations.find(x=>x.id===s.allocation_ids[i]);if(!a||a.port!==s.ports[i]||a.ip!=='192.168.178.89')throw Error('Allocation changed');}
const marker=dir+'/cleanup-request.json';if(fs.existsSync(marker))throw Error('Cleanup already requested; observe instead');
fs.writeFileSync(marker,JSON.stringify({uuid:s.uuid,requested_at:new Date().toISOString()}));
await api('/api/application/servers/'+s.internal_id,'DELETE');
for(const id of s.allocation_ids){allocations=rows(await api('/api/admin/nodes/147/allocations'));if(allocations.find(x=>x.id===id)?.assigned)throw Error('Allocation not released');await api('/api/admin/nodes/147/allocations','DELETE',{allocations:[id]});}
await api('/api/admin/eggs/'+s.egg_id,'DELETE');await api('/api/admin/nests/'+s.nest_id,'DELETE');
console.log({owned_resources_deleted:true,uuid:s.uuid});
