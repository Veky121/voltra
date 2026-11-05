import fs from 'node:fs';
import path from 'node:path';
import {runtime,api,docker,digest,verifyRuntime,profileFromRuntime,activeLease,observePower} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'banana-wave10-etlegacy'),file=path.join(dir,'state.json'),s=JSON.parse(fs.readFileSync(file));
const monitorOnly=process.argv[2]==='observe-start',signal=monitorOnly?'start':process.argv[2];
if(!['start','stop','restart','crash'].includes(signal))throw Error('Explicit owned native power phase required');
if(['start','restart'].includes(signal)&&s.installed_helper_sourceproof?.source_sha256!=='f300766bec8558534156db51a8106ba6d18700a9daaca59fab0d259548671c57')throw Error('Exact served/installed v2 authority proof required before native boot');
const receipt=await verifyRuntime(),profile=profileFromRuntime('wolfenstein_enemy_territory/etlegacy/egg-e-t-legacy.json',receipt);
activeLease(s.lease.lease_id,'etlegacy_native_banana');if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Activation paused');
const server=(await api('/api/application/servers/'+s.fixture.server.id)).attributes;
if(server.uuid!==s.fixture.server.uuid||server.node!==1||server.egg!==s.fixture.egg.id||server.limits.memory!==1024||server.limits.disk!==4096||server.limits.swap!==0||server.limits.cpu!==100||server.container.startup_command!==profile.egg.startup)throw Error('Owned canonical default fixture required');
function inspect(){try{return JSON.parse(docker(['inspect',server.uuid]))[0];}catch(error){if(error.exitStatus===1)return null;throw error;}}
function validContainer(c){return c.Name==='/'+server.uuid&&c.HostConfig.NetworkMode==='voltra-parity-20261029'&&c.HostConfig.Memory===1024**3&&c.HostConfig.MemorySwap===c.HostConfig.Memory&&c.HostConfig.CpuPeriod===100000&&c.HostConfig.CpuQuota===100000;}
const before=inspect(),initial=await observePower(s.fixture);
if(before&&!validContainer(before))throw Error('Actual bounded owned container required');
if(!monitorOnly&&(signal==='start'?initial.current_state!=='offline':initial.current_state!=='running'))throw Error('Unexpected native power state');
const previousStartedAt=monitorOnly?s.actions?.at(-1)?.previous_started_at:before?.State.StartedAt||'0001-01-01T00:00:00Z';
if(!previousStartedAt)throw Error('Original generation required');
const base='/api/client/servers/'+server.uuid,credentials=(await api(base+'/websocket')).data,url=new URL(credentials.socket);
if(url.protocol!=='ws:'||url.hostname!=='127.0.0.1'||url.port!=='18099'||url.pathname!==base+'/ws')throw Error('Owned loopback console required');
const socket=new WebSocket(url),events=[];
await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Console auth timeout')),10000);socket.addEventListener('open',()=>socket.send(JSON.stringify({event:'auth',args:[credentials.token]})));socket.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('Console error'));});socket.addEventListener('message',m=>{const e=JSON.parse(String(m.data));if(e.event==='auth success'){clearTimeout(timeout);resolve();}if(['status','console output','daemon message'].includes(e.event))events.push({at:new Date().toISOString(),...e});});});
const at=new Date().toISOString();let actual,final,seen=false,cgroup;
try{
 if(!monitorOnly){if(signal==='crash')docker(['kill','--signal','KILL',before.Id]);else await api(base+'/power','POST',{signal});}
 for(let i=0;i<600;i++){
  final=await observePower(s.fixture);actual=inspect();if(!actual){await new Promise(r=>setTimeout(r,250));continue;}
  if(!validContainer(actual))throw Error('Actual runtime limits/ownership changed');
  const offline=signal==='stop'||signal==='crash';
  const ready=events.some(e=>e.at>=at&&e.event==='console output'&&e.args?.some(a=>String(a).includes('VOLTRA_QUAKE_NATIVE_READY')))||(monitorOnly&&actual.State.Running&&docker(['logs','--since',actual.State.StartedAt,actual.Id]).includes('VOLTRA_QUAKE_NATIVE_READY'));
  if(offline&&final.current_state==='offline'&&!actual.State.Running||!offline&&ready&&actual.State.StartedAt!==previousStartedAt&&final.current_state==='running'&&actual.State.Running){seen=true;break;}
  await new Promise(r=>setTimeout(r,250));
 }
 if(actual?.State.Running)cgroup=docker(['exec',actual.Id,'sh','-c','cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max']).trim();
}finally{
 socket.close();const capture=path.join(dir,`console-${signal}-${Date.now()}.json`);fs.writeFileSync(capture,JSON.stringify(events,null,2)+'\n');
 const result={at,signal,monitor_only:monitorOnly,console_authenticated:true,statuses:events.filter(e=>e.event==='status'&&e.at>=at).map(e=>e.args?.[0]),target_observed:seen,power:final,previous_started_at:previousStartedAt,raw_container_state:actual?.State,image_id:actual?.Image,requested_image:actual?.Config.Image,cgroup,capture,canonical_startup_sha256:digest(profile.egg.startup)};
 s.actions??=[];s.actions.push(result);fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');console.log(JSON.stringify(result));
}
if(!seen)throw Error('Native target not observed within bounded window');
if(signal==='crash'&&(actual.State.ExitCode!==137||actual.State.OOMKilled))throw Error('Controlled crash differs from137/OOMfalse');
if(signal==='stop'&&(actual.State.ExitCode!==0||actual.State.OOMKilled))throw Error('Normal stop differs from0/OOMfalse');
if(cgroup&&cgroup!=='1073741824\n0\n100000 100000')throw Error('Actual cgroup limits mismatch');
