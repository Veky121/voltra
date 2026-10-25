// Only documented no-player native acceptance commands; never a shell command.
import fs from 'node:fs';import {api} from './openttd-compat-node.mjs';
const s=JSON.parse(fs.readFileSync('.local/romestead-native/private.json')),command=process.argv[2];
if(!['list','save','quicksave'].includes(command))throw Error('Only bounded documented acceptance commands');
const v=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(s.owner!=='unreal_survival'||v.uuid!==s.uuid||v.node!==s.node||v.egg!==s.egg_id||v.external_id!=='romestead-native-'+s.request_id)throw Error('Foreign native fixture');
await api('/api/client/servers/'+s.identifier+'/command','POST',{command});
fs.appendFileSync('.local/romestead-native/commands.jsonl',JSON.stringify({uuid:s.uuid,command,at:new Date().toISOString()})+'\n');console.log({command,submitted:true});
