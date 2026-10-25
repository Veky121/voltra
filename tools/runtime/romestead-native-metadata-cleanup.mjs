import fs from 'node:fs';import {execFileSync} from 'node:child_process';import {api,rows} from './openttd-compat-node.mjs';
const dir='.local/romestead-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),n=JSON.parse(fs.readFileSync(s.node_receipt));
if(s.uuid||s.owner!=='unreal_survival'||s.node!==n.node||s.node_uuid!==n.node_uuid||(await api('/api/application/nodes/'+n.node)).attributes.uuid!==n.node_uuid)throw Error('Not exact metadata-only attempt');
if(rows(await api('/api/application/servers')).some(v=>v.external_id==='romestead-native-'+s.request_id||v.egg===s.egg_id))throw Error('Server record exists; do not delete metadata');
const egg=(await api('/api/admin/eggs/'+s.egg_id)).attributes,nest=(await api('/api/admin/nests/'+s.nest_id)).attributes;
if(egg.nest_id!==s.nest_id||nest.name!=='Romestead isolated '+s.request_id)throw Error('Foreign definitions');
for(const id of s.allocation_ids){const a=rows(await api('/api/admin/nodes/'+s.node+'/allocations')).find(x=>x.id===id);if(!a||a.server_id||a.ip!=='127.0.0.1'||!s.ports.includes(a.port))throw Error('Foreign allocation');await api('/api/application/nodes/'+s.node+'/allocations/'+id,'DELETE');}
await api('/api/admin/eggs/'+s.egg_id,'DELETE');await api('/api/admin/nests/'+s.nest_id,'DELETE');
const absent=async p=>{const r=await fetch('http://127.0.0.1:8088'+p);await r.text();return r.status===404;};
const checks={server_record:!rows(await api('/api/application/servers')).some(v=>v.external_id==='romestead-native-'+s.request_id||v.egg===s.egg_id),egg:await absent('/api/admin/eggs/'+s.egg_id),nest:await absent('/api/admin/nests/'+s.nest_id),allocations:!rows(await api('/api/admin/nodes/'+s.node+'/allocations')).some(a=>s.allocation_ids.includes(a.id))};
if(!Object.values(checks).every(Boolean))throw Error('Incomplete cleanup');
fs.writeFileSync(dir+'/metadata-create-failure.json',JSON.stringify({http_status:502,cause:'Remote server config422: Steam automatic updates must be enabled or disabled.',native_install_started:false,server_created:false,checks,at:new Date().toISOString()},null,2)+'\n');
execFileSync(process.execPath,['tools/runtime/batch-queue.mjs','release',JSON.stringify({lease_id:s.lease_id,owner:s.owner,outcome:'blocked',resources_removed:true})],{windowsHide:true,stdio:'pipe'});
console.log({checks,lease_released:true,native_attempt:false});
