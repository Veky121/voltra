import fs from 'node:fs';import {api} from './openttd-compat-node.mjs';
const dir='.local/solace-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),command=process.argv[2];
if(!['help','save','status'].includes(command))throw Error('Bounded console probe only');
const v=(await api('/api/application/servers/'+s.internal_id)).attributes;if(v.uuid!==s.uuid||v.egg!==s.egg_id||s.owner!=='game_batch_inventory')throw Error('Foreign fixture');
await api('/api/client/servers/'+s.identifier+'/command','POST',{command});fs.appendFileSync(dir+'/commands.jsonl',JSON.stringify({command,at:new Date().toISOString()})+'\n');console.log({command,submitted:true});
