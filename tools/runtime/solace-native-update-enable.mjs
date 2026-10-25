import fs from 'node:fs';import {api} from './openttd-compat-node.mjs';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/solace-native',{receipt:s}=await ownedStoppedServer(dir+'/private.json');if(s.owner!=='game_batch_inventory'||s.path!=='solace_crafting/egg-solace-crafting.json')throw Error('Foreign candidate');
const file=dir+'/auto-update-enabled.json';if(fs.existsSync(file))throw Error('Already submitted');
const profile=JSON.parse(fs.readFileSync(dir+'/source-profile-final-source.json'));
if(profile.egg.variables.find(v=>v.env_variable==='AUTO_UPDATE')?.default_value!=='1')throw Error('Original default changed');
await api('/api/application/servers/'+s.internal_id+'/startup','PATCH',{environment:{AUTO_UPDATE:'1'}});
fs.writeFileSync(file,JSON.stringify({uuid:s.uuid,AUTO_UPDATE:'1',at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});console.log({original_auto_update_enabled:true});
