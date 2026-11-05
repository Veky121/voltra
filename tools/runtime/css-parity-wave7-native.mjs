import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
import {runtime,verifyRuntime,claimNative,activeLease,api,docker,profileFromRuntime,acquireInstaller,createNativeFixture,waitNativeInstaller,releaseGate,waitInstallOutcome,releaseInstaller,observePower,digest} from './campaign-native-20261029.mjs';
const recipe='counter_strike/counter_strike_source/egg-counter--strike--source.json',owner='css_native',dir=path.join(runtime,'css-native');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'state.json'),s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};const save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n'),owned=()=>activeLease(s.lease.lease_id,owner),endpoint=()=>'/api/client/servers/'+s.fixture.server.uuid;
const phase=process.argv[2]||'plan';
if(phase==='plan'){
 const metadata=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/css-wave7-publisher-metadata.json'));if(metadata.appid!==232330||!metadata.fits_catalog_8192mib||metadata.unresolved_depots.length)throw Error('Verified publisher sizing required');
 s.metadata=metadata;s.plan={recipe,app_id:232330,client_app_id:240,memory_mib:4096,disk_mib:8192,ports:3,cpu_percent:100,swap:0,default_mode:'Original PUBLIC_SERVER0, blank Steam credentials/token, AUTO_UPDATE0; no private key fabricated',native_config:'/cstrike/cfg/server.cfg',typed_status:'Root-owned CSS registry/discovery pending actual measured engine cvars',client_prerequisite:'Matching licensed Steam client; no client entitlement or private credentials supplied',public_gslt_status:'Prepared helper requires a token for Internet mode, but that requirement still needs exact publisher revalidation; LAN token-free behavior will be measured'};save();console.log(JSON.stringify(s.plan));
}else if(phase==='claim'){
 s.runtime=await verifyRuntime();if(s.lease)owned();else s.lease=claimNative({game:recipe,owner,memory_mib:4096,disk_mib:8192,ports:3});s.profile=profileFromRuntime(recipe,s.runtime);save();console.log(JSON.stringify(s.lease));
}else if(phase==='profile-proof'){
 owned();s.runtime=await verifyRuntime();s.profile=profileFromRuntime(recipe,s.runtime);
 if(!s.profile.egg.startup.endsWith('.voltra/counterstrike_preflight.py css')||s.profile.egg.variables.length!==17)throw Error('Unexpected CSS recipe');
 const options=(await api('/api/client/game-library/templates/'+digest(recipe).slice(0,16))).attributes;for(const image of [s.profile.egg.scripts.installation.container,...Object.values(s.profile.egg.docker_images)])docker(['image','inspect',image]);
 s.profile_proof={at:new Date().toISOString(),backend:s.runtime.binary_sha256,pid:s.runtime.pid,variables:options.variables.map(v=>({key:v.env_variable,default_value:v.default_value,rules:v.rules})),images_exist:true};save();console.log(JSON.stringify(s.profile_proof));
}else if(phase==='install'){
 owned();s.runtime=await verifyRuntime();if(s.fixture?.server)throw Error('Observe existing CSS fixture');s.profile=profileFromRuntime(recipe,s.runtime);s.slot=acquireInstaller(s.lease.lease_id,owner);save();
 s.fixture=await createNativeFixture({lease:s.lease,slot:s.slot,profile:s.profile,name:'Campaign Counter-Strike Source native',onStep:async f=>{s.fixture=f;save();}});
 const {container,proof}=await waitNativeInstaller(s.fixture);s.installer={...proof,cgroups:docker(['exec',container.Id,'cat','/sys/fs/cgroup/memory.max','/sys/fs/cgroup/memory.swap.max','/sys/fs/cgroup/cpu.max'])};
 const stamp=Date.now(),log=path.join(dir,'installer-'+stamp+'.log'),wait=path.join(dir,'installer-'+stamp+'.exit'),lf=fs.openSync(log,'a'),wf=fs.openSync(wait,'a');
 const logger=spawn('docker',['--context','desktop-linux','logs','--follow',container.Id],{windowsHide:true,detached:true,stdio:['ignore',lf,lf]}),watch=spawn('docker',['--context','desktop-linux','wait',container.Id],{windowsHide:true,detached:true,stdio:['ignore',wf,wf]});logger.unref();watch.unref();fs.closeSync(lf);fs.closeSync(wf);s.installer_capture={log,wait,attached_before_gate:true};save();
 for(let n=0;n<20&&!fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE');n++)await new Promise(r=>setTimeout(r,100));if(!fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE'))throw Error('CSS installer capture missing');
 releaseGate(container,s.lease,s.slot.token);s.gate_released_at=new Date().toISOString();save();console.log(JSON.stringify({uuid:s.fixture.server.uuid,installer:s.installer}));
}else if(phase==='installed'){
 owned();s.install_outcome=await waitInstallOutcome(s.fixture,{timeoutMs:900000});for(let n=0;n<50&&!fs.readFileSync(s.installer_capture.wait,'utf8').trim();n++)await new Promise(r=>setTimeout(r,100));s.installer_exit=fs.readFileSync(s.installer_capture.wait,'utf8').trim();save();releaseInstaller(s.slot);s.slot_released=true;save();console.log(JSON.stringify({outcome:s.install_outcome,exit:s.installer_exit}));if(s.install_outcome.success&&s.installer_exit!=='0')throw Error('Successful callback lacks actual zero exit');
}else if(phase==='start'||phase==='stop'||phase==='restart'){
 owned();await verifyRuntime();if(phase==='start'){
  if(!s.install_outcome?.success)throw Error('CSS actual successful install required');s.helpers=[];
  for(const m of s.profile.egg.scripts.installation.script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)){
   if(!m[1].endsWith('.py'))continue;const r=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/contents?file='+encodeURIComponent('/'+m[1]));if(!r.ok)throw Error('Missing installed CSS helper');const actual=digest(Buffer.from(await r.arrayBuffer())),expected=digest(m[3]+'\n');if(actual!==expected)throw Error('Installed helper differs from captured served CSS recipe');s.helpers.push({file:m[1],sha256:actual});
  }
 }else{const c=JSON.parse(docker(['inspect',s.fixture.server.uuid]))[0];if(!c.State.Running)throw Error('Running owned native CSS required');const wait=path.join(dir,phase+'-'+Date.now()+'.exit'),fd=fs.openSync(wait,'a'),watch=spawn('docker',['--context','desktop-linux','wait',c.Id],{windowsHide:true,detached:true,stdio:['ignore',fd,fd]});watch.unref();fs.closeSync(fd);s.power_waits??=[];s.power_waits.push({signal:phase,container:c.Id,wait});}
 save();await api(endpoint()+'/power','POST',{signal:phase});s.actions??=[];s.actions.push({at:new Date().toISOString(),signal:phase});save();console.log(phase+' requested');
}else if(phase==='inspect'){
 owned();s.observed_runtime=await verifyRuntime();s.power=await observePower(s.fixture);let c;try{c=JSON.parse(docker(['inspect',s.fixture.server.uuid]))[0];}catch{}
 if(c){s.native={id:c.Id,state:c.State,limits:{memory:c.HostConfig.Memory,swap:c.HostConfig.MemorySwap,cpu:c.HostConfig.CpuQuota,oom_disabled:c.HostConfig.OomKillDisable}};const log=path.join(dir,'native-'+Date.now()+'.log');fs.writeFileSync(log,docker(['logs',c.Id],true));s.native.console_log=log;}
 s.lifecycle??=[];s.lifecycle.push({at:new Date().toISOString(),power:s.power.current_state,native:s.native});save();console.log(JSON.stringify({power:s.power,native:s.native}));
}else if(phase==='command'){
 owned();const command=process.argv[3];if(!command)throw Error('Explicit CSS command required');await api(endpoint()+'/command','POST',{command});s.commands??=[];s.commands.push({at:new Date().toISOString(),command});save();console.log('Native CSS command submitted');
}else throw Error('Unknown CSS native phase');
