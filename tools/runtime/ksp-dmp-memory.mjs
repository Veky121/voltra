import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {transact,resize} from './batch-queue.mjs';import {api} from './openttd-compat-node.mjs';
const dir='.local/ksp-games/dmp',s=JSON.parse(fs.readFileSync(dir+'/private.json')),server=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(server.uuid!==s.uuid||server.node!==202)throw Error('Owned identity mismatch');
const state=JSON.parse(spawnSync('docker',['inspect',s.uuid],{encoding:'utf8'}).stdout)[0].State;if(state.Running)throw Error('DMP is running');
fs.copyFileSync(dir+'/observation.json',dir+'/development-1gib-resource-floor.json');
transact('.local/game-batch/queue.json',q=>resize(q,{lease_id:s.lease_id,owner:'game_batch_inventory',memory_mib:2048,stopped_confirmed:true},{memory_mib:20480}));
await api('/api/application/servers/'+s.internal_id+'/build','PATCH',{allocation:server.allocation,limits:{memory:2048,swap:0,disk:4096,io:500,cpu:200},feature_limits:{databases:0,allocations:0,backups:1}});
if((await api('/api/application/servers/'+s.internal_id)).attributes.limits.memory!==2048)throw Error('Panel memory restoration failed');console.log('Owned DMP lease and Panel limit restored to2GiB before native boot.');
