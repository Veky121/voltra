import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {api,rows} from './openttd-compat-node.mjs';
import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/aapg-native',{receipt:s,node}=await ownedStoppedServer(dir+'/private.json');
if(s.internal_id!==551||s.uuid!=='5d09b841-5642-48fa-9287-a65eed284e0e'||s.egg_id!==1422||s.nest_id!==405||s.lease_id!=='6b725999-bb33-4d8d-bcda-31681f7b6b9a'||JSON.stringify(s.allocation_ids)!=='[991,992,993]')throw Error('Root-authorized disposable identity differs');
const exclusive=rows(await api('/api/application/servers')).filter(candidate=>candidate.egg===s.egg_id);
if(exclusive.length!==1||exclusive[0].uuid!==s.uuid)throw Error('Fixture egg is not exclusive');
const archiveChecks={};
for(const tag of ['first-stopped-full','second-stopped','third-stopped']){
 const expected=JSON.parse(fs.readFileSync(dir+'/archives/'+tag+'.json'));
 const actual=crypto.createHash('sha256').update(fs.readFileSync(dir+'/archives/'+tag+'.tar.gz')).digest('hex');
 if(actual!==expected.sha256)throw Error('Private state archive changed: '+tag);
 archiveChecks[tag]={sha256:actual,files:expected.files,bytes:expected.bytes};
}
fs.writeFileSync(dir+'/cleanup-preflight.json',JSON.stringify({uuid:s.uuid,exclusive_servers:1,archives:archiveChecks,at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(server.uuid!==s.uuid||server.node!==s.node||server.egg!==s.egg_id||server.external_id!=='aapg-native-'+s.request_id||s.owner!=='game_batch_inventory'||s.node!==node.node||s.node_uuid!==node.node_uuid)throw Error('Owned cleanup mismatch');
for(const name of [s.uuid,s.uuid+'_installer']){
 const r=spawnSync('docker',['inspect',name],{windowsHide:true,encoding:'utf8'});
 if(r.status===0&&JSON.parse(r.stdout)[0].State.Running)throw Error('Owned native process/installer still running');
 if(name===s.uuid&&r.status===0&&(JSON.parse(r.stdout)[0].State.ExitCode!==0||JSON.parse(r.stdout)[0].State.OOMKilled))throw Error('Final native status is not zero/noOOM');
}
await api('/api/application/servers/'+s.internal_id,'DELETE');
for(const id of s.allocation_ids){
 const allocation=rows(await api('/api/admin/nodes/'+s.node+'/allocations')).find(a=>a.id===id);
 if(!allocation||allocation.server_id||allocation.ip!=='127.0.0.1'||!s.ports.includes(allocation.port))throw Error('Owned allocation not safely unassigned');
 await api('/api/application/nodes/'+s.node+'/allocations/'+id,'DELETE');
}
const egg=(await api('/api/admin/eggs/'+s.egg_id)).attributes,nest=(await api('/api/admin/nests/'+s.nest_id)).attributes;
if(egg.nest_id!==s.nest_id||nest.name!=='AAPG isolated '+s.request_id)throw Error('Owned temporary definitions mismatch');
await api('/api/admin/eggs/'+s.egg_id,'DELETE');await api('/api/admin/nests/'+s.nest_id,'DELETE');
const absent=async route=>{const r=await fetch('http://127.0.0.1:8088'+route,{signal:AbortSignal.timeout(10000)});await r.text();return r.status===404;};
const checks={server:await absent('/api/application/servers/'+s.internal_id),egg:await absent('/api/admin/eggs/'+s.egg_id),nest:await absent('/api/admin/nests/'+s.nest_id),allocations:!rows(await api('/api/admin/nodes/'+s.node+'/allocations')).some(a=>s.allocation_ids.includes(a.id))};
for(const[name,key]of [[s.uuid,'container'],[s.uuid+'_installer','installer']])checks[key]=spawnSync('docker',['inspect',name],{windowsHide:true,encoding:'utf8'}).status!==0;
const code=`from pathlib import Path\nassert not Path('/volumes/${s.uuid}').exists()\nprint('Owned volume absent')`;
const r=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root},target=/volumes,readonly`,'python:3.13-slim','python3','-B','-c',code],{windowsHide:true,encoding:'utf8'});checks.volume=r.status===0;
if(!Object.values(checks).every(Boolean))throw Error('Owned resource cleanup incomplete '+JSON.stringify(checks));
fs.writeFileSync(dir+'/cleanup.json',JSON.stringify({uuid:s.uuid,node:s.node,checks,resource_ids:{server:s.internal_id,egg:s.egg_id,nest:s.nest_id,allocations:s.allocation_ids,ports:s.ports,lease_id:s.lease_id},archives:archiveChecks,at:new Date().toISOString()},null,2)+'\n');
execFileSync(process.execPath,['tools/runtime/batch-queue.mjs','release',JSON.stringify({lease_id:s.lease_id,owner:'game_batch_inventory',outcome:'tested',resources_removed:true})],{windowsHide:true,stdio:'pipe'});
console.log({uuid:s.uuid,checks,lease_released:true});
