import fs from 'node:fs';
import path from 'node:path';
import {verifyRuntime,profileFromRuntime,digest,hostCapacity,assertBudget,policy,runtime} from './campaign-native-20261029.mjs';
const out='artifacts/game-parity-20261029/resume-wave2-aloft-20261030-owner';
const receipt=await verifyRuntime();
const recipe='aloft/egg-aloft.json';
const profile=profileFromRuntime(recipe,receipt);
const queue=JSON.parse(fs.readFileSync(path.join(runtime,'queue.json')));
const capacity=hostCapacity();
let budget;try{assertBudget(queue,{memory_mib:4096,disk_mib:20480},capacity);budget='fits current budget; no lease claimed because licensed acquisition is unavailable';}catch(e){budget=e.message;}
const files=['internal/panel/game_library/scripts/aloft-preflight.py','internal/panel/game_library/scripts/steam-template.py','internal/panel/game_library/scripts/unreal-survival-next.py','internal/panel/game_library/scripts/unreal-survival-next-release.json'];
const identities=files.map(file=>({file,served_sha256:fs.existsSync(path.join(receipt.snapshot,file))?digest(fs.readFileSync(path.join(receipt.snapshot,file))):null,working_sha256:digest(fs.readFileSync(file))}));
const steam=profile.egg.scripts.installation.script;
const data={at:new Date().toISOString(),recipe,runtime:receipt,profile_sha256:digest(JSON.stringify(profile)),startup:profile.egg.startup,identities,budget,capacity,active_reserved_mib:queue.claims.filter(c=>c.status==='active').reduce((s,c)=>s+c.memory_mib,0),installer_slot_occupied:!!queue.installer_slot,private_transport_explicitly_refused:steam.includes('Private Steam credentials are not enabled until native command parsing is verified'),historical_row:JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/HISTORY-RECONCILIATION-20261030.json')).rows.find(r=>r.path===recipe),no_claim:true,no_runtime_mutations:true};
fs.writeFileSync(path.join(out,'admission-and-identity.json'),JSON.stringify(data,null,2)+'\n');
fs.writeFileSync(path.join(out,'profile-fragment.json'),JSON.stringify({[recipe]:profile},null,2)+'\n');
console.log(JSON.stringify({budget,identities,private_transport_explicitly_refused:data.private_transport_explicitly_refused,startup:data.startup}));


