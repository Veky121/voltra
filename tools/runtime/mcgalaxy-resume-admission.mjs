import fs from 'node:fs';
import {verifyRuntime,claimNative,root} from './campaign-native-20261029.mjs';
const dir=root+'/artifacts/game-parity-20261029/mcgalaxy-resume';
fs.mkdirSync(dir,{recursive:true});
const receipt={at:new Date().toISOString(),recipe:'classicube/mcgalaxy/egg-classi-cube--m-g-c.json',foundation:JSON.parse(fs.readFileSync(root+'/artifacts/game-parity-20261029/resume-wave1-foundation.json'))};
try {
 if(receipt.foundation.status!=='foundation-ready')throw Error('Definitive foundation is not ready');
 receipt.runtime=await verifyRuntime();
 receipt.lease=claimNative({owner:'mcgalaxy_resume_20261030',game:receipt.recipe,memory_mib:1024,disk_mib:8192,ports:1});
}catch(e){receipt.blocker=e.message;}
fs.writeFileSync(dir+'/admission.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({lease:receipt.lease,blocker:receipt.blocker}));
