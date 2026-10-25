import fs from'node:fs';import{spawnSync}from'node:child_process';import{setTimeout as delay}from'node:timers/promises';import{api}from'./openttd-compat-node.mjs';
const d='.local/mordhau-native',s=JSON.parse(fs.readFileSync(d+'/private.json')),n=JSON.parse(fs.readFileSync(s.node_receipt));
const a=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(a.uuid!==s.uuid||a.node!==n.node||s.node_uuid!==n.node_uuid||a.egg!==s.egg_id||a.external_id!=='mordhau-native-'+s.request_id||a.limits.memory!==4096||fs.existsSync(d+'/normal-restart-request.json'))throw Error('Exact own restart guard');
const inspect=()=>{const r=spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'});if(r.status){if(r.stderr.includes('No such'))return null;throw Error('Docker inspect unavailable');}return JSON.parse(r.stdout)[0].State;};
const before=inspect();if(!before?.Running)throw Error('Requires running own generation');
fs.writeFileSync(d+'/normal-restart-request.json',JSON.stringify({uuid:s.uuid,before,at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
await api('/api/client/servers/'+s.identifier+'/power','POST',{signal:'restart'});
const deadline=Date.now()+60000;let missing_samples=0;
while(Date.now()<deadline){const after=inspect();if(!after)missing_samples++;if(after?.Running&&after.StartedAt!==before.StartedAt){fs.writeFileSync(d+'/normal-restart-new-generation.json',JSON.stringify({uuid:s.uuid,before,after,missing_samples,at:new Date().toISOString()},null,2)+'\n');console.log({before:before.StartedAt,after:after.StartedAt,missing_samples});process.exit(0);}await delay(500);}
throw Error('New generation not confirmed; no retry');
