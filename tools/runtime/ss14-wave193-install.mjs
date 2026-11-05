import fs from 'node:fs';import {spawnSync} from 'node:child_process';import * as c from './campaign-native-20261029.mjs';
const dir='artifacts/game-parity-20261029/wave193-ss14-live';
for(let i=0;i<40;i++){const q=JSON.parse(fs.readFileSync(c.runtime+'/queue.json'));if(!q.installer_slot&&!c.campaignInstallers().length){const r=spawnSync(process.execPath,['tools/runtime/ss14-wave193-live.mjs','install'],{stdio:'inherit',env:{...process.env,SS14_INSTALL_GO:'1'}});process.exit(r.status??1)}console.log('QUEUED installer '+(q.installer_slot?.owner||'container'));await new Promise(r=>setTimeout(r,15000));}
throw Error('Installer queue bounded wait expired');
