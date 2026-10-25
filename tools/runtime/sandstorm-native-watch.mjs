import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {api} from './openttd-compat-node.mjs';
const d='.local/sandstorm-native',s=JSON.parse(fs.readFileSync(d+'/private.json')),tag=process.argv[2];
if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Tag');
const a=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(a.uuid!==s.uuid||a.external_id!=='sandstorm-native-'+s.request_id)throw Error('Identity');
const inspect=()=>{const r=spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'});if(r.status)throw Error(r.stderr);return JSON.parse(r.stdout)[0];};
let first;const creationDeadline=Date.now()+10000;
while(Date.now()<creationDeadline){const r=spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'});if(r.status===0){const candidate=JSON.parse(r.stdout)[0];if(candidate.State.Running){first=candidate;break;}}await delay(200);}
if(!first)throw Error('Requested own container not created within bounded observation');
const started=first.State.StartedAt,deadline=Date.now()+180000,samples=[];let ready=false,state;
while(Date.now()<deadline){const info=inspect();state=info.State;if(state.StartedAt!==started)throw Error('Unexpected generation');const a=(await api('/api/client/servers/'+s.identifier+'/resources')).attributes;samples.push({at:new Date().toISOString(),state:a.current_state,...a.resources});const r=spawnSync('docker',['logs','--since',started,s.uuid],{windowsHide:true,encoding:'utf8',maxBuffer:8e6});if(r.status)throw Error(r.stderr);const log=r.stdout+r.stderr;ready=log.includes('LogGameState: Match State Changed from LoadingAssets to WaitingToStart');fs.writeFileSync(d+'/watch-'+tag+'.json',JSON.stringify({started,actual_container_memory_limit_bytes:info.HostConfig.Memory,samples,state,ready,at:new Date().toISOString()},null,2));if(ready||!state.Running)break;await delay(2000);}
console.log({started,ready,state,panel:samples.at(-1)?.state,peak_sample_bytes:Math.max(...samples.map(x=>x.memory_bytes??0)),deadline_seconds:180});
