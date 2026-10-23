// Read-only Panel guards; caller still runs the normal native installer afterward.
import fs from 'node:fs';import {dirname,join} from 'node:path';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';import {core} from './steam-game-cache-common.mjs';
const [receiptPath,identity]=process.argv.slice(2);if(!/^[a-f0-9]{64}$/.test(identity||''))throw Error('Specify owned receipt and immutable object SHA256');
const {receipt,node}=await ownedStoppedServer(receiptPath);
const output=join(dirname(receiptPath),'game-content-cache-stage.json');if(fs.existsSync(output))throw Error('Existing warm-stage provenance; inspect it instead of staging again');
if(receipt.lease_id){const state=JSON.parse(fs.readFileSync('.local/game-batch/queue.json'));if(!state.claims.some(c=>c.lease_id===receipt.lease_id&&c.status==='active'))throw Error('Owned active resource reservation required');}
const inspect=spawnSync('docker',['inspect',receipt.uuid],{encoding:'utf8'});if(inspect.status)throw Error('Owned stopped container required for explicit UID/GID');const info=JSON.parse(inspect.stdout)[0];
if(!/^\d+:\d+$/.test(info.Config.User)||!info.Mounts.some(m=>m.Source===node.volume_root+'/'+receipt.uuid&&m.Destination==='/home/container'))throw Error('Owned numeric identity/volume mismatch');
const [uid,gid]=info.Config.User.split(':');
const report={...core(['seed','--id',identity,'--destination','/volume','--uid',uid,'--gid',gid],['--mount',`type=bind,source=${node.volume_root}/${receipt.uuid},target=/volume`]),uuid:receipt.uuid,node:202,staged_at:new Date().toISOString(),cold_download:false};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(report);
