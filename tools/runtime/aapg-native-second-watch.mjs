import fs from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const dir='.local/aapg-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),resume=process.argv.includes('--resume'),file=dir+(resume?'/second-watch-resumed.json':'/second-watch.json');
if(fs.existsSync(file))throw Error('Existing first watcher; observe same job');
if(s.uuid!=='5d09b841-5642-48fa-9287-a65eed284e0e'||s.owner!=='game_batch_inventory')throw Error('Unexpected owned first native');
const state={uuid:s.uuid,phase:'starting',at:new Date().toISOString(),launch_timeout_seconds:180,stable_seconds:30};
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');save();
const run=(name,args)=>execFileSync(process.execPath,['tools/runtime/aapg-native-'+name+'.mjs',...args],{windowsHide:true,encoding:'utf8',maxBuffer:2e6});
if(!resume)run('power',['start','second']);const request=JSON.parse(fs.readFileSync(dir+'/start-second.json')),requestedAt=Date.parse(request.at);
let started=null,readyAt=null,terminal=null;const deadline=requestedAt+180000;
while(Date.now()<deadline){
 const out=spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'});if(out.status){if(!started&&out.stderr.includes('No such')){await delay(500);continue;}throw Error('Owned native container unavailable');}const current=JSON.parse(out.stdout)[0];
 if(!started&&Date.parse(current.State.StartedAt)>=requestedAt)started=current.State.StartedAt;
 if(!started){await delay(500);continue;}
 state.started_at=started;save();
 const logs=spawnSync('docker',['logs','--since',started,s.uuid],{windowsHide:true,encoding:'utf8',maxBuffer:6e6});const text=(logs.stdout??'')+(logs.stderr??'');fs.writeFileSync(dir+'/second-current-generation.log',text);
 if(!current.State.Running){terminal=current.State;state.phase='early-exit';break;}
 if(/(?:please|must|need to|requires?).{0,45}(?:accept.{0,20}(?:agreement|terms|eula)|(?:account|license key)\s+(?:login|required))/i.test(text)){state.phase='prerequisite-hold';break;}
 if(text.includes('Finished loading level')&&!readyAt){
  readyAt=Date.now();state.ready_observed_at=new Date(readyAt).toISOString();state.phase='stable-observation';state.query_attempted=true;save();
  const query=spawnSync(process.execPath,['tools/runtime/aapg-native-query.mjs','second'],{windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:2e6});
  state.query_exit=query.status;state.query_error=query.error?.message??null;
  fs.writeFileSync(dir+'/second-query-process.log',(query.stdout??'')+(query.stderr??''),{flag:'wx'});save();
 }
 if(readyAt&&Date.now()-readyAt>=30000){state.phase='stable';break;}
 await delay(2000);
}
state.started_at=started;state.stable_observed_ms=readyAt?Date.now()-readyAt:0;
if(!terminal){
 if(state.phase==='stable')run('live',['second']);
 state.before_stop_phase=state.phase;run('power',['stop','second']);state.phase='stopping';save();
 const stopDeadline=Date.now()+60000;
 while(Date.now()<stopDeadline){const out=spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'});if(out.status)throw Error('Owned native stop state unavailable');const current=JSON.parse(out.stdout)[0];if(!current.State.Running){terminal=current.State;break;}await delay(2000);}
}
state.terminal=terminal;state.phase=terminal?'stopped':'stop-pending';state.completed_at=new Date().toISOString();save();
run('observe',['second-stop']);
if(started){const logs=spawnSync('docker',['logs','--since',started,s.uuid],{windowsHide:true,encoding:'utf8',maxBuffer:6e6});fs.writeFileSync(dir+'/second-terminal-generation.log',(logs.stdout??'')+(logs.stderr??''),{flag:'wx'});}
console.log({phase:state.phase,ready:!!readyAt,stable_observed_ms:state.stable_observed_ms,raw_exit:terminal?.ExitCode,oom:terminal?.OOMKilled});
if(!terminal||state.before_stop_phase!=='stable')process.exitCode=1;
