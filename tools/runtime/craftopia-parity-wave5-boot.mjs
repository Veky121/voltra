// Owned runtime-only first-boot resource gate. No canonical application edits.
import fs from 'node:fs';
import path from 'node:path';
import {runtime,api,docker,digest,verifyRuntime,profileFromRuntime,activeLease,acquireInstaller,releaseInstaller,observePower} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'craftopia-wave5-native'),file=path.join(dir,'state.json'),state=JSON.parse(fs.readFileSync(file));
const owner='craftopia_native_wave5',recipe='craftopia/egg-craftopia.json',base='/api/client/servers/'+state.fixture.server.uuid;
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');
activeLease(state.lease.lease_id,owner);const receipt=await verifyRuntime(),profile=profileFromRuntime(recipe,receipt);
if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Runtime activation paused');
async function startup(value,environment=state.first_boot.original_environment){await api('/api/application/servers/'+state.fixture.server.id+'/startup','PATCH',{startup:value,environment,skip_scripts:false});const actual=(await api('/api/application/servers/'+state.fixture.server.id)).attributes;if(actual.container.startup_command!==value)throw Error('Startup API readback mismatch');const selected=Object.fromEntries(profile.egg.variables.map(v=>[v.env_variable,actual.container.environment[v.env_variable]]));if(digest(JSON.stringify(selected))!==digest(JSON.stringify(environment)))throw Error('Startup API altered supplied original variables');return digest(value);}
async function connect(){const c=(await api(base+'/websocket')).data,u=new URL(c.socket);if(u.protocol!=='ws:'||u.hostname!=='127.0.0.1'||u.port!=='18099'||u.pathname!==base+'/ws')throw Error('Owned loopback console required');const socket=new WebSocket(c.socket),log=path.join(dir,'first-boot-console.jsonl');await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Console auth timeout')),10000);socket.addEventListener('open',()=>socket.send(JSON.stringify({event:'auth',args:[c.token]})));socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Console connection failed'));});socket.addEventListener('message',m=>{const event=JSON.parse(String(m.data));if(event.event==='auth success'){clearTimeout(timer);resolve();}if(['status','console output','daemon message'].includes(event.event)){const row={at:new Date().toISOString(),...event};fs.appendFileSync(log,JSON.stringify(row)+'\n');if(event.event==='status'){state.first_boot.statuses.push(row);save();}}});});return socket;}
const phase=process.argv[2]||'plan';
if(phase==='plan'){const server=(await api('/api/application/servers/'+state.fixture.server.id)).attributes;console.log(JSON.stringify({recipe,server:server.id,uuid:server.uuid,build:server.limits,pilot_memory_mib:8192,catalog_memory_mib:4096,canonical_startup_sha256:digest(profile.egg.startup),gate_ready:true}));process.exit(0);}
if(phase==='start'){
 if(process.argv[3]!=='coordinator-handoff')throw Error('Fresh acquisition handoff required');if(state.first_boot)throw Error('First boot state exists; inspect instead of duplicate');
 const server=(await api('/api/application/servers/'+state.fixture.server.id)).attributes;
 if(server.uuid!==state.fixture.server.uuid||server.container.installed!==1||server.limits.memory!==8192||server.limits.disk!==16384||server.limits.swap!==0||server.limits.cpu!==100||(await observePower(state.fixture)).current_state!=='offline')throw Error('Exact offline8GiB pilot build required');
 state.slot=acquireInstaller(state.lease.lease_id,owner);state.slot_released=false;state.runtime=receipt;state.profile=profile;
 const vars=Object.fromEntries(profile.egg.variables.map(v=>[v.env_variable,server.container.environment[v.env_variable]]));
 state.first_boot={at:new Date().toISOString(),scope:'8GiB/16GiB pilot; not catalog4GiB run',original_startup:server.container.startup_command,original_environment:vars,environment_sha256:digest(JSON.stringify(vars)),statuses:[],slot:state.slot.token};save();
 const gate='.voltra/craftopia-firstboot-resource-gate.sh',release='.voltra/craftopia-firstboot-release-'+state.slot.token;
 const script='#!/bin/sh\nset -eu\necho CRAFTOPIA_NATIVE_RESOURCE_GATE\nwhile [ ! -f '+release+' ]; do sleep 0.1; done\n'+profile.egg.startup+'\n';
 const response=await fetch('http://127.0.0.1:18099'+base+'/files/write?file='+encodeURIComponent('/'+gate),{method:'POST',headers:{'Content-Type':'text/plain'},body:script});if(!response.ok)throw Error('Owned gate upload failed');state.first_boot.gate_sha256=digest(script);save();
 await startup('sh '+gate);const socket=await connect();try{
  await api(base+'/power','POST',{signal:'start'});let container;
  for(let i=0;i<100;i++){try{const found=JSON.parse(docker(['inspect',state.fixture.server.uuid]))[0];if(found.State.Running&&docker(['logs',found.Id]).includes('CRAFTOPIA_NATIVE_RESOURCE_GATE')){container=found;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!container||container.Name!=='/'+state.fixture.server.uuid||container.HostConfig.NetworkMode!=='voltra-parity-20261029'||container.HostConfig.Memory!==8192*1024**2||container.HostConfig.MemorySwap!==container.HostConfig.Memory||container.HostConfig.CpuQuota!==100000||container.HostConfig.CpuPeriod!==100000)throw Error('Leave gate CLOSED: actual game limits mismatch');
  const cg=docker(['exec',container.Id,'sh','-c','cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max']).trim();if(cg!=='8589934592\n0\n100000 100000')throw Error('Leave gate CLOSED: cgroups mismatch');
  state.first_boot.resource_proof={container:container.Id,cgroup:cg,memory_mib:8192,extra_swap:0,cpu:1,before_updater:true,disk_before:state.installed_disk};save();docker(['exec',container.Id,'touch','/home/container/'+release]);state.first_boot.gate_released_at=new Date().toISOString();save();console.log(JSON.stringify({gate_released:true,proof:state.first_boot.resource_proof}));
 }finally{socket.close();}
}else if(phase!=='observe')throw Error('Use plan|start coordinator-handoff|observe');
const socket=await connect();try{
 const began=Date.now();let power,terminal=false;
 while(Date.now()-began<50000){power=await observePower(state.fixture);const actual=JSON.parse(docker(['inspect',state.fixture.server.uuid]))[0];if((power.current_state==='running'&&actual.State.Running&&docker(['logs','--since',actual.State.StartedAt,actual.Id]).includes('World is loaded!'))||(power.current_state==='offline'&&!actual.State.Running)){terminal=true;break;}await new Promise(r=>setTimeout(r,500));}
 state.first_boot.latest_power=power;state.first_boot.observed_at=new Date().toISOString();save();
 if(terminal){
  const actual=JSON.parse(docker(['inspect',state.fixture.server.uuid]))[0];if(power.current_state==='offline'&&actual.State.Running)throw Error('Panel lag cannot release an active updater');
  state.first_boot.outcome=power.current_state==='running'?'ready':'failed';state.first_boot.actual_container_state=actual.State;state.first_boot.restored_startup_sha256=await startup(profile.egg.startup);save();
  const cycles={...state.first_boot.original_environment,AUTO_UPDATE:'0'};await startup(profile.egg.startup,cycles);state.first_boot.subsequent_cycles={AUTO_UPDATE:'0',scope:'Explicit campaign control after actual default AUTO_UPDATE1 first attempt; all other original variables preserved.',environment_sha256:digest(JSON.stringify(cycles))};save();
  if(!state.slot_released){releaseInstaller(state.slot);state.slot_released=true;save();}
 }
 console.log(JSON.stringify({outcome:state.first_boot.outcome||'starting',power,slot_released:state.slot_released}));
}finally{socket.close();}
