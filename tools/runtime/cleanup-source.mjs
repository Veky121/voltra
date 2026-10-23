// Delete only a stopped disposable Source acceptance server identified by receipt.
import fs from 'node:fs';import {execFileSync} from 'node:child_process';
const receiptPath=process.argv[2],s=JSON.parse(fs.readFileSync(receiptPath));
if(s.node!==202||!['css','tf2','hl2dm','fof','blackmesa','nmrih','l4d','l4d2','iosoccer','gmod','contagion','openfortress','sourcecoop'].includes(s.kind)||!s.request_id||s.allocation_ids.length!==(['l4d','l4d2'].includes(s.kind)?1:3))throw Error('Invalid owned Source receipt');
const api=async(p,method='GET',body)=>{const r=await fetch('http://127.0.0.1:8088'+p,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const raw=await r.text();if(!r.ok)throw Error(p+' HTTP '+r.status);return raw?JSON.parse(raw):null};
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;
const nest=(await api('/api/application/nests/'+s.nest_id)).attributes;
const egg=(await api('/api/admin/eggs/'+s.egg_id)).attributes;
if(server.uuid!==s.uuid||server.node!==s.node||server.egg!==s.egg_id||egg.nest_id!==s.nest_id||nest.name!=='Source batch acceptance '+s.request_id||server.external_id!=='source-acceptance-'+s.request_id)throw Error('Owned Source identity mismatch');
if((await api('/api/client/servers/'+s.identifier+'/resources')).attributes.current_state!=='offline')throw Error('Native server must be stopped');
const allocations=(await api('/api/admin/nodes/202/allocations')).data.map(x=>x.attributes);
for(const [i,id]of s.allocation_ids.entries()){const a=allocations.find(a=>a.id===id);if(!a||a.ip!=='127.0.0.1'||a.port!==s.ports[i])throw Error('Owned allocation mismatch');}
const inspect=JSON.parse(execFileSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'}))[0];
if(inspect.State.Running||!inspect.Mounts.some(m=>m.Source==='/var/lib/voltra-batch-20261023/volumes/'+s.uuid&&m.Destination==='/home/container'))throw Error('Owned container mismatch');
await api('/api/application/servers/'+s.internal_id,'DELETE');
for(const id of s.allocation_ids)await api('/api/admin/nodes/202/allocations','DELETE',{allocations:[id]});
await api('/api/admin/eggs/'+s.egg_id,'DELETE');await api('/api/admin/nests/'+s.nest_id,'DELETE');
fs.writeFileSync(receiptPath+'.cleanup.json',JSON.stringify({uuid:s.uuid,deleted_at:new Date().toISOString(),server_deleted:true,allocations_deleted:s.allocation_ids,egg_deleted:s.egg_id,nest_deleted:s.nest_id},null,2));
console.log({source_owned_api_resources_deleted:true,uuid:s.uuid});
