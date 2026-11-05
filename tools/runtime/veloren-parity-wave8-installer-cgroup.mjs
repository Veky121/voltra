import fs from 'node:fs';
import {activeLease,docker} from './campaign-native-20261029.mjs';
const state=JSON.parse(fs.readFileSync('.local/game-parity-20261029/veloren-root-native/state.json'));activeLease(state.lease.lease_id,state.lease.owner);
const query=process.argv.includes('--query'),id=query?state.query_build?.id:state.installer_proof?.id;if(!/^[a-f0-9]{64}$/.test(id))throw Error('Exact observed owned installer/probe builder required');
const actual=docker(['exec',id,'sh','-c','cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max']);
if(actual.trim()!==`${query?'1073741824':'4294967296'}\n0\n100000 100000`)throw Error('Actual cgroups differ from reviewed memory/zero-swap1CPU');
const proof={at:new Date().toISOString(),server_uuid:state.server.uuid,container_id:id,lease_id:state.lease.lease_id,cgroups:actual,scope:query?'Actual separate1GiB probe builder within idle4GiB game reservation; not a Wings installer proof':'Actual live Wings-created installer, independent of HostConfig metadata'};
fs.writeFileSync('artifacts/game-parity-20261029/veloren-wave8-'+(query?'query':'installer')+'-cgroups.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
