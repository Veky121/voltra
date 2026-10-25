import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {api} from './openttd-compat-node.mjs';
const d='.local/thefront-native',s=JSON.parse(fs.readFileSync(d+'/private.json')),n=JSON.parse(fs.readFileSync(s.node_receipt));
const a=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(a.uuid!==s.uuid||a.node!==n.node||s.node_uuid!==n.node_uuid||a.egg!==s.egg_id||a.external_id!=='thefront-native-'+s.request_id||a.limits.memory!==10240||fs.existsSync(d+'/normal-restart-request.json'))throw Error('Exact restart guard');
const inspect=()=>{const r=spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'});if(r.status)throw Error(r.stderr);return JSON.parse(r.stdout)[0];};
const before=inspect().State;if(!before.Running)throw Error('Requires running own generation');
fs.writeFileSync(d+'/normal-restart-request.json',JSON.stringify({uuid:s.uuid,before,at:new Date().toISOString()},null,2),{flag:'wx'});
await api('/api/client/servers/'+s.identifier+'/power','POST',{signal:'restart'});
const deadline=Date.now()+60000;
while(Date.now()<deadline){const after=inspect().State;if(after.Running&&after.StartedAt!==before.StartedAt){fs.writeFileSync(d+'/normal-restart-new-generation.json',JSON.stringify({uuid:s.uuid,before,after,at:new Date().toISOString()},null,2));console.log({before:before.StartedAt,after:after.StartedAt});process.exit(0);}await delay(1000);}
throw Error('Restart new generation not confirmed; no retry');
