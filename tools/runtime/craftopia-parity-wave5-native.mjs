// Craftopia-only native phases. No phase other than plan runs without an explicit command.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {runtime,api,docker,digest,verifyRuntime,profileFromRuntime,claimNative,activeLease,acquireInstaller,releaseInstaller,createNativeFixture,waitNativeInstaller,waitInstallOutcome,releaseGate,observePower,installerGate} from './campaign-native-20261029.mjs';
const recipe='craftopia/egg-craftopia.json',owner='craftopia_native_wave5';
const dir=path.join(runtime,'craftopia-wave5-native'),file=path.join(dir,'state.json');
let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
const save=()=>{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');};
const owned=()=>activeLease(state.lease?.lease_id,owner);
const endpoint=()=>'/api/client/servers/'+state.fixture.server.uuid;
async function served(){const receipt=await verifyRuntime(),profile=profileFromRuntime(recipe,receipt);const marker="cat > .voltra/craftopia_preflight.py <<'VOLTRA_CRAFTOPIA_PREFLIGHT_WAVE5'\n";
 const script=profile.egg.scripts.installation.script;
 if(script.split(marker).length!==2)throw Error('Served Craftopia preflight helper unavailable');
 const body=script.split(marker)[1].split('VOLTRA_CRAFTOPIA_PREFLIGHT_WAVE5\n')[0];
 if(digest(body)!==digest(fs.readFileSync('internal/panel/game_library/scripts/craftopia-preflight.py')))throw Error('Served Craftopia helper differs from canonical');
 return {receipt,profile};}
const phase=process.argv[2]||'plan';
if(phase==='plan'){
 const current=await served();console.log(JSON.stringify({recipe,pid:current.receipt.pid,sha256:current.receipt.binary_sha256,controls:current.profile.egg.variables.map(v=>v.env_variable),resources:{memory_mib:8192,disk_mib:16384,ports:1,cpu:100,swap:0},native_path:'/ServerSetting.ini',steam_app:1670340,prerequisites:'Historical anonymous install succeeded; fresh receipt,8GiB lease,coordinator installer handoff required. Historical source/runtime results do not validate current preflight or typed settings.',readiness:'World is loaded!',managed_native_keys:['GameWorld/name','Host/port','Save/savePath']}));
}else if(phase==='claim'){
 const current=await served();if(state.lease)owned();else state.lease=claimNative({game:recipe,owner,memory_mib:8192,disk_mib:16384,ports:1});state.runtime=current.receipt;save();console.log(JSON.stringify({lease:state.lease,source:state.runtime.binary_sha256}));
}else if(phase==='install'||phase==='reinstall'){
 owned();const current=await served();if(process.argv[3]!=='coordinator-handoff')throw Error('Explicit installer coordinator handoff required');if(phase==='install'&&state.fixture?.server)throw Error('Owned fixture exists');
 if(phase==='reinstall'&&((await observePower(state.fixture)).current_state!=='offline'||!state.fresh_metadata?.done||Date.now()-Date.parse(state.fresh_metadata.assessment.at)>15*60*1000||state.fresh_metadata.assessment.conservative_reinstall_bound_bytes>state.lease.disk_mib*1024**2))throw Error('Stopped pilot with fresh reviewed bounded metadata required');
 for(const image of [current.profile.egg.scripts.installation.container,...Object.values(current.profile.egg.docker_images)])docker(['image','inspect',image]);
 if(JSON.parse(docker(['image','inspect',current.profile.egg.scripts.installation.container]))[0].Config.Entrypoint?.length)throw Error('Installer ENTRYPOINT must honor resource gate');
 if(state.slot&&!state.slot_released){if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).installer_slot?.token!==state.slot.token)throw Error('Lost owned installer token');}else state.slot=acquireInstaller(state.lease.lease_id,owner);state.slot_released=false;state.runtime=current.receipt;state.profile=current.profile;save();
 if(phase==='install'){state.fixture=await createNativeFixture({lease:state.lease,slot:state.slot,profile:state.profile,environment:{WORLD_NAME:'Voltra Craftopia Native'},name:'Campaign Craftopia native',onStep:async partial=>{state.fixture=partial;save();}});}else{
  const egg=(await api('/api/admin/eggs/'+state.fixture.egg.id)).attributes;if(egg.nest_id!==state.fixture.nest.id)throw Error('Owned egg/nest mismatch');
  state.installer_attempts??=[];state.installer_attempts.push({proof:state.installer,capture:state.installer_capture,outcome:state.install_outcome,resource_phase:state.installer_attempts.length===0?'original8GiB/16GiBpilot':'explicit8GiB/32GiB'});save();
  await api('/api/admin/eggs/'+state.fixture.egg.id+'/scripts','PATCH',{script_install:installerGate(state.profile.egg.scripts.installation.script,state.slot.token),script_entry:state.profile.egg.scripts.installation.entrypoint,script_container:state.profile.egg.scripts.installation.container});
  await api(endpoint()+'/settings/reinstall','POST',{});
 }
 const {container,proof}=await waitNativeInstaller(state.fixture);state.installer={...proof,cgroup:docker(['exec',container.Id,'sh','-c','cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max']).trim()};save();
 const stamp=Date.now(),log=path.join(dir,`installer-${stamp}.log`),wait=path.join(dir,`installer-${stamp}.exit`),error=path.join(dir,`installer-${stamp}.stderr`);
 const logFd=fs.openSync(log,'a'),waitFd=fs.openSync(wait,'a'),errorFd=fs.openSync(error,'a');
 const logger=spawn('docker',['--context','desktop-linux','logs','--follow',container.Id],{detached:true,windowsHide:true,stdio:['ignore',logFd,logFd]}),waiter=spawn('docker',['--context','desktop-linux','wait',container.Id],{detached:true,windowsHide:true,stdio:['ignore',waitFd,errorFd]});
 logger.unref();waiter.unref();fs.closeSync(logFd);fs.closeSync(waitFd);fs.closeSync(errorFd);state.installer_capture={log,wait,error,attached_before_release:true};save();
 for(let n=0;n<20&&!fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE');n++)await new Promise(r=>setTimeout(r,100));if(!fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE'))throw Error('Resource gate capture unavailable');
 releaseGate(container,state.lease,state.slot.token);state.status='installing';save();console.log(JSON.stringify({uuid:state.fixture.server.uuid,proof:state.installer}));
}else if(phase==='installed'){
 owned();state.install_outcome=await waitInstallOutcome(state.fixture,{timeoutMs:55000});save();releaseInstaller(state.slot);state.slot_released=true;save();console.log(JSON.stringify(state.install_outcome));
}else if(['start','stop','restart'].includes(phase)){
 owned();await served();const server=(await api('/api/application/servers/'+state.fixture.server.id)).attributes;if(server.container?.installed!==1)throw Error('Native installation required');await api(endpoint()+'/power','POST',{signal:phase});state.actions??=[];state.actions.push({signal:phase,at:new Date().toISOString()});save();console.log(JSON.stringify(state.actions.at(-1)));
}else if(phase==='inspect'){
 owned();state.power=await observePower(state.fixture);state.server=(await api('/api/application/servers/'+state.fixture.server.id)).attributes;save();console.log(JSON.stringify({power:state.power,installed:state.server.container?.installed,status:state.server.status}));
}else if(phase==='settings'){
 owned();const view=(await api(endpoint()+'/game-settings?file=%2FServerSetting.ini')).attributes;
 const bits=view.fields.filter(f=>f.type==='boolean').map(f=>({key:f.key,value:f.value,readonly:f.readonly}));
 for(const key of ['GameWorld/name','Host/port','Save/savePath'])if(!view.fields.find(f=>f.key===key)?.readonly)throw Error('Managed native field is writable: '+key);
 const password=view.fields.find(f=>f.key==='Host/serverPassword');if(password&&(!password.secret||password.value!=null))throw Error('Native PIN not masked');
 state.settings={at:new Date().toISOString(),file:view.file,revision:view.revision,bits,fields:view.fields.map(f=>({key:f.key,type:f.type,secret:f.secret,readonly:f.readonly}))};save();console.log(JSON.stringify(state.settings));
}else if(phase==='edit-bit'){
 owned();if((await observePower(state.fixture)).current_state!=='offline')throw Error('Stop native server before editing');const route=endpoint()+'/game-settings?file=%2FServerSetting.ini',view=(await api(route)).attributes;
 const field=view.fields.find(f=>f.key==='CreativeModeSetting/noHunger');if(field?.type!=='boolean'||field.readonly)throw Error('Expected source-backed native bit');
 const result=await api(route,'PUT',{revision:view.revision,settings:{'CreativeModeSetting/noHunger':!field.value}});state.bit_edit={at:new Date().toISOString(),key:field.key,before:field.value,after:!field.value,revision:result.attributes?.revision};
 const response=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/contents?file=%2FServerSetting.ini');if(!response.ok)throw Error('Native file readback unavailable');const data=await response.text();fs.writeFileSync(path.join(dir,'config-checkpoint.ini'),data);state.bit_edit.sha256=digest(data);save();console.log(JSON.stringify(state.bit_edit));
}else if(phase==='preserved'){
 owned();if(!state.bit_edit)throw Error('Checkpoint required');const response=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/contents?file=%2FServerSetting.ini');const data=await response.text();const result={at:new Date().toISOString(),status:response.status,exact:digest(data)===state.bit_edit.sha256};state.preservation??=[];state.preservation.push(result);save();if(!response.ok||!result.exact)throw Error('Native configuration changed across lifecycle');console.log(JSON.stringify(result));
}else throw Error('Use plan|claim|install coordinator-handoff|installed|start|stop|restart|inspect|settings|edit-bit|preserved.');
