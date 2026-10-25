import fs from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import {api,rows} from './openttd-compat-node.mjs';
import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/craftopia-native',{receipt:s,node}=await ownedStoppedServer(dir+'/private.json');
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(server.uuid!==s.uuid||server.node!==s.node||server.egg!==s.egg_id||server.external_id!=='craftopia-native-'+s.request_id||s.owner!=='unreal_survival'||s.node!==node.node||s.node_uuid!==node.node_uuid)throw Error('Owned cleanup mismatch');
const metadataName='voltra-craftopia-metadata-'+s.uuid.slice(0,8);if(spawnSync('docker',['inspect',metadataName],{windowsHide:true,stdio:'pipe'}).status===0)throw Error('Owned metadata utility still exists');
for(const name of [s.uuid,s.uuid+'_installer']){
 const r=spawnSync('docker',['inspect',name],{windowsHide:true,encoding:'utf8'});
 if(r.status===0&&JSON.parse(r.stdout)[0].State.Running)throw Error('Owned native process/installer still running');
 if(name===s.uuid){if(r.status!==0)throw Error('Exact stopped Craftopia container required');const state=JSON.parse(r.stdout)[0].State,proof=JSON.parse(fs.readFileSync(dir+'/final-stop.json'));if(state.Running||state.Pid!==0||state.ExitCode!==0||state.OOMKilled||proof.uuid!==s.uuid||proof.state.StartedAt!==state.StartedAt||proof.state.FinishedAt!==state.FinishedAt||proof.state.ExitCode!==0)throw Error('Exact owned Craftopia0 terminal proof required');if(!proof.logs.includes('Shutdown handler: cleanup.'))throw Error('Missing actual Unity shutdown cleanup marker');}
}
await api('/api/application/servers/'+s.internal_id,'DELETE');
for(const id of s.allocation_ids){
 const allocation=rows(await api('/api/admin/nodes/'+s.node+'/allocations')).find(a=>a.id===id);
 if(!allocation||allocation.server_id||allocation.ip!=='127.0.0.1'||!s.ports.includes(allocation.port))throw Error('Owned allocation not safely unassigned');
 await api('/api/application/nodes/'+s.node+'/allocations/'+id,'DELETE');
}
const egg=(await api('/api/admin/eggs/'+s.egg_id)).attributes,nest=(await api('/api/admin/nests/'+s.nest_id)).attributes;
if(egg.nest_id!==s.nest_id||nest.name!=='Craftopia isolated '+s.request_id)throw Error('Owned temporary definitions mismatch');
await api('/api/admin/eggs/'+s.egg_id,'DELETE');await api('/api/admin/nests/'+s.nest_id,'DELETE');
const absent=async route=>{const r=await fetch('http://127.0.0.1:8088'+route,{signal:AbortSignal.timeout(10000)});await r.text();return r.status===404;};
const checks={server:await absent('/api/application/servers/'+s.internal_id),egg:await absent('/api/admin/eggs/'+s.egg_id),nest:await absent('/api/admin/nests/'+s.nest_id),allocations:!rows(await api('/api/admin/nodes/'+s.node+'/allocations')).some(a=>s.allocation_ids.includes(a.id))};
for(const[name,key]of [[s.uuid,'container'],[s.uuid+'_installer','installer']])checks[key]=spawnSync('docker',['inspect',name],{windowsHide:true,encoding:'utf8'}).status!==0;
const code=`from pathlib import Path\nassert not Path('/volumes/${s.uuid}').exists()\nprint('Owned volume absent')`;
const r=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root},target=/volumes,readonly`,'python:3.13-slim','python3','-B','-c',code],{windowsHide:true,encoding:'utf8'});checks.volume=r.status===0;checks.metadata_utility=spawnSync('docker',['inspect',metadataName],{windowsHide:true,stdio:'pipe'}).status!==0;
if(!Object.values(checks).every(Boolean))throw Error('Owned resource cleanup incomplete '+JSON.stringify(checks));
fs.writeFileSync(dir+'/cleanup.json',JSON.stringify({uuid:s.uuid,node:s.node,checks,at:new Date().toISOString()},null,2)+'\n');
execFileSync(process.execPath,['tools/runtime/batch-queue.mjs','release',JSON.stringify({lease_id:s.lease_id,owner:'unreal_survival',outcome:'tested',resources_removed:true})],{windowsHide:true,stdio:'pipe'});
console.log({uuid:s.uuid,checks,lease_released:true});

