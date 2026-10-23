// Native starts must never use the temporary offline preparation reservation.
import fs from'node:fs';import{execFileSync}from'node:child_process';import{api}from'./openttd-compat-node.mjs';
const file='.local/additional-survival/enshrouded/private.json',s=JSON.parse(fs.readFileSync(file));
const state=JSON.parse(fs.readFileSync('.local/game-batch/queue.json'));
const lease=state.claims.find(c=>c.lease_id===s.lease_id&&c.owner==='game_batch_inventory'&&c.status==='active');
if(!lease||lease.memory_mib<12288||lease.disk_mib<32768||!s.ports.every(p=>lease.ports.includes(p)))throw Error('Reacquire full native memory/disk/ports before boot');
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(server.uuid!==s.uuid||server.node!==202||server.status!==null||server.limits.memory<12288)throw Error('Restore and confirm full panel memory before boot');
execFileSync(process.execPath,['tools/runtime/game-power.mjs',file,'start'],{stdio:'inherit'});
