import fs from 'node:fs';import {api} from './openttd-compat-node.mjs';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/virtual-worlds/nwn',{receipt}=await ownedStoppedServer(dir+'/private.json');
if(!fs.existsSync(dir+'/final-source-before-load-proof.json'))throw Error('Final source snapshot required');
const environment={SAVE_SLOT:'7',MODULE_NAME:'MUST_NOT_LOAD_FRESH',SERVER_NAME:'Voltra NWN Reload $517077',MAX_CLIENTS:'12',MIN_LEVEL:'3',MAX_LEVEL:'40',PVP:'1',DIFFICULTY:'4',PAUSE_AND_PLAY:'0',ELC:'0',ILR:'0',ONE_PARTY:'1',SERVER_VAULT:'0',IS_PUBLIC:'0',PLAYER_PASSWORD:''};
await api('/api/application/servers/'+receipt.internal_id+'/startup','PATCH',{environment});
fs.writeFileSync(dir+'/load-settings.json',JSON.stringify({uuid:receipt.uuid,at:new Date().toISOString(),environment},null,2));
console.log({uuid:receipt.uuid,phase:'saved-slot7 and native controls configured while stopped; no start'});
