import fs from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import {api,rows} from './openttd-compat-node.mjs';
const dir='.local/onset-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),node=JSON.parse(fs.readFileSync(s.node_receipt));
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(server.uuid!==s.uuid||server.node!==s.node||server.egg!==s.egg_id||server.external_id!=='onset-native-'+s.request_id||s.owner!=='unreal_survival'||s.node!==node.node||s.node_uuid!==node.node_uuid)throw Error('Owned cleanup mismatch');
for(const name of [s.uuid,s.uuid+'_installer']){
 const r=spawnSync('docker',['inspect',name],{windowsHide:true,encoding:'utf8'});
 if(r.status===0&&JSON.parse(r.stdout)[0].State.Running)throw Error('Owned native process/installer still running');
 if(name===s.uuid&&r.status===0&&JSON.parse(r.stdout)[0].State.ExitCode!==0)throw Error('Final native status is not zero');
}
const dbInspect=spawnSync('docker',['inspect',s.db_container],{windowsHide:true,encoding:'utf8'});
if(dbInspect.status)throw Error('Cannot establish owned DB identity');
const db=JSON.parse(dbInspect.stdout)[0];
if(db.Name!=='/'+node.container+'-onset-'+s.identifier+'-db'||db.Config.Labels['voltra.acceptance.owner']!=='unreal_survival'||db.Config.Labels['voltra.acceptance.server']!==s.uuid||db.Config.Labels['voltra.acceptance.request']!==s.request_id||db.HostConfig.NetworkMode!==s.db_network||Object.keys(db.HostConfig.PortBindings??{}).length)throw Error('Foreign DB cleanup rejected');
const dbStop=spawnSync('docker',['stop','--time','20',s.db_container],{windowsHide:true,encoding:'utf8',timeout:30000});if(dbStop.status)throw Error('Owned DB stop failed');
const dbStopped=JSON.parse(spawnSync('docker',['inspect',s.db_container],{windowsHide:true,encoding:'utf8'}).stdout)[0];
if(dbStopped.State.Running||dbStopped.State.ExitCode!==0)throw Error('Owned DB did not stop cleanly');
const dbRemove=spawnSync('docker',['rm',s.db_container],{windowsHide:true,encoding:'utf8'});if(dbRemove.status)throw Error('Owned DB removal failed');
fs.writeFileSync(dir+'/db-cleanup.json',JSON.stringify({container:s.db_container,exit_code:dbStopped.State.ExitCode,removed:true,at:new Date().toISOString()},null,2)+'\n');
await api('/api/application/servers/'+s.internal_id,'DELETE');
for(const id of s.allocation_ids){
 const allocation=rows(await api('/api/admin/nodes/'+s.node+'/allocations')).find(a=>a.id===id);
 if(!allocation||allocation.server_id||allocation.ip!=='127.0.0.1'||!s.ports.includes(allocation.port))throw Error('Owned allocation not safely unassigned');
 await api('/api/application/nodes/'+s.node+'/allocations/'+id,'DELETE');
}
const egg=(await api('/api/admin/eggs/'+s.egg_id)).attributes,nest=(await api('/api/admin/nests/'+s.nest_id)).attributes;
if(egg.nest_id!==s.nest_id||nest.name!=='Onset isolated '+s.request_id)throw Error('Owned temporary definitions mismatch');
await api('/api/admin/eggs/'+s.egg_id,'DELETE');await api('/api/admin/nests/'+s.nest_id,'DELETE');
const absent=async route=>{const r=await fetch('http://127.0.0.1:8088'+route,{signal:AbortSignal.timeout(10000)});await r.text();return r.status===404;};
const checks={server:await absent('/api/application/servers/'+s.internal_id),egg:await absent('/api/admin/eggs/'+s.egg_id),nest:await absent('/api/admin/nests/'+s.nest_id),allocations:!rows(await api('/api/admin/nodes/'+s.node+'/allocations')).some(a=>s.allocation_ids.includes(a.id))};
for(const[name,key]of [[s.uuid,'container'],[s.uuid+'_installer','installer'],[s.db_container,'temporary_db']])checks[key]=spawnSync('docker',['inspect',name],{windowsHide:true,encoding:'utf8'}).status!==0;
const code=`from pathlib import Path\nassert not Path('/volumes/${s.uuid}').exists()\nprint('Owned volume absent')`;
const r=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root},target=/volumes,readonly`,'python:3.13-slim','python3','-B','-c',code],{windowsHide:true,encoding:'utf8'});checks.volume=r.status===0;
if(!Object.values(checks).every(Boolean))throw Error('Owned resource cleanup incomplete '+JSON.stringify(checks));
fs.writeFileSync(dir+'/cleanup.json',JSON.stringify({uuid:s.uuid,node:s.node,checks,at:new Date().toISOString()},null,2)+'\n');
execFileSync(process.execPath,['tools/runtime/batch-queue.mjs','release',JSON.stringify({lease_id:s.lease_id,owner:'unreal_survival',outcome:'tested',resources_removed:true})],{windowsHide:true,stdio:'pipe'});
console.log({uuid:s.uuid,checks,lease_released:true});
