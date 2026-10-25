import fs from 'node:fs';import {ownedStoppedServer} from './cache-owned-server.mjs';import {api} from './openttd-compat-node.mjs';
const {receipt:s}=await ownedStoppedServer('.local/romestead-native/private.json');const v=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(s.owner!=='unreal_survival'||v.egg!==s.egg_id||v.external_id!=='romestead-native-'+s.request_id)throw Error('Foreign fixture');
await api('/api/application/servers/'+s.internal_id+'/startup','PATCH',{environment:{AUTO_UPDATE:'0'}});
fs.writeFileSync('.local/romestead-native/update-disabled.json',JSON.stringify({uuid:s.uuid,AUTO_UPDATE:'0',at:new Date().toISOString()},null,2)+'\n');console.log('Owned native AUTO_UPDATE disabled for actual startup proof');
