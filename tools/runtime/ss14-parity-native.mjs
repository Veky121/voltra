import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {api,docker,verifyRuntime,profileFromRuntime,activeLease,acquireInstaller,releaseInstaller,releaseNative,
 createNativeFixture,waitNativeInstaller,waitInstallOutcome,releaseGate,digest,runtime} from './campaign-native-20261029.mjs';
const dir=path.resolve('.local/game-parity-20261029/ss14-native'),file=path.join(dir,'state.json');
const owner='ss14_native',recipe='spacestation_14/egg-spacestation14.json';
const s=JSON.parse(fs.readFileSync(file));
const save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2));
const endpoint=()=>'/api/client/servers/'+s.fixture.server.uuid;
const event=(kind,data)=>fs.appendFileSync(path.join(dir,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),kind,...data})+'\n');
async function checked(){if(s.paused||JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Root activation paused');const r=await verifyRuntime();if(r.binary_sha256!==s.runtime.binary_sha256)throw Error('Fresh explicit resume receipt required');activeLease(s.lease.lease_id,owner);return r;}
async function raw(p,method='GET',body,user){const headers={};if(body!==undefined&&typeof body!=='string')headers['Content-Type']='application/json';if(user)headers['X-Dev-User-ID']=String(user);return fetch('http://127.0.0.1:18099'+p,{method,headers,body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});}
async function resources(){return(await api(endpoint()+'/resources')).attributes;}
async function read(p){const r=await raw(endpoint()+'/files/contents?file='+encodeURIComponent(p));if(!r.ok)throw Error('Native file read '+r.status);return Buffer.from(await r.arrayBuffer());}
function containers(){const ids=docker(['ps','-aq','--filter','name='+s.fixture.server.uuid]).trim().split(/\s+/).filter(Boolean);return ids.length?JSON.parse(docker(['inspect',...ids])):[];}
function followLog(id,basename){const fd=fs.openSync(path.join(dir,basename),'a');const child=spawn('docker',['--context','desktop-linux','logs','--follow',id],{stdio:['ignore',fd,fd],windowsHide:true});fs.closeSync(fd);child.unref();return child.pid;}
function followWait(id,basename){const fd=fs.openSync(path.join(dir,basename),'a');const child=spawn('docker',['--context','desktop-linux','wait',id],{stdio:['ignore',fd,fd],windowsHide:true});fs.closeSync(fd);child.unref();return child.pid;}
const phase=process.argv[2];
try{
 if(phase==='resume'){
  if(process.env.SS14_RESUME_GO!=='1')throw Error('Root explicit resume required');if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Root pause remains');
  const r=await verifyRuntime(),p=profileFromRuntime(recipe,r);activeLease(s.lease.lease_id,owner);
  const changed=digest(JSON.stringify(p.egg))!==digest(JSON.stringify(s.profile.egg));
  if(changed){const equivalent=structuredClone(p.egg);equivalent.scripts.installation.script=s.profile.egg.scripts.installation.script;if(JSON.stringify(equivalent)!==JSON.stringify(s.profile.egg))throw Error('SS14 non-helper recipe changed; explicit review required');s.catalog_profile=p;}
  s.runtime_history??=[];s.runtime_history.push(s.runtime);s.runtime=r;s.paused=false;if(!s.fixture?.server)s.profile=p;save();console.log(JSON.stringify({resumed:true,pid:r.pid,sha:r.binary_sha256,catalog_helpers_changed:changed,installed_helper_pin_retained:!!s.fixture?.server}));
 }else if(phase==='install'){
  if(process.env.SS14_INSTALL_GO!=='1')throw Error('Coordinator installer GO required');await checked();if(s.fixture?.server)throw Error('Owned fixture already exists');
  s.slot=acquireInstaller(s.lease.lease_id,owner);save();
  const id=digest(recipe).slice(0,16);s.options=(await api('/api/client/game-library/templates/'+id)).attributes;
  s.environment={SERVER_NAME:'SS14 native literal $safe',SERVER_TICK:'30',SERVER_MAX_PLAYERS:'8',PUBLIC_SERVER:'0'};
  s.port_plan=await api('/api/client/game-library/templates/'+id+'/ports','POST',{node_id:1,environment:s.environment});save();
  s.fixture=await createNativeFixture({lease:s.lease,slot:s.slot,profile:s.profile,environment:s.environment,name:'Campaign SS14 native',onStep:async x=>{s.fixture=x;save();}});save();
  const held=await waitNativeInstaller(s.fixture);s.installer_proof=held.proof;s.installer_id=held.container.Id;
  s.installer_cgroups=docker(['exec',held.container.Id,'sh','-c','cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max']);
  s.installer_log_follower=followLog(held.container.Id,'installer-full.log');s.installer_wait_follower=followWait(held.container.Id,'installer-wait.txt');save();releaseGate(held.container,s.lease,s.slot.token);s.phase='installing';save();console.log(JSON.stringify({phase:s.phase,uuid:s.fixture.server.uuid,limits:s.installer_proof}));
  // Keep this tool process alive: Windows tool jobs terminate detached child
  // followers on parent exit. A yielded exec session preserves full receipts.
  s.install_outcome=await waitInstallOutcome(s.fixture,{timeoutMs:600000});save();
  if(docker(['ps','-aq','--filter','name='+s.fixture.server.uuid+'_installer']).trim())throw Error('Installer still exists; keep serialized slot');
  releaseInstaller(s.slot);s.slot_released=true;save();console.log(JSON.stringify(s.install_outcome));
 }else if(phase==='attach-wait'){
  await checked();if(s.installer_wait_follower)throw Error('Wait follower already tracked');s.installer_wait_follower=followWait(s.installer_id,'installer-wait.txt');save();console.log('Owned installer wait attached');
 }else if(phase==='install-outcome'){
  await checked();s.install_outcome=await waitInstallOutcome(s.fixture,{timeoutMs:45000});save();
  if(docker(['ps','-aq','--filter','name='+s.fixture.server.uuid+'_installer']).trim())throw Error('Actual installer remains; keep slot');
  releaseInstaller(s.slot);s.slot_released=true;save();console.log(JSON.stringify(s.install_outcome));
 }else if(['start','stop','restart'].includes(phase)){
  await checked();if(phase==='start'){
   const helpers=[...s.profile.egg.scripts.installation.script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].filter(m=>m[1].endsWith('.py'));
   const actual=docker(['run','--rm','--network','none','--memory','128m','--memory-swap','128m','--cpus','1','--mount',`type=bind,src=/var/lib/voltra-parity-20261029/volumes/${s.fixture.server.uuid},dst=/v,readonly`,'alpine:3.22','sha256sum',...helpers.map(m=>'/v/'+m[1])]).trim().split('\n');
   s.helper_hashes=helpers.map((m,i)=>({file:m[1],expected:digest(m[3]+'\n'),actual:actual[i].split(/\s+/)[0]}));if(s.helper_hashes.some(h=>h.expected!==h.actual))throw Error('Frozen helper mismatch');save();
  }
  const before=await resources();await api(endpoint()+'/power','POST',{signal:phase});event('power',{signal:phase,before:before.current_state});s.phase=phase;save();console.log(phase);
 }else if(phase==='wait-ready'){
  await checked();let okay=false;for(let i=0;i<45;i++){if((await resources()).current_state==='running'){okay=true;break;}await new Promise(r=>setTimeout(r,1000));}if(!okay)throw Error('Readiness timeout');console.log('running');
 }else if(phase==='observe'){
  await checked();s.resources=await resources();s.native=containers().map(c=>({id:c.Id,name:c.Name,state:c.State,ports:c.NetworkSettings.Ports,limits:{memory:c.HostConfig.Memory,swap:c.HostConfig.MemorySwap,cpu_period:c.HostConfig.CpuPeriod,cpu_quota:c.HostConfig.CpuQuota,oom_disabled:c.HostConfig.OomKillDisable}}));
  const game=s.native.find(c=>c.name==='/'+s.fixture.server.uuid);if(game){if(game.limits.memory!==2048*1024**2||game.limits.swap!==game.limits.memory||game.limits.cpu_period!==100000||game.limits.cpu_quota!==100000||game.limits.oom_disabled===true)throw Error('Actual hard limits mismatch');
   const log=docker(['logs',game.id],true);fs.writeFileSync(path.join(dir,'native.log'),log);fs.writeFileSync(path.join(dir,'native-'+Date.now()+'.log'),log);event('native',{state:game.state,panel:s.resources.current_state});}
  try{s.settings=(await api(endpoint()+'/game-settings?file=%2Fss14%2Fserver_config.toml')).attributes;}catch(error){s.settings_error=String(error);}
  save();console.log(JSON.stringify({state:s.resources.current_state,native:s.native,settings:s.settings?{file:s.settings.file,fields:s.settings.fields.map(f=>({key:f.key,type:f.type,readonly:f.readonly}))}:s.settings_error}));
 }else if(phase==='console-watch'){
  await checked();const grant=(await api(endpoint()+'/websocket')).data;
  const proof={at:new Date().toISOString(),authenticated:false,events:{},statuses:[],ansi:false,ready:false};
  const socket=new WebSocket(grant.socket),duration=Number(process.env.SS14_WATCH_MS||180000);if(!Number.isInteger(duration)||duration<1000||duration>300000)throw Error('Bounded watch duration required');
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>socket.close(),duration);
   socket.addEventListener('open',()=>socket.send(JSON.stringify({event:'auth',args:[grant.token]})));
   socket.addEventListener('message',e=>{let m;try{m=JSON.parse(String(e.data));}catch{return;}proof.events[m.event]=(proof.events[m.event]||0)+1;
    if(m.event==='auth success'){proof.authenticated=true;socket.send(JSON.stringify({event:'send logs',args:[]}));console.log('SS14 native console authenticated');}
    if(m.event==='status')proof.statuses.push({at:new Date().toISOString(),state:m.args?.[0]});
    if(m.event==='console output'){const value=String(m.args?.[0]||'');proof.ansi||=value.includes('\u001b[');proof.ready||=value.includes('-> Ready');}
    fs.appendFileSync(path.join(dir,'console-events.jsonl'),JSON.stringify({at:new Date().toISOString(),...m})+'\n');fs.writeFileSync(path.join(dir,'console-proof.json'),JSON.stringify(proof,null,2));});
   socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Native console WebSocket failed'));});socket.addEventListener('close',()=>{clearTimeout(timer);proof.finished_at=new Date().toISOString();fs.writeFileSync(path.join(dir,'console-proof.json'),JSON.stringify(proof,null,2));resolve();});});
  console.log(JSON.stringify(proof));
 }else if(phase==='settings'){
  await checked();const p='/ss14/server_config.toml';let view=(await api(endpoint()+'/game-settings?file='+encodeURIComponent(p))).attributes;
  let before=await read(p);const offline=(await resources()).current_state==='offline';
  if(offline&&!before.includes(Buffer.from('VOLTRA_SS14_COMMENT'))){const r=await raw(endpoint()+'/files/write?file='+encodeURIComponent(p),'POST','# VOLTRA_SS14_COMMENT\n'+before.toString('utf8'));if(!r.ok)throw Error('Owned comment fixture failed');before=await read(p);view=(await api(endpoint()+'/game-settings?file='+encodeURIComponent(p))).attributes;}
  const changes={'game/hostname':'SS14 typed native $safe','net/tickrate':'25','game/soft_max_players':'10','net/max_connections':'10'};
  for(const key of Object.keys(changes))if(!view.fields.some(f=>f.key===key&&!f.readonly))throw Error('Expected typed field unavailable '+key);
  const r=await raw(endpoint()+'/game-settings?file='+encodeURIComponent(p),'PUT',{revision:view.revision,settings:changes});
  if(!offline){if(r.status!==409)throw Error('Running configuration edit allowed');s.running_write_status=r.status;}
  else{
   if(r.status!==200)throw Error('Typed native TOML write failed '+r.status);const after=await read(p);
   const next=(await api(endpoint()+'/game-settings?file='+encodeURIComponent(p))).attributes;
   for(const [key,value]of Object.entries(changes))if(String(next.fields.find(f=>f.key===key)?.value)!==value)throw Error('Typed readback mismatch '+key);
   const stale=await raw(endpoint()+'/game-settings?file='+encodeURIComponent(p),'PUT',{revision:view.revision,settings:{'net/tickrate':'26'}});if(stale.status!==409)throw Error('Stale native revision accepted');
   fs.writeFileSync(path.join(dir,'settings-before.toml'),before);fs.writeFileSync(path.join(dir,'settings-after.toml'),after);
   const mask=t=>t.replace(/^(hostname|tickrate|soft_max_players|max_connections)\s*=.*$/gm,'$1=VALUE');if(mask(before.toString())!==mask(after.toString())||!after.includes(Buffer.from('VOLTRA_SS14_COMMENT')))throw Error('Unrelated native TOML bytes changed');
   s.settings_roundtrip={before_sha256:digest(before),after_sha256:digest(after),unrelated_bytes_preserved:true,comment_preserved:true,stale_status:stale.status,values:changes};
  }save();console.log(JSON.stringify({running_write_status:s.running_write_status,roundtrip:s.settings_roundtrip}));
 }else if(phase==='guard-check'){
  await checked();if((await resources()).current_state!=='offline')throw Error('Guard fixture requires offline server');const p='/ss14/server_config.toml',route=endpoint()+'/game-settings?file='+encodeURIComponent(p),before=await read(p);
  const view=(await api(route)).attributes;s.api_model=view.fields.map(f=>({key:f.key,label:f.label,type:f.type,readonly:f.readonly,min:f.min,max:f.max,maxLength:f.maxLength}));
  s.guard_checks=[];for(const settings of [{'net/tickrate':'0'},{'game/hostname':'界'.repeat(49)},{'game/soft_max_players':'1.0'},{'hub/advertise':true}]){const r=await raw(route,'PUT',{revision:view.revision,settings});s.guard_checks.push({keys:Object.keys(settings),status:r.status});if(r.status!==422)throw Error('Scalar/listing guard failed '+r.status);}
  if(!(await read(p)).equals(before))throw Error('Rejected writes changed native config');
  const wrong=before.toString().replace(/^tickrate\s*=\s*25\s*$/m,'tickrate="25"');if(wrong===before.toString())throw Error('Wrong-kind fixture original not found');
  try{const r=await raw(endpoint()+'/files/write?file='+encodeURIComponent(p),'POST',wrong);if(!r.ok)throw Error('Wrong-kind owned fixture write failed');const invalid=(await api(route)).attributes;const field=invalid.fields.find(f=>f.key==='net/tickrate');if(!field?.readonly)throw Error('Wrong-kind native scalar not readonly');const rejected=await raw(route,'PUT',{revision:invalid.revision,settings:{'net/tickrate':'30'}});if(rejected.status!==422)throw Error('Wrong-kind typed write accepted');s.wrong_kind={readonly:true,patch_status:rejected.status};}
  finally{const restore=await raw(endpoint()+'/files/write?file='+encodeURIComponent(p),'POST',before.toString());if(!restore.ok)throw Error('Owned valid config restore failed');}
  if(!(await read(p)).equals(before))throw Error('Wrong-kind fixture restore mismatch');save();console.log(JSON.stringify({guard_checks:s.guard_checks,wrong_kind:s.wrong_kind,model:s.api_model}));
 }else if(phase==='permissions'){
  await checked();if((await resources()).current_state!=='offline')throw Error('Permission writes require offline');
  if(!s.reader){const suffix=Date.now();s.reader=(await api('/api/application/users','POST',{username:'ss14reader'+suffix,email:'ss14reader'+suffix+'@example.invalid',first_name:'SS14',last_name:'Reader',root_admin:false})).attributes;save();}
  const account=(await(await raw('/api/client/account','GET',undefined,s.reader.id)).json()).attributes;if(account.id!==s.reader.id||account.root_admin)throw Error('Actual non-admin identity missing');
  if(!s.subuser){s.subuser=(await api(endpoint()+'/users','POST',{email:s.reader.email,permissions:['file.read','file.read-content']})).attributes;save();}
  const route=endpoint()+'/game-settings?file=%2Fss14%2Fserver_config.toml';const r=await raw(route,'GET',undefined,s.reader.id);const view=(await r.json()).attributes;
  const write=await raw(route,'PUT',{revision:view.revision,settings:{'game/hostname':'forbidden edit'}},s.reader.id);const unauth=await fetch('http://127.0.0.1:18100/api/servers/'+s.fixture.server.uuid);
  if(r.status!==200||write.status!==403||unauth.status!==401)throw Error('Native permission boundary failed');s.permissions={identity:'Actual isolated database user via supported loopback development header; no production browser/session claim',read:r.status,write:write.status,wings_unauth:unauth.status};save();console.log(JSON.stringify(s.permissions));
 }else if(phase==='snapshot'){
  await checked();if((await resources()).current_state!=='offline')throw Error('Snapshot requires stopped native server');
  const output=docker(['run','--rm','--network','none','--memory','128m','--memory-swap','128m','--cpus','1','--mount',`type=bind,src=/var/lib/voltra-parity-20261029/volumes/${s.fixture.server.uuid},dst=/v,readonly`,'alpine:3.22','sh','-c',"cd /v && find ss14/server_config.toml ss14/data -type f -exec sha256sum '{}' ';' -exec stat -c '%a %u %g %s %n' '{}' ';' | sort"]);
  s.snapshots??=[];s.snapshots.push({at:new Date().toISOString(),sha256:digest(output),rows:output.trim().split('\n')});save();fs.writeFileSync(path.join(dir,'snapshot-'+s.snapshots.length+'.txt'),output);console.log(JSON.stringify({snapshot:s.snapshots.length,rows:s.snapshots.at(-1).rows.length,sha256:s.snapshots.at(-1).sha256}));
 }else if(phase==='tick-query'){
  await checked();if((await resources()).current_state!=='running')throw Error('Native cvar query requires running server');
  await api(endpoint()+'/command','POST',{command:'cvar net.tickrate'});await new Promise(r=>setTimeout(r,750));
  const log=docker(['logs',s.fixture.server.uuid],true).toString('utf8').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'');
  s.tick_query={at:new Date().toISOString(),command:'cvar net.tickrate',native_lines:log.split('\n').filter(x=>x.includes('net.tickrate')).slice(-8)};save();console.log(JSON.stringify(s.tick_query));
 }else if(phase==='protocol'){
  await checked();if((await resources()).current_state!=='running')throw Error('Native server not ready');s.protocol={at:new Date().toISOString(),responses:{}};
  for(const route of ['status','info']){const r=await fetch('http://127.0.0.1:'+s.lease.ports[0]+'/'+route);const body=await r.json();if(!r.ok)throw Error('Native '+route+' failed');fs.writeFileSync(path.join(dir,route+'.json'),JSON.stringify(body,null,2));s.protocol.responses[route]={status:r.status,body};}
  const info=s.protocol.responses.info.body;s.protocol.authentication_required=info.auth?.mode==='Required';if(!s.protocol.authentication_required)throw Error('Native authentication unexpectedly not Required');
  const manifest=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/ss14-native-manifest.json'));
  s.protocol.client_hash_matches=info.build?.hash?.toLowerCase()===manifest.pinned_build.client.sha256.toLowerCase();s.protocol.version_matches=info.build?.version===manifest.pinned_id;
  if(!s.protocol.client_hash_matches||!s.protocol.version_matches)throw Error('Publisher client build mismatch');
  s.protocol.player_client=false;save();console.log(JSON.stringify({required_auth:true,version_matches:true,client_hash_matches:true,status:s.protocol.responses.status.body}));
 }else if(phase==='reinstall'){
  if(process.env.SS14_INSTALL_GO!=='1')throw Error('Coordinator reinstall GO required');await checked();if((await resources()).current_state!=='offline')throw Error('Native reinstall requires offline');
  const profile=process.env.SS14_USE_SERVED_PROFILE==='1'?(s.catalog_profile??s.profile):s.profile;
  if(JSON.stringify(profile.egg.variables)!==JSON.stringify(s.profile.egg.variables))throw Error('Original ordered controls changed');
  s.slot=acquireInstaller(s.lease.lease_id,owner);s.slot_released=false;save();
  const exported=await api('/api/admin/eggs/'+s.fixture.egg.id+'/export');const egg=exported.attributes??exported;
  egg.scripts.installation.script=(await import('./campaign-native-20261029.mjs')).installerGate(profile.egg.scripts.installation.script,s.slot.token);
  if(egg.startup!==profile.egg.startup)throw Error('Unexpected startup change needs explicit review');
  await api('/api/admin/eggs/'+s.fixture.egg.id+'/import','POST',egg);await api(endpoint()+'/settings/reinstall','POST',{});
  const held=await waitNativeInstaller(s.fixture);s.reinstall_proof=held.proof;s.reinstaller_id=held.container.Id;
  const stamp=Date.now();s.reinstaller_log='reinstaller-'+stamp+'.log';s.reinstaller_wait='reinstaller-'+stamp+'-wait.txt';
  s.reinstaller_log_follower=followLog(held.container.Id,s.reinstaller_log);s.reinstaller_wait_follower=followWait(held.container.Id,s.reinstaller_wait);s.phase='reinstalling';save();
  releaseGate(held.container,s.lease,s.slot.token);console.log(JSON.stringify({phase:s.phase,limits:s.reinstall_proof,using_reviewed_served_profile:process.env.SS14_USE_SERVED_PROFILE==='1'}));
  s.reinstall_outcome=await waitInstallOutcome(s.fixture,{timeoutMs:600000});save();
  if(docker(['ps','-aq','--filter','name='+s.fixture.server.uuid+'_installer']).trim())throw Error('Installer still exists; keep slot');
  for(let i=0;i<20&&!fs.readFileSync(path.join(dir,s.reinstaller_wait),'utf8').trim();i++)await new Promise(r=>setTimeout(r,50));
  s.reinstaller_raw_wait=fs.readFileSync(path.join(dir,s.reinstaller_wait),'utf8').trim();
  releaseInstaller(s.slot);s.slot_released=true;
  if(s.reinstall_outcome.success){s.profile_history??=[];s.profile_history.push({sha256:digest(JSON.stringify(s.profile)),runtime:s.runtime_history?.[0]?.binary_sha256});s.profile=profile;s.phase='reinstalled';}save();console.log(JSON.stringify({outcome:s.reinstall_outcome,actual_docker_wait:s.reinstaller_raw_wait}));
 }else if(phase==='cleanup'){
  await checked();const f=s.fixture;if(f?.server){if(containers().some(c=>c.State.Running))throw Error('Owned native process must be stopped first');await api('/api/application/servers/'+f.server.id,'DELETE');}
  if(s.reader)await api('/api/application/users/'+s.reader.id,'DELETE');for(const a of f?.allocations||[])await api('/api/application/nodes/1/allocations/'+a.id,'DELETE');
  if(f?.egg)await api('/api/admin/eggs/'+f.egg.id,'DELETE');if(f?.nest)await api('/api/admin/nests/'+f.nest.id,'DELETE');
  if(f?.server){if(docker(['ps','-aq','--filter','name='+f.server.uuid]).trim())throw Error('Owned containers remain');const uuid=f.server.uuid;if(!/^[a-f0-9-]{36}$/.test(uuid))throw Error('Owned UUID invalid');
   const proof=docker(['run','--rm','--network','none','--memory','128m','--memory-swap','128m','--cpus','1','--mount','type=bind,src=/var/lib/voltra-parity-20261029,dst=/campaign','alpine:3.22','sh','-c',`test ! -d /campaign/machine-id/${uuid} && rm -f -- /campaign/machine-id/${uuid}; for p in /campaign/volumes/${uuid} /campaign/tmp/${uuid} /campaign/machine-id/${uuid}; do test ! -e "$p" || exit 71; done; echo OWNED_PATHS_ABSENT`]);if(!proof.includes('OWNED_PATHS_ABSENT'))throw Error('Owned filesystem cleanup incomplete');}
  if(s.slot&&!s.slot_released){releaseInstaller(s.slot);s.slot_released=true;}s.lease=releaseNative(s.lease.lease_id,owner,'tested',true);s.cleanup={at:new Date().toISOString(),owned_server_records_user_allocations_containers_and_paths_removed:true};save();console.log(JSON.stringify(s.cleanup));
 }else throw Error('Use resume|install|install-outcome|start|stop|restart|wait-ready|observe|settings|permissions|snapshot|protocol|cleanup');
}catch(error){if(phase!=='console-watch'){s.error={at:new Date().toISOString(),phase,message:String(error)};save();}throw error;}
