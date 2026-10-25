import fs from 'node:fs';import {api} from './openttd-compat-node.mjs';
const s=JSON.parse(fs.readFileSync('.local/romestead-native/private.json')),v=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(v.uuid!==s.uuid||v.external_id!=='romestead-native-'+s.request_id)throw Error('Foreign fixture');
const out={startup:v.startup,container_startup:v.container?.startup_command,canonical:JSON.parse(fs.readFileSync('.local/romestead-native/source-profile-current.json')).egg.startup};console.log(out);
