import fs from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const dir='.local/citadel-native',s=JSON.parse(fs.readFileSync(dir+'/private.json'));
const resume=process.argv.includes('--resume');
const file=dir+(resume?'/reload-watch-resumed.json':'/reload-watch.json');if(fs.existsSync(file))throw Error('Existing bounded reload watcher; observe same job');
const state={uuid:s.uuid,phase:'starting',at:new Date().toISOString(),readiness_timeout_seconds:180,stable_seconds:30};
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');save();
const run=(name,args)=>execFileSync(process.execPath,['tools/runtime/citadel-native-'+name+'.mjs',...args],{windowsHide:true,encoding:'utf8',maxBuffer:2e6});
if(!resume)run('power',['start','reload']);
const request=JSON.parse(fs.readFileSync(dir+'/start-reload.json'));
const requestedAt=Date.parse(request.at);
let readyAt=null,started=null,terminal=null;const deadline=requestedAt+180000;
while(Date.now()<deadline){
 const inspected=spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'});if(inspected.status)throw Error('Owned reload container unavailable');
 const current=JSON.parse(inspected.stdout)[0];
 if(!started&&Date.parse(current.State.StartedAt)>=requestedAt)started=current.State.StartedAt;
 if(!started){await delay(500);continue;}
 const logs=spawnSync('docker',['logs',...(started?['--since',started]:[]),s.uuid],{windowsHide:true,encoding:'utf8',maxBuffer:6e6});
 const output=(logs.stdout??'')+(logs.stderr??'');fs.writeFileSync(dir+'/reload-current-generation.log',output);
 if(!current.State.Running&&started){terminal=current.State;state.phase='early-exit';break;}
 if(/(?:please|must|need to|requires?).{0,45}(?:accept.{0,20}(?:agreement|terms|eula)|(?:account|license key)\s+(?:login|required))/i.test(output)){state.phase='prerequisite-hold';break;}
 if(output.includes('Steam Server initialized and registered with UWorks')&&!readyAt){readyAt=Date.now();state.ready_observed_at=new Date(readyAt).toISOString();state.phase='stable-observation';save();}
 if(readyAt&&Date.now()-readyAt>=30000){state.phase='stable';break;}
 await delay(2000);
}
state.started_at=started;state.stable_observed_ms=readyAt?Date.now()-readyAt:0;
if(!terminal){
 if(state.phase==='stable')run('live',['reload']);
 state.before_stop_phase=state.phase;run('power',['stop','reload']);state.phase='stopping';save();
 const stopDeadline=Date.now()+60000;
 while(Date.now()<stopDeadline){const inspected=spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'});if(inspected.status)throw Error('Owned native state unavailable after Stop');const current=JSON.parse(inspected.stdout)[0];if(!current.State.Running){terminal=current.State;break;}await delay(2000);}
}
state.terminal=terminal;state.phase=terminal?'stopped':'stop-still-pending';state.completed_at=new Date().toISOString();save();
run('observe',[resume?'reload-resumed-stop':'reload-stop']);
console.log({phase:state.phase,ready:!!readyAt,stable_observed_ms:state.stable_observed_ms,raw_exit:terminal?.ExitCode,oom:terminal?.OOMKilled});
if(!terminal||state.before_stop_phase!=='stable')process.exitCode=1;
