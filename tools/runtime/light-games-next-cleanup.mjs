import fs from 'node:fs';import {spawnSync,execFileSync} from 'node:child_process';import {api,rows} from './openttd-compat-node.mjs';
const game=process.argv[2],dir='.local/light-games-next/'+game,s=JSON.parse(fs.readFileSync(dir+'/private.json'));
if(!['banana','nuclear','puck'].includes(game))throw Error('Invalid game');
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(server.uuid!==s.uuid||server.node!==202||server.egg!==s.egg_id||server.external_id!=='light-games-next-'+s.request_id)throw Error('Owned server identity mismatch');
for(const id of [s.uuid,s.uuid+'_installer']){const out=spawnSync('docker',['inspect',id],{encoding:'utf8',windowsHide:true});if(out.status===0&&JSON.parse(out.stdout)[0].State.Running)throw Error('Owned process remains running');}
await api('/api/application/servers/'+s.internal_id,'DELETE');
for(const id of s.allocation_ids){const a=rows(await api('/api/admin/nodes/202/allocations')).find(a=>a.id===id);if(!a||a.server_id)throw Error('Allocation not unassigned');await api('/api/application/nodes/202/allocations/'+id,'DELETE');}
await api('/api/admin/eggs/'+s.egg_id,'DELETE');await api('/api/admin/nests/'+s.nest_id,'DELETE');
const check=spawnSync('docker',['run','--rm','--network','none','--mount','type=bind,source=/var/lib/voltra-batch-20261023/volumes,target=/volumes,readonly','python:3.13-slim','python','-c',`from pathlib import Path; assert not Path('/volumes/${s.uuid}').exists(); print('Owned volume absent')`],{encoding:'utf8',windowsHide:true});if(check.status!==0)throw Error('Owned volume remains');
if(spawnSync('docker',['inspect',s.uuid],{encoding:'utf8',windowsHide:true}).status===0)throw Error('Owned container remains');
const result={uuid:s.uuid,owned_resources_removed:true,at:new Date().toISOString()};fs.writeFileSync(dir+'/cleanup.json',JSON.stringify(result,null,2));
execFileSync(process.execPath,['tools/runtime/batch-queue.mjs','release',JSON.stringify({lease_id:s.lease_id,owner:'game_batch_inventory',outcome:process.argv.includes('--development')?'released':'tested',resources_removed:true})],{stdio:'inherit',windowsHide:true});console.log(result);
