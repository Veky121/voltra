import fs from 'node:fs';import {transact,release} from './batch-queue.mjs';
const dir='.local/additional-survival/enshrouded',s=JSON.parse(fs.readFileSync(dir+'/private.json')),cleanup=JSON.parse(fs.readFileSync(dir+'/cleanup.json')),acceptance=JSON.parse(fs.readFileSync('artifacts/enshrouded-live-acceptance.json'));
if(cleanup.uuid!==s.uuid||acceptance.uuid!==s.uuid||!cleanup.volume_deleted||!cleanup.containers_deleted||!cleanup.server_deleted)throw Error('Owned final acceptance/cleanup mismatch');
const lease=transact('.local/game-batch/queue.json',state=>release(state,s.lease_id,'game_batch_inventory','tested',true));
fs.writeFileSync('artifacts/enshrouded-cleanup.json',JSON.stringify({...cleanup,lease_status:lease.status,lease_finished_at:lease.finished_at},null,2)+'\n');
console.log({owned_cleanup_verified:true,lease_status:lease.status,freed_memory_mib:lease.memory_mib,freed_disk_mib:lease.disk_mib});
