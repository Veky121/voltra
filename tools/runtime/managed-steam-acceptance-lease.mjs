import fs from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const managedNativeGames={
 'palworld-native':{path:'palworld/egg-palworld.json',memory_mib:9216,disk_mib:32768,ports:1},
 'palworld-proton':{path:'palworld/egg-palworld-proton.json',memory_mib:9216,disk_mib:32768,ports:1},
 '7days':{path:'7_days_to_die/egg-7-days-to-die.json',memory_mib:9216,disk_mib:33280,ports:4},
 'satisfactory':{path:'satisfactory/egg-satisfactory.json',memory_mib:13312,disk_mib:20992,ports:2},
};

// Read-only admission guard. It neither claims resources nor treats a saved
// receipt as proof that its lease is still active in the shared atomic queue.
export function managedNativeLease(state,leaseID,game){
 const expected=managedNativeGames[game];if(!expected)throw Error('Unsupported exact managed game');
 const active=state.claims.filter(row=>row.status==='active');
 if(active.length>7||active.reduce((sum,row)=>sum+row.memory_mib,0)>20480||active.reduce((sum,row)=>sum+row.disk_mib,0)+20480>131072)throw Error('Shared resource budget exceeded');
 const lease=active.find(row=>row.lease_id===leaseID&&row.owner==='managed_steam_bridge'&&row.game===expected.path);
 if(!lease)throw Error('No current owned active lease for exact recipe');
 if(!Number.isSafeInteger(lease.memory_mib)||lease.memory_mib<expected.memory_mib||!Number.isSafeInteger(lease.disk_mib)||lease.disk_mib<expected.disk_mib)throw Error('Lease excludes required game/control-process budget');
 if(!Array.isArray(lease.ports)||lease.ports.length<expected.ports||lease.ports.some(port=>!Number.isSafeInteger(port)||port<28010||port>28999)||new Set(lease.ports).size!==lease.ports.length)throw Error('Lease ports are invalid');
 if(game==='7days'&&lease.ports.some((port,index)=>index>0&&port!==lease.ports[0]+index))throw Error('7Days requires consecutive game allocations');
 const others=new Set(active.filter(row=>row!==lease).flatMap(row=>row.ports));
 if(lease.ports.some(port=>others.has(port)))throw Error('Lease overlaps another active worker');
 return structuredClone(lease);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [game,leaseID]=process.argv.slice(2);
 const state=JSON.parse(fs.readFileSync('.local/game-batch/queue.json','utf8'));
 console.log(JSON.stringify(managedNativeLease(state,leaseID,game)));
}
