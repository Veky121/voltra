import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {api} from './openttd-compat-node.mjs';
const d='.local/thefront-native',s=JSON.parse(fs.readFileSync(d+'/private.json')),tag=process.argv[2];
if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Tag');
const a=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(a.uuid!==s.uuid||a.external_id!=='thefront-native-'+s.request_id)throw Error('Identity');
const inspect=()=>{const r=spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'});if(r.status)throw Error(r.stderr);return JSON.parse(r.stdout)[0];};
const started=inspect().State.StartedAt,deadline=Date.now()+90000,observations=[];
while(Date.now()<deadline){
 const v=inspect();if(v.State.StartedAt!==started)throw Error('Unexpected generation');
 const r=spawnSync('docker',['logs','--since',started,s.uuid],{windowsHide:true,encoding:'utf8',maxBuffer:4e6});if(r.status)throw Error(r.stderr);
 const text=r.stdout+r.stderr,state=(await api('/api/client/servers/'+s.identifier+'/resources')).attributes;
 const loaded=text.split(/\r?\n/).filter(x=>/LogSave:.*(?:restore|load game|load world|load.*file|read.*file)/i.test(x));
 observations.push({at:new Date().toISOString(),panel:state.current_state,memory_bytes:state.resources.memory_bytes,running:v.State.Running});
 if(!v.State.Running||text.includes('FServerInfoData_HasPWD_b:false')){
  fs.writeFileSync(d+'/'+tag+'-ready-watch.json',JSON.stringify({started,observations,state:v.State,panel:state.current_state,loaded,native_session:text.includes('FServerInfoData_HasPWD_b:false')},null,2));
  console.log({started,panel:state.current_state,running:v.State.Running,loaded,native_session:text.includes('FServerInfoData_HasPWD_b:false')});
  if(!v.State.Running)throw Error('Native exited before readiness');
  process.exit(0);
 }
 await delay(2000);
}
throw Error('Bounded readiness not observed');
