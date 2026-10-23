// Delete only this receipt's stopped disposable resources, then prove absence.
import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api,rows} from './openttd-compat-node.mjs';
const dir='.local/additional-survival/enshrouded'+(process.argv.includes('--development')?'-development':''),s=JSON.parse(fs.readFileSync(dir+'/private.json')),n=JSON.parse(fs.readFileSync(s.node_receipt));
if(s.node!==202||n.root!=='/var/lib/voltra-batch-20261023')throw Error('Owned local boundary mismatch');
if(!process.argv.includes('--observe')){
const server=(await api('/api/application/servers/'+s.internal_id)).attributes,egg=(await api('/api/admin/eggs/'+s.egg_id)).attributes,nest=(await api('/api/application/nests/'+s.nest_id)).attributes;
if(s.node!==202||n.root!=='/var/lib/voltra-batch-20261023'||server.uuid!==s.uuid||server.node!==202||server.egg!==s.egg_id||egg.nest_id!==s.nest_id||nest.name!=='Enshrouded isolated acceptance '+s.request_id||server.external_id!=='enshrouded-acceptance-'+s.request_id)throw Error('Owned cleanup identity mismatch');
if((await api('/api/client/servers/'+s.identifier+'/resources')).attributes.current_state!=='offline'||server.status!==null)throw Error('Stop native and finish installer before cleanup');
const allocations=rows(await api('/api/admin/nodes/202/allocations'));
for(const [index,id] of s.allocation_ids.entries()){const a=allocations.find(a=>a.id===id);if(!a||a.ip!=='127.0.0.1'||a.port!==s.ports[index])throw Error('Owned allocation mismatch');}
const inspect=spawnSync('docker',['inspect',s.uuid],{encoding:'utf8'});if(inspect.status)throw Error('Owned container missing before cleanup');const info=JSON.parse(inspect.stdout)[0];
if(info.State.Running||!info.Mounts.some(m=>m.Source===n.volume_root+'/'+s.uuid&&m.Destination==='/home/container'))throw Error('Owned stopped container boundary mismatch');
if(fs.existsSync(dir+'/cleanup-request.json'))throw Error('Cleanup already requested; inspect same request');
fs.writeFileSync(dir+'/cleanup-request.json',JSON.stringify({uuid:s.uuid,requested_at:new Date().toISOString()}));
await api('/api/application/servers/'+s.internal_id,'DELETE');
for(const id of s.allocation_ids)await api('/api/admin/nodes/202/allocations','DELETE',{allocations:[id]});
await api('/api/admin/eggs/'+s.egg_id,'DELETE');await api('/api/admin/nests/'+s.nest_id,'DELETE');
}else if(JSON.parse(fs.readFileSync(dir+'/cleanup-request.json')).uuid!==s.uuid)throw Error('Cleanup observation identity mismatch');
const check=spawnSync('docker',['run','--rm','--pull','never','--network','none','--read-only','--memory','64m','--mount',`type=bind,source=${n.volume_root},target=/snapshot,readonly`,'python:3.13-slim','python3','-B','-c','import pathlib,sys;sys.exit(pathlib.Path(sys.argv[1]).exists())','/snapshot/'+s.uuid],{encoding:'utf8'});
if(check.status)throw Error('Owned volume removal not confirmed');
const remaining=spawnSync('docker',['ps','-aq','--filter','name=^/'+s.uuid+'(_installer)?$'],{encoding:'utf8'});
if(remaining.status||remaining.stdout.trim())throw Error('Owned container removal not confirmed');
for(const route of ['/api/application/servers/'+s.internal_id,'/api/admin/eggs/'+s.egg_id,'/api/application/nests/'+s.nest_id]){
 const response=await fetch('http://127.0.0.1:8088'+route,{signal:AbortSignal.timeout(10000)});await response.text();if(response.status!==404)throw Error('Owned API resource absence not confirmed');
}
if(rows(await api('/api/admin/nodes/202/allocations')).some(a=>s.allocation_ids.includes(a.id)))throw Error('Owned allocation absence not confirmed');
const proof={uuid:s.uuid,node:202,server_deleted:true,volume_deleted:true,containers_deleted:true,allocation_ids:s.allocation_ids,egg_id:s.egg_id,nest_id:s.nest_id,observed_at:new Date().toISOString()};
fs.writeFileSync(dir+'/cleanup.json',JSON.stringify(proof,null,2)+'\n');console.log(proof);
