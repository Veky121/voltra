// CS2D native phases. Preparation/claim is safe before the serialized installer
// handoff; install/start must only be run after the coordinator assigns the slot.
import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import {spawn} from 'node:child_process';
import {
  runtime,api,docker,digest,verifyRuntime,claimNative,activeLease,
  acquireInstaller,releaseInstaller,profileFromRuntime,createNativeFixture,
  waitNativeInstaller,waitInstallOutcome,releaseGate,observePower,installerGate,
} from './campaign-native-20261029.mjs';

const recipe='cs2d/egg-c-s2-d.json',owner='cs2d_native';
const dir=path.join(runtime,'cs2d-native');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'state.json');
let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');
const endpoint=()=>'/api/client/servers/'+state.fixture.server.uuid;
const raw=async(route,method='GET',body,extraHeaders={})=>{
 const response=await fetch('http://127.0.0.1:18099'+route,{method,headers:{'Content-Type':'application/json',...extraHeaders},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,body:await response.text()};
};
const assets=[
 {path:'.local/small-games/cs2d_1018_linux.zip',sha256:'855314b79c1cca60e93834461784882464fe00bf6a5aa2e86017c4ecbc4b16b1',bytes:29404443},
 {path:'.local/small-games/cs2d_dedicated_linux.zip',sha256:'a1b39e1f0aaca1903dc150dd9dfbfe67fcae67a264de56c3de1a7ba3b20ca7b0',bytes:3903595},
];
function verifyAssets(){return assets.map(a=>{if(fs.statSync(a.path).size!==a.bytes||digest(fs.readFileSync(a.path))!==a.sha256)throw Error('Cached publisher archive mismatch');return {...a,verified:true};});}
function assertOwned(){if(!state.lease)throw Error('Claim required');activeLease(state.lease.lease_id,owner);}
const phase=process.argv[2]||'plan';
if(phase==='plan'){
 state.assets=verifyAssets();
 state.plan={recipe,resources:{memory_mib:512,disk_mib:4096,ports:1,cpu:100,swap:0,oom_disabled:false},installer_order:'After coordinator hands off STK then DDNet serialized installer slot',native_config:'/cs2d/sys/server.cfg',typed_config_status:'Scoped parser pending root hook/build; never route executable CFG through INI',publisher_binary_modification:'Prohibited by supplied publisher Dedicated Readme; do not modify binary',health_probe:{primary_source:'https://cs2d.com/serverhosting.php',request_prefix:[1,0,250],timestamp_bytes:4,reply:'Exact request echo; no player-join implication'}};save();console.log(JSON.stringify(state.plan));
}else if(phase==='claim'){
 state.runtime=await verifyRuntime();state.assets=verifyAssets();
 if(state.lease)assertOwned();else state.lease=claimNative({game:recipe,owner,memory_mib:512,disk_mib:4096,ports:1});
 state.profile=profileFromRuntime(recipe,state.runtime);state.claimed_at=new Date().toISOString();save();console.log(JSON.stringify({lease:state.lease,source:state.runtime.binary_sha256}));
}else if(phase==='install'){
 assertOwned();state.runtime=await verifyRuntime();
 if(state.fixture?.server)throw Error('Owned fixture already exists; observe rather than recreate');
 state.slot=acquireInstaller(state.lease.lease_id,owner);save();
 state.profile=profileFromRuntime(recipe,state.runtime);
 for(const image of [state.profile.egg.scripts.installation.container,...Object.values(state.profile.egg.docker_images)])docker(['image','inspect',image]);
 const installerImage=JSON.parse(docker(['image','inspect',state.profile.egg.scripts.installation.container]))[0];
 if(installerImage.Config.Entrypoint?.length)throw Error('Installer image entrypoint must be empty for the gate');
 state.installer_image={id:installerImage.Id,entrypoint:installerImage.Config.Entrypoint};save();
 state.fixture=await createNativeFixture({lease:state.lease,slot:state.slot,profile:state.profile,environment:{SERVER_NAME:'Voltra CS2D native',PUBLIC_SERVER:'0',SERVER_MAP:'de_dust2',SERVER_PLAYERS:'12'},name:'Campaign CS2D native',onStep:async partial=>{state.fixture=partial;save();}});save();
 const {container,proof}=await waitNativeInstaller(state.fixture);state.installer={...proof,cgroup:docker(['exec',container.Id,'sh','-c','cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max']).trim()};save();
 const attempt=Date.now(),logPath=path.join(dir,`installer-${attempt}.log`),waitPath=path.join(dir,`installer-${attempt}.exit`);
 const logs=fs.openSync(logPath,'a'),wait=fs.openSync(waitPath,'a'),errors=fs.openSync(path.join(dir,`installer-${attempt}.stderr`),'a');
 const logProcess=spawn('docker',['--context','desktop-linux','logs','--follow',container.Id],{detached:true,windowsHide:true,stdio:['ignore',logs,logs]});
 const waitProcess=spawn('docker',['--context','desktop-linux','wait',container.Id],{detached:true,windowsHide:true,stdio:['ignore',wait,errors]});
 logProcess.unref();waitProcess.unref();fs.closeSync(logs);fs.closeSync(wait);fs.closeSync(errors);
 state.installer_capture={log:logPath,wait:waitPath,log_pid:logProcess.pid,wait_pid:waitProcess.pid,attached_before_release:true};save();
 for(let n=0;n<20&&!fs.readFileSync(logPath,'utf8').includes('CAMPAIGN_RESOURCE_GATE');n++)await new Promise(r=>setTimeout(r,100));
 if(!fs.readFileSync(logPath,'utf8').includes('CAMPAIGN_RESOURCE_GATE'))throw Error('Installer gate/log capture not observed');
 docker(['exec',container.Id,'mkdir','-p','/mnt/server/.voltra/public-cache']);
 for(const a of verifyAssets()){
  docker(['cp',path.resolve(a.path),container.Id+':/mnt/server/.voltra/public-cache/'+a.sha256]);
  if(!docker(['exec',container.Id,'sha256sum','/mnt/server/.voltra/public-cache/'+a.sha256]).startsWith(a.sha256))throw Error('Owned cache copy mismatch');
 }
 releaseGate(container,state.lease,state.slot.token);state.status='installing';save();console.log(JSON.stringify({uuid:state.fixture.server.uuid,installer:state.installer,status:state.status}));
}else if(phase==='installed'){
 assertOwned();state.install_outcome=await waitInstallOutcome(state.fixture);save();
 if(!state.install_outcome.success)throw Error('Native installer failed; retain evidence and inspect');
 releaseInstaller(state.slot);state.slot_released=true;state.status='installed';save();console.log(JSON.stringify(state.install_outcome));
}else if(phase==='reinstall-fresh'){
 assertOwned();state.runtime=await verifyRuntime();if((await observePower(state.fixture)).current_state!=='offline')throw Error('Stop before preservation reinstall');
 if(!state.slot_released)throw Error('Previous installer slot still held');
 const config=await raw(endpoint()+'/files/contents?file=%2Fcs2d%2Fsys%2Fserver.cfg');
 const custom=await raw(endpoint()+'/files/contents?file='+encodeURIComponent(state.preservation.custom.file));
 if(config.status!==200||custom.status!==200)throw Error('Owned preservation files missing');
 fs.writeFileSync(path.join(dir,'before-reinstall.cfg'),config.body);
 state.slot=acquireInstaller(state.lease.lease_id,owner);state.slot_released=false;
 state.reinstall={at:new Date().toISOString(),kind:'fresh-public-download-with-preservation',slot:state.slot,before:{config_sha256:digest(config.body),custom_sha256:digest(custom.body)}};save();
 const canonical=profileFromRuntime(recipe,state.runtime);
 await api('/api/admin/eggs/'+state.fixture.egg.id+'/scripts','PATCH',{script_install:installerGate(canonical.egg.scripts.installation.script,state.slot.token),script_container:canonical.egg.scripts.installation.container,script_entry:canonical.egg.scripts.installation.entrypoint});
 state.reinstall.script_patched=true;save();
 await api(endpoint()+'/settings/reinstall','POST',{});state.reinstall.requested=true;save();
 const {container,proof}=await waitNativeInstaller(state.fixture);state.reinstall.installer={...proof,cgroup:docker(['exec',container.Id,'sh','-c','cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max']).trim()};save();
 const stamp=Date.now(),log=path.join(dir,`reinstall-${stamp}.log`),wait=path.join(dir,`reinstall-${stamp}.exit`);
 const out=fs.openSync(log,'a'),end=fs.openSync(wait,'a'),err=fs.openSync(path.join(dir,`reinstall-${stamp}.stderr`),'a');
 const logger=spawn('docker',['--context','desktop-linux','logs','--follow',container.Id],{detached:true,windowsHide:true,stdio:['ignore',out,out]});
 const waiter=spawn('docker',['--context','desktop-linux','wait',container.Id],{detached:true,windowsHide:true,stdio:['ignore',end,err]});logger.unref();waiter.unref();fs.closeSync(out);fs.closeSync(end);fs.closeSync(err);
 state.reinstall.capture={log,wait,log_pid:logger.pid,wait_pid:waiter.pid,attached_before_release:true};save();
 for(let n=0;n<20&&!fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE');n++)await new Promise(r=>setTimeout(r,100));
 if(!fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE'))throw Error('Reinstall gate/log capture absent');
 const holding='/mnt/server/.voltra/public-cache-retained/'+state.slot.token;docker(['exec',container.Id,'mkdir','-p',holding]);
 state.reinstall.retained_cache=[];
 for(const asset of assets){
  const source='/mnt/server/.voltra/public-cache/'+asset.sha256;
  if(!docker(['exec',container.Id,'sha256sum',source]).startsWith(asset.sha256))throw Error('Owned cache identity mismatch before move');
  docker(['exec',container.Id,'mv',source,holding+'/'+asset.sha256]);
  docker(['exec',container.Id,'test','!','-e',source]);
  state.reinstall.retained_cache.push({sha256:asset.sha256,holding:holding+'/'+asset.sha256,original_cache_absent:true});save();
 }
 releaseGate(container,state.lease,state.slot.token);state.status='reinstalling';save();console.log(JSON.stringify({status:state.status,installer:state.reinstall.installer,retained_public_blobs:state.reinstall.retained_cache.length}));
}else if(phase==='reinstalled'){
 assertOwned();state.reinstall.outcome=await waitInstallOutcome(state.fixture);save();
 releaseInstaller(state.slot);state.slot_released=true;save();
 if(!state.reinstall.outcome.success)throw Error('Fresh publisher reinstall failed; retained rollback cache remains available');
 const config=await raw(endpoint()+'/files/contents?file=%2Fcs2d%2Fsys%2Fserver.cfg'),custom=await raw(endpoint()+'/files/contents?file='+encodeURIComponent(state.preservation.custom.file));
 state.reinstall.after={config_sha256:digest(config.body),custom_sha256:digest(custom.body),config_exact:digest(config.body)===state.reinstall.before.config_sha256,custom_exact:digest(custom.body)===state.reinstall.before.custom_sha256};
 state.reinstall.exit=fs.readFileSync(state.reinstall.capture.wait,'utf8').trim();
 fs.writeFileSync(path.join(dir,'after-reinstall.cfg'),config.body);save();
 if(!state.reinstall.after.config_exact||!state.reinstall.after.custom_exact||state.reinstall.exit!=='0')throw Error('Native reinstall preservation/exit mismatch');
 console.log(JSON.stringify({outcome:state.reinstall.outcome,exit:state.reinstall.exit,preservation:state.reinstall.after}));
}else if(phase==='start'){
 assertOwned();state.runtime=await verifyRuntime();
 const view=(await api('/api/application/servers/'+state.fixture.server.id)).attributes;
 if(view.container?.installed!==1)throw Error('Installation not complete');
 const script=state.profile.egg.scripts.installation.script;
 state.helpers=[];
 for(const m of script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)){
  if(!m[1].endsWith('.py')&&!m[1].endsWith('.lua'))continue;
  const response=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/contents?file='+encodeURIComponent('/'+m[1]));
  if(!response.ok)throw Error('Installed helper read failed');const actual=Buffer.from(await response.arrayBuffer());
  const expected=digest(m[3]+'\n');if(digest(actual)!==expected)throw Error('Installed helper differs from served canonical profile');
  state.helpers.push({file:m[1],sha256:expected});
 }
 save();await api(endpoint()+'/power','POST',{signal:'start'});state.status='starting';save();console.log(JSON.stringify({status:state.status,helpers:state.helpers.length,uuid:state.fixture.server.uuid}));
}else if(phase==='inspect'){
 assertOwned();state.observed_runtime=await verifyRuntime();state.power=await observePower(state.fixture);
 const c=JSON.parse(docker(['inspect',state.fixture.server.uuid]))[0];state.native={id:c.Id,state:c.State,limits:{memory:c.HostConfig.Memory,swap:c.HostConfig.MemorySwap,cpu:c.HostConfig.CpuQuota,oom_disabled:c.HostConfig.OomKillDisable}};
 fs.writeFileSync(path.join(dir,'native.log'),docker(['logs',c.Id],true));
 state.settings=await raw(endpoint()+'/game-settings?file=%2Fcs2d%2Fsys%2Fserver.cfg');
 if(state.settings.status===200){const json=JSON.parse(state.settings.body);state.typed_fields=json.attributes.fields?.map(f=>({key:f.key,type:f.type,readonly:f.readonly,secret:f.secret}));}
 state.lifecycle??=[];state.lifecycle.push({at:new Date().toISOString(),power:state.power.current_state,native:state.native});
 save();console.log(JSON.stringify({power:state.power.current_state,native:state.native,settings_status:state.settings.status,typed_fields:state.typed_fields}));
}else if(phase==='file-checkpoint'){
 assertOwned();if((await observePower(state.fixture)).current_state!=='offline')throw Error('Stop before file checkpoint');
 const original=await raw(endpoint()+'/files/contents?file='+encodeURIComponent('/cs2d/sys/server.cfg'));
 if(original.status!==200||(original.body.match(/^mp_freezetime[ \t]+/gm)||[]).length!==1)throw Error('Expected one native gameplay scalar');
 const updated=original.body.replace(/^mp_freezetime[ \t]+[^\r\n]*/m,'mp_freezetime 3')+'\n// Voltra native CS2D preservation fixture\n';
 const write=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/write?file='+encodeURIComponent('/cs2d/sys/server.cfg'),{method:'POST',headers:{'Content-Type':'text/plain'},body:updated});if(!write.ok)throw Error('Native file checkpoint write failed');
 const custom='/cs2d/sys/lua/voltra-parity-preserve.txt',customBody='Offline preservation fixture; not an autorun Lua script.\n';
 const customWrite=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/write?file='+encodeURIComponent(custom),{method:'POST',headers:{'Content-Type':'text/plain'},body:customBody});if(!customWrite.ok)throw Error('Custom operator file write failed');
 fs.writeFileSync(path.join(dir,'config-checkpoint.cfg'),updated);
 state.preservation={config_sha256:digest(updated),gameplay:'mp_freezetime 3',comment:true,custom:{file:custom,sha256:digest(customBody)},before_sha256:digest(original.body)};save();console.log(JSON.stringify(state.preservation));
}else if(phase==='verify-preservation'){
 assertOwned();const config=await raw(endpoint()+'/files/contents?file='+encodeURIComponent('/cs2d/sys/server.cfg'));
 const custom=await raw(endpoint()+'/files/contents?file='+encodeURIComponent(state.preservation.custom.file));
 state.preservation_checks??=[];const check={at:new Date().toISOString(),config_status:config.status,config_exact:digest(config.body)===state.preservation.config_sha256,custom_status:custom.status,custom_exact:digest(custom.body)===state.preservation.custom.sha256};
 state.preservation_checks.push(check);save();if(!check.config_exact||!check.custom_exact)throw Error('Native config/custom file changed across lifecycle');console.log(JSON.stringify(check));
}else if(phase==='native-format-baseline'){
 assertOwned();const current=await raw(endpoint()+'/files/contents?file='+encodeURIComponent('/cs2d/sys/server.cfg'));
 const original=fs.readFileSync(path.join(dir,'config-checkpoint.cfg'));
 const normalize=b=>Buffer.isBuffer(b)?b.toString().replaceAll('\r\n','\n'):b.replaceAll('\r\n','\n');
 if(current.status!==200||normalize(original)!==normalize(current.body))throw Error('Changes exceed native newline normalization');
 const logs=docker(['logs',state.fixture.server.uuid]).toString();
 if(!logs.includes('CS2D_NATIVE_SETTING_AFTER_RESTART\t3'))throw Error('Native engine gameplay readback not confirmed');
 fs.writeFileSync(path.join(dir,'config-checkpoint-original-mixed.cfg'),original);
 fs.writeFileSync(path.join(dir,'config-checkpoint.cfg'),current.body);
 state.native_newline_normalization={original_sha256:digest(original),native_sha256:digest(current.body),values_and_comments_equal:true,native_readback:'mp_freezetime=3',original_red_receipt_retained:true};
 state.preservation.config_sha256=digest(current.body);save();console.log(JSON.stringify(state.native_newline_normalization));
}else if(phase==='typed-roundtrip'){
 assertOwned();const backend=await verifyRuntime();if((await observePower(state.fixture)).current_state!=='offline')throw Error('Stop before typed patch');
 const route=endpoint()+'/game-settings?file=%2Fcs2d%2Fsys%2Fserver.cfg';
 const view=(await api(route)).attributes,flag=view.fields.find(f=>f.key==='sv_friendlyfire');if(flag?.type!=='boolean')throw Error('Boolean typed switch missing');
 const before=await raw(endpoint()+'/files/contents?file=%2Fcs2d%2Fsys%2Fserver.cfg');if(before.status!==200)throw Error('CFG read failed');
 fs.writeFileSync(path.join(dir,'before-typed.cfg'),before.body);
 const target=!flag.value;
 const changed=(await api(route,'PUT',{revision:view.revision,settings:{sv_friendlyfire:target,mp_freezetime:'4'}})).attributes;
 if(changed.fields.find(f=>f.key==='sv_friendlyfire').value!==target||changed.fields.find(f=>f.key==='mp_freezetime').value!=='4')throw Error('Typed readback mismatch');
 const after=await raw(endpoint()+'/files/contents?file=%2Fcs2d%2Fsys%2Fserver.cfg');
 const expected=before.body.replace(/(^sv_friendlyfire[ \t]+)([01])(?=[ \t\r\n]|$)/m,(_all,prefix)=>prefix+(target?'1':'0')).replace(/(^mp_freezetime[ \t]+)([+-]?\d+(?:\.\d+)?)(?=[ \t\r\n]|$)/m,(_all,prefix)=>prefix+'4');
 if(after.body!==expected)throw Error('Typed write changed unrelated native bytes');
 const stale=await raw(route,'PUT',{revision:view.revision,settings:{mp_freezetime:'5'}});if(stale.status!==409)throw Error('Stale revision not rejected');
 const forbidden=await raw(route,'PUT',{revision:changed.revision,settings:{sv_rcon:'fixture-forbidden'}});if(forbidden.status!==422)throw Error('Startup-owned credential control accepted');
 const rcon=await raw(endpoint()+'/files/contents?file='+encodeURIComponent('/.voltra/cs2d/rcon-password'));
 if(!rcon.body||JSON.stringify(changed).includes(rcon.body))throw Error('Typed response leaked persistent credential');
 fs.writeFileSync(path.join(dir,'after-typed.cfg'),after.body);
 state.typed_roundtrip={at:new Date().toISOString(),backend:{pid:backend.pid,binary_sha256:backend.binary_sha256},fields:changed.fields.map(f=>({key:f.key,type:f.type})),friendlyfire:target,freezetime:'4',byte_span_exact:true,before_sha256:digest(before.body),after_sha256:digest(after.body),stale_status:stale.status,managed_status:forbidden.status,rcon_masked:true};
 state.preservation.config_sha256=digest(after.body);state.preservation.gameplay='mp_freezetime 4';save();console.log(JSON.stringify(state.typed_roundtrip));
}else if(phase==='crash'){
 assertOwned();if((await observePower(state.fixture)).current_state!=='running')throw Error('Running native child required for controlled crash');
 const c=JSON.parse(docker(['inspect',state.fixture.server.uuid]))[0];
 const waitFile=path.join(dir,'controlled-crash.exit'),fd=fs.openSync(waitFile,'w'),err=fs.openSync(path.join(dir,'controlled-crash.stderr'),'a');
 const watcher=spawn('docker',['--context','desktop-linux','wait',c.Id],{detached:true,windowsHide:true,stdio:['ignore',fd,err]});watcher.unref();fs.closeSync(fd);fs.closeSync(err);
 state.controlled_crash={at:new Date().toISOString(),intent:'SIGKILL exact owned CS2D child',before_id:c.Id,wait:waitFile,wait_pid:watcher.pid};save();
 const code="import os,pathlib,signal,json; matches=[]\nfor p in pathlib.Path('/proc').iterdir():\n if not p.name.isdigit():continue\n try:args=(p/'cmdline').read_bytes().split(bytes([0]));exe=args[0].decode()\n except (OSError,UnicodeError):continue\n if exe=='/home/container/cs2d/cs2d_dedicated':matches.append(int(p.name))\nif len(matches)!=1:raise RuntimeError('Expected exact one owned CS2D child')\nprint(json.dumps({'controlled_signal':'SIGKILL','owned_child_pid':matches[0]}),flush=True);os.kill(matches[0],signal.SIGKILL)";
 try{const result=docker(['exec',state.fixture.server.uuid,'env','PYTHONHOME=/home/container/.voltra/python','LD_LIBRARY_PATH=/home/container/.voltra/python/lib','/home/container/.voltra/python/bin/python3','-c',code]);Object.assign(state.controlled_crash,JSON.parse(result));}
 catch(error){state.controlled_crash.exec_observation_error=String(error.message).slice(0,200);}
 save();console.log(JSON.stringify(state.controlled_crash));
}else if(phase==='evidence'){
 assertOwned();
 const rcon=await raw(endpoint()+'/files/contents?file='+encodeURIComponent('/.voltra/cs2d/rcon-password'));
 if(rcon.status!==200||!rcon.body)throw Error('Private generated RCON credential missing');
 const logs=docker(['logs',state.fixture.server.uuid],true).toString('utf8');
 state.secret_check={generated_rcon_present:true,bytes:Buffer.byteLength(rcon.body),console_exposes_rcon:logs.includes(rcon.body)};
 if(state.secret_check.console_exposes_rcon)throw Error('Generated RCON credential leaked into console output');
 fs.writeFileSync(path.join(dir,'native.log'),logs);
 const config=await raw(endpoint()+'/files/contents?file='+encodeURIComponent('/cs2d/sys/server.cfg'));
 if(config.status!==200)throw Error('Native CFG read failed');
 fs.writeFileSync(path.join(dir,'native-server.cfg'),config.body);
 const typed=logs.match(/CS2D_TYPED_NATIVE\t([^\r\n\t]+)\t([^\r\n\t]+)/);
 state.native_evidence={at:new Date().toISOString(),readiness:logs.includes('----- Server started -----'),mailbox_adapter:logs.includes('VOLTRA_CS2D_CONSOLE_READY'),lua_probe:logs.includes('CS2D_NATIVE_SETTING')||!!typed,typed_engine:typed?{mp_freezetime:typed[1],sv_friendlyfire:typed[2]}:null,config_sha256:digest(config.body)};
 if(state.typed_roundtrip&&typed&&(typed[1]!=='4'||typed[2]!==(state.typed_roundtrip.friendlyfire?'1':'0')))throw Error('Native engine differs from typed API values');
 save();console.log(JSON.stringify({secret_check:state.secret_check,native_evidence:state.native_evidence,tail:logs.replaceAll(rcon.body,'[redacted]').split('\n').slice(-12)}));
}else if(phase==='ping'){
 assertOwned();const packet=Buffer.alloc(7);packet[0]=1;packet[1]=0;packet[2]=250;packet.writeUInt32LE(0x1755aabb,3);
 const socket=dgram.createSocket('udp4'),replies=[];socket.on('message',(data,peer)=>replies.push({hex:data.toString('hex'),peer,match:data.equals(packet)}));
 socket.send(packet,state.lease.ports[0],'127.0.0.1');await new Promise(r=>setTimeout(r,1500));socket.close();
 state.ping={request_hex:packet.toString('hex'),replies,primary_source:'https://cs2d.com/serverhosting.php',player_join:false};save();console.log(JSON.stringify(state.ping));
}else if(phase==='command'){
 assertOwned();const command=process.argv[3];if(!command)throw Error('Explicit command required');
 await api(endpoint()+'/command','POST',{command});state.commands??=[];state.commands.push({at:new Date().toISOString(),command});save();console.log('Native console command submitted');
}else if(phase==='stop'||phase==='restart'){
 assertOwned();
 if(phase==='restart'){
  const c=JSON.parse(docker(['inspect',state.fixture.server.uuid]))[0];if(!c.State.Running)throw Error('Restart proof requires current native run');
  const name='restart-'+Date.now(),waitFile=path.join(dir,name+'.exit'),fd=fs.openSync(waitFile,'a'),err=fs.openSync(path.join(dir,name+'.stderr'),'a');
  const watcher=spawn('docker',['--context','desktop-linux','wait',c.Id],{detached:true,windowsHide:true,stdio:['ignore',fd,err]});watcher.unref();fs.closeSync(fd);fs.closeSync(err);
  state.restarts??=[];state.restarts.push({before_id:c.Id,before_started:c.State.StartedAt,wait:waitFile,wait_pid:watcher.pid});save();
 }
 await api(endpoint()+'/power','POST',{signal:phase});state.status=phase==='stop'?'stopping':'restarting';save();console.log(state.status);
}else throw Error('Use plan|claim|install|installed|start|inspect|ping|command|stop|restart');
