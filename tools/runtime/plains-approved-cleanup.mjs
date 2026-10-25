import fs from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import {api,rows} from './openttd-compat-node.mjs';
import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/plains-native-approved',{receipt:s,node}=await ownedStoppedServer(dir+'/private.json');
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(server.uuid!==s.uuid||server.node!==s.node||server.egg!==s.egg_id||server.external_id!=='plains-native-'+s.request_id||s.owner!=='unreal_survival'||s.node!==node.node||s.node_uuid!==node.node_uuid)throw Error('Owned cleanup mismatch');
const metadataName='voltra-plains-metadata-'+s.uuid.slice(0,8);if(spawnSync('docker',['inspect',metadataName],{windowsHide:true,stdio:'pipe'}).status===0)throw Error('Owned metadata utility still exists');
for(const name of [s.uuid,s.uuid+'_installer']){
 const r=spawnSync('docker',['inspect',name],{windowsHide:true,encoding:'utf8'});
 if(r.status===0&&JSON.parse(r.stdout)[0].State.Running)throw Error('Owned native process/installer still running');
 if(name===s.uuid){if(r.status!==0)throw Error('Exact stopped Plains container required');const state=JSON.parse(r.stdout)[0].State,proof=JSON.parse(fs.readFileSync(dir+'/reload-stop.json'));if(state.Running||state.Pid!==0||state.ExitCode!==0||state.OOMKilled||proof.uuid!==s.uuid||proof.state.StartedAt!==state.StartedAt||proof.state.FinishedAt!==state.FinishedAt||proof.state.ExitCode!==0)throw Error('Exact root-reviewed raw0 terminal required');}

}
if(s.internal_id!==539||s.uuid!=='87bb7510-2fa8-4e58-945a-7beb3800efa0'||s.lease_id!=='ddc88d35-6ad2-4594-968f-504ab3ad1bfe')throw Error('Exact authorized fixture required');
const q=JSON.parse(fs.readFileSync('.local/game-batch/queue.json')),lease=q.claims.find(x=>x.lease_id===s.lease_id);if(!lease||lease.owner!==s.owner||lease.game!==s.path||lease.status!=='active'||lease.memory_mib!==4096||lease.disk_mib!==16384)throw Error('Owned lease drift');
const review=JSON.parse(fs.readFileSync('artifacts/plains-reload-native-live-root-review.json'));if(review.uuid!==s.uuid||review.records.length!==26)throw Error('Root review mismatch');
const verifyCode=`from pathlib import Path
import json,hashlib,stat
r=Path('/v');rows=json.loads(${JSON.stringify(JSON.stringify(review.records))});actual={}
for row in rows:
 p=r/row['path'];assert not p.is_symlink() and p.resolve().is_relative_to(r.resolve());st=p.stat();assert stat.S_ISREG(st.st_mode);b=p.read_bytes();actual[row['path']]={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'mode':oct(st.st_mode&0o777),'uid':st.st_uid,'gid':st.st_gid}
print(json.dumps(actual))`;
const check=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/v,readonly`,'python:3.13-slim','python3','-B','-c',verifyCode],{windowsHide:true,encoding:'utf8'});if(check.status)throw Error('Root reviewed identities changed');const actual=JSON.parse(check.stdout);
for(const row of review.records){const{path,...expected}=row;if(JSON.stringify(actual[path])!==JSON.stringify(expected))throw Error('Live root reviewed file drift '+path);const archive=path.startsWith('.voltra/')?dir+'/installed-source-retention/'+path.slice(8):path==='EULA.txt'?dir+'/publisher-terms/EULA.txt':dir+'/native-state-after-reload/'+path;if(!fs.existsSync(archive)||fs.statSync(archive).size!==row.bytes)throw Error('Private archive absent '+path);}
fs.writeFileSync(dir+'/precleanup-reviewed-identities.json',JSON.stringify({at:new Date().toISOString(),uuid:s.uuid,records:actual},null,2)+'\n',{flag:'wx'});
const foreign=rows(await api('/api/application/servers')).filter(x=>x.id!==s.internal_id&&(x.egg===s.egg_id||x.nest===s.nest_id));if(foreign.length)throw Error('Shared definitions detected');const eggs=rows(await api('/api/admin/eggs')).filter(x=>x.nest_id===s.nest_id);if(eggs.length!==1||eggs[0].id!==s.egg_id)throw Error('Nest not exclusive');
await api('/api/application/servers/'+s.internal_id,'DELETE');
for(const id of s.allocation_ids){
 const allocation=rows(await api('/api/admin/nodes/'+s.node+'/allocations')).find(a=>a.id===id);
 if(!allocation||allocation.server_id||allocation.ip!=='127.0.0.1'||!s.ports.includes(allocation.port))throw Error('Owned allocation not safely unassigned');
 await api('/api/application/nodes/'+s.node+'/allocations/'+id,'DELETE');
}
const egg=(await api('/api/admin/eggs/'+s.egg_id)).attributes,nest=(await api('/api/admin/nests/'+s.nest_id)).attributes;
if(egg.nest_id!==s.nest_id||nest.name!=='Plains isolated '+s.request_id)throw Error('Owned temporary definitions mismatch');
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
