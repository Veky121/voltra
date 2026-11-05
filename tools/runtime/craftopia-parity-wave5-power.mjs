// Actual owned pilot power transitions; subsequent cycles explicitly AUTO_UPDATE0.
import fs from 'node:fs';
import path from 'node:path';
import {runtime,api,docker,digest,verifyRuntime,profileFromRuntime,activeLease,observePower} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'craftopia-wave5-native'),file=path.join(dir,'state.json'),state=JSON.parse(fs.readFileSync(file)),monitorOnly=process.argv[2]==='observe-start',signal=monitorOnly?'start':process.argv[2];
if(!['start','stop','restart','crash'].includes(signal))throw Error('Explicit power signal required');
activeLease(state.lease.lease_id,'craftopia_native_wave5');const receipt=await verifyRuntime(),profile=profileFromRuntime('craftopia/egg-craftopia.json',receipt);
if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Runtime pause active');
const server=(await api('/api/application/servers/'+state.fixture.server.id)).attributes;
if(server.uuid!==state.fixture.server.uuid||server.limits.memory!==8192||server.limits.swap!==0||server.limits.cpu!==100||server.container.environment.AUTO_UPDATE!=='0'||server.container.startup_command!==profile.egg.startup)throw Error('Owned8GiB nonacquiring canonical pilot required');
const base='/api/client/servers/'+server.uuid,credentials=(await api(base+'/websocket')).data,url=new URL(credentials.socket);
const before=JSON.parse(docker(['inspect',server.uuid]))[0];
if(before.Name!=='/'+server.uuid||before.HostConfig.NetworkMode!=='voltra-parity-20261029'||before.HostConfig.Memory!==8192*1024**2||before.HostConfig.MemorySwap!==before.HostConfig.Memory||before.HostConfig.CpuQuota!==100000||before.HostConfig.CpuPeriod!==100000)throw Error('Exact owned bounded native container required');
if(!monitorOnly&&(signal==='start'&&before.State.Running||signal!=='start'&&!before.State.Running))throw Error('Unexpected initial native state');
const previousStartedAt=monitorOnly?state.actions?.at(-1)?.previous_started_at:before.State.StartedAt;
if(!previousStartedAt)throw Error('Previous generation identity required');
if(url.protocol!=='ws:'||url.hostname!=='127.0.0.1'||url.port!=='18099'||url.pathname!==base+'/ws')throw Error('Owned loopback console required');
const socket=new WebSocket(credentials.socket),events=[];
await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Console auth timeout')),10000);socket.addEventListener('open',()=>socket.send(JSON.stringify({event:'auth',args:[credentials.token]})));socket.addEventListener('error',()=>{clearTimeout(t);reject(Error('Console connection failed'));});socket.addEventListener('message',m=>{const event=JSON.parse(String(m.data));if(event.event==='auth success'){clearTimeout(t);resolve();}if(['status','console output','daemon message'].includes(event.event))events.push({at:new Date().toISOString(),...event});});});
const at=new Date().toISOString();let final,actual,seen=false;
try{
 if(!monitorOnly){if(signal==='crash')docker(['kill','--signal','KILL',before.Id]);else await api(base+'/power','POST',{signal});}
 for(let i=0;i<600;i++){
  final=await observePower(state.fixture);try{actual=JSON.parse(docker(['inspect',server.uuid]))[0];}catch(error){if(error.exitStatus!==1)throw error;await new Promise(r=>setTimeout(r,250));continue;}
  const offline=signal==='stop'||signal==='crash',freshStart=actual.State.StartedAt!==previousStartedAt;
  const readyLine=events.some(e=>e.at>=at&&e.event==='console output'&&e.args?.some(a=>String(a).includes('World is loaded!')))||(monitorOnly&&actual.State.Running&&docker(['logs','--since',actual.State.StartedAt,actual.Id]).includes('World is loaded!'));
  if(offline&&final.current_state==='offline'&&!actual.State.Running||!offline&&freshStart&&readyLine&&final.current_state==='running'&&actual.State.Running){seen=true;break;}
  await new Promise(r=>setTimeout(r,250));
 }
}finally{
 socket.close();const capture=path.join(dir,`console-${signal}-${Date.now()}.json`);fs.writeFileSync(capture,JSON.stringify(events,null,2)+'\n');
 const result={at,signal,monitor_only:monitorOnly,pilot_memory_mib:8192,subsequent_AUTO_UPDATE:'0',console_authenticated:true,statuses:events.filter(e=>e.event==='status'&&e.at>=at).map(e=>e.args?.[0]),target_observed:seen,power:final,previous_started_at:previousStartedAt,raw_container_state:actual?.State,capture,canonical_startup_sha256:digest(profile.egg.startup)};
 state.actions??=[];state.actions.push(result);fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');console.log(JSON.stringify(result));
}
if(!seen)throw Error('Target power state not observed within bounded window');
if(signal==='crash'&&(actual.State.ExitCode!==137||actual.State.OOMKilled))throw Error('Controlled kill raw exit differs from137/OOMfalse');
if(signal==='stop'&&(actual.State.ExitCode!==0||actual.State.OOMKilled))throw Error('Normal stop raw exit differs from0/OOMfalse');
