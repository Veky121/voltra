// Root-assigned Windows Docker native acceptance. Runtime/lease/install slot
// are checked before every mutation; preparation never grants acquisition.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {api,docker,verifyRuntime,profileFromRuntime,claimNative,activeLease,acquireInstaller,
 releaseInstaller,releaseNative,createNativeFixture,waitNativeInstaller,waitInstallOutcome,
 releaseGate,containers,digest,runtime} from './campaign-native-20261029.mjs';

const recipe='cryofall/egg-cryo-fall.json',owner='cryofall_native';
const dir=path.resolve('.local/game-parity-20261029/cryofall-native');
fs.mkdirSync(dir,{recursive:true});
const stateFile=path.join(dir,'state.json');
let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):{};
const save=()=>{const tmp=stateFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(state,null,2),{mode:0o600});fs.renameSync(tmp,stateFile);};
const event=(kind,data)=>{fs.appendFileSync(path.join(dir,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),kind,...data})+'\n');};
const endpoint=()=>'/api/client/servers/'+state.fixture.server.uuid;
async function raw(p,method='GET',body,user){
 const headers={};if(body!==undefined&&typeof body!=='string')headers['Content-Type']='application/json';
 if(user)headers['X-Dev-User-ID']=String(user);
 return fetch('http://127.0.0.1:18099'+p,{method,headers,body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
}
async function checkedRuntime(){
 if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Root activation pause is active');
 const receipt=await verifyRuntime();
 if(receipt.binary_sha256==='e093a70539795bd89b3e3863059f0c6a57dd80ab3193e6fb72a7cf9b088130f8')throw Error('Fresh root activation required');
 if(state.runtime&&receipt.binary_sha256!==state.runtime.binary_sha256)throw Error('Runtime changed during owned run');
 return receipt;
}
function owned(){return activeLease(state.lease.lease_id,owner);}
async function resources(){return (await api(endpoint()+'/resources')).attributes;}
async function fileRead(file){const r=await raw(endpoint()+'/files/contents?file='+encodeURIComponent(file));if(!r.ok)throw Error('File read failed: '+r.status);return Buffer.from(await r.arrayBuffer());}
async function power(signal){
 await checkedRuntime();owned();
 if(signal==='start'||signal==='restart'){
  const startup=(await api(endpoint()+'/startup')).data||[];
  const automatic=startup.find(row=>row.attributes?.env_variable==='AUTO_UPDATE')?.attributes;
  if(!automatic)throw Error('Original automatic-update startup row missing');
  if(String(automatic.server_value??automatic.default_value)==='1'){
   const slot=JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).installer_slot;
   if(!state.slot||slot?.token!==state.slot.token)throw Error('Startup update needs owned serialized acquisition slot');
  }
 }
 const before=await resources();await api(endpoint()+'/power','POST',{signal});event('power',{signal,before:before.current_state});
}
function inspectNative(){const ids=docker(['ps','-aq','--filter','name='+state.fixture.server.uuid]).trim().split(/\s+/).filter(Boolean);return ids.length?JSON.parse(docker(['inspect',...ids])):[];}
const phase=process.argv[2];
try {
 if(phase==='resume'){
  if(process.env.CRYOFALL_RESUME_GO!=='1')throw Error('Fresh root resume handoff required');
  if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Root activation pause not released');
  const receipt=await verifyRuntime();owned();const profile=profileFromRuntime(recipe,receipt);
  if(process.env.CRYOFALL_EXPECTED_PANEL_SHA&&receipt.binary_sha256!==process.env.CRYOFALL_EXPECTED_PANEL_SHA)throw Error('Unexpected resume panel hash');
  if(digest(JSON.stringify(profile.egg))!==digest(JSON.stringify(state.profile.egg)))throw Error('CryoFall egg changed during activation; explicit reinstall review required');
  state.runtime_history??=[];state.runtime_history.push(state.runtime);state.runtime=receipt;state.profile=profile;save();console.log(JSON.stringify({resumed:true,pid:receipt.pid,binary_sha256:receipt.binary_sha256,egg_unchanged:true}));
 }else if(phase==='claim'){
  state.runtime=await checkedRuntime();
  if(state.lease)owned();else state.lease=claimNative({game:recipe,owner,memory_mib:3072,disk_mib:8192,ports:1});
  state.profile=profileFromRuntime(recipe,state.runtime);state.profile_sha256=digest(JSON.stringify(state.profile));save();
  console.log(JSON.stringify({lease:state.lease,runtime_sha256:state.runtime.binary_sha256,awaiting_installer_handoff:true}));
 }else if(phase==='install'){
  if(process.env.CRYOFALL_INSTALL_GO!=='1')throw Error('Coordinator installer handoff required');
  await checkedRuntime();owned();if(state.fixture?.server)throw Error('Existing owned server; inspect it instead of creating twice');
  state.slot=acquireInstaller(state.lease.lease_id,owner);save();
  const id=digest(recipe).slice(0,16);state.options=(await api('/api/client/game-library/templates/'+id)).attributes;
  state.port_plan=await api('/api/client/game-library/templates/'+id+'/ports','POST',{node_id:1,environment:Object.fromEntries(state.options.variables.map(v=>[v.env_variable,v.default_value]))});save();
  state.fixture=await createNativeFixture({lease:state.lease,slot:state.slot,profile:state.profile,name:'Campaign CryoFall native defaults',onStep:async fixture=>{state.fixture=fixture;save();}});save();
  const observed=await waitNativeInstaller(state.fixture);state.installer_proof=observed.proof;
  state.installer_cgroup=docker(['exec',observed.container.Id,'sh','-c','cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max']).trim();save();
  const archive=path.resolve('.local/strategy-survival-games/dotnet-6.0.36-linux-x64.tar.gz');
  const sha='e269fa26930f08c6df920969a4e6c36138372115e193db3cccbbaa06f61e15be';
  if(fs.statSync(archive).size!==39884693||digest(fs.readFileSync(archive))!==sha)throw Error('Pinned .NET6 cache identity mismatch');
  docker(['exec',observed.container.Id,'mkdir','-p','/mnt/server/.voltra/public-cache']);
  docker(['cp',archive,observed.container.Id+':/mnt/server/.voltra/public-cache/'+sha]);
  if(!docker(['exec',observed.container.Id,'sha256sum','/mnt/server/.voltra/public-cache/'+sha]).startsWith(sha))throw Error('Runtime cache copy mismatch');
  state.dotnet_cache={sha256:sha,bytes:39884693,public_identity_verified:true};save();
  releaseGate(observed.container,state.lease,state.slot.token);state.phase='installing';save();
  console.log(JSON.stringify({phase:state.phase,uuid:state.fixture.server.uuid,installer:state.installer_proof}));
 }else if(phase==='install-outcome'){
  await checkedRuntime();owned();
  if(state.install_outcome){state.install_history??=[];state.install_history.push(state.install_outcome);}
  state.install_outcome=await waitInstallOutcome(state.fixture,{timeoutMs:45000});save();
  const ids=docker(['ps','-aq','--filter','name='+state.fixture.server.uuid+'_installer']).trim();
  if(ids){try{fs.writeFileSync(path.join(dir,'installer.log'),docker(['logs',ids],true));}catch{}}
  // Keep the acquisition slot across the first default AUTO_UPDATE=1 boot.
  // Steam runs in the game container there, so installer-count alone is weak.
  const update=(await api(endpoint()+'/startup')).data.find(row=>row.attributes?.env_variable==='AUTO_UPDATE')?.attributes;
  state.keep_slot_for_default_boot=state.install_outcome.success&&String(update?.server_value??update?.default_value)==='1';save();
  if(!state.keep_slot_for_default_boot){releaseInstaller(state.slot);state.installer_slot_released=true;save();}
  console.log(JSON.stringify(state.install_outcome));
 }else if(phase==='start'){
  await checkedRuntime();owned();
  const a=(await api('/api/application/servers/'+state.fixture.server.id)).attributes;
  if(a.container?.installed!==1||a.status)throw Error('Installation not complete');
  const helpers=[...state.profile.egg.scripts.installation.script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].filter(m=>m[1].endsWith('.py'));
  const actual=docker(['run','--rm','--network','none','--memory','128m','--memory-swap','128m','--cpus','1','--mount',`type=bind,src=/var/lib/voltra-parity-20261029/volumes/${state.fixture.server.uuid},dst=/v,readonly`,'alpine:3.22','sha256sum',...helpers.map(m=>'/v/'+m[1])]).trim().split('\n');
  state.helpers=helpers.map((m,i)=>({file:m[1],expected:digest(m[3]+'\n'),actual:actual[i].split(/\s+/)[0]}));
  if(state.helpers.some(h=>h.expected!==h.actual))throw Error('Installed helper differs from active canonical egg');save();
  await power('start');state.phase='starting';save();console.log(JSON.stringify({phase:state.phase,helpers:state.helpers.length,uuid:state.fixture.server.uuid}));
 }else if(phase==='wait-ready'){
  await checkedRuntime();owned();const until=Date.now()+45000;let ready=false;
  while(Date.now()<until){if((await resources()).current_state==='running'){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,1000));}
  if(!ready)throw Error('Native readiness timeout');console.log('running');
 }else if(phase==='observe'){
  await checkedRuntime();owned();state.resources=await resources();
  state.native=inspectNative().map(c=>({id:c.Id,name:c.Name,state:c.State,limits:{memory:c.HostConfig.Memory,cpu_period:c.HostConfig.CpuPeriod,cpu_quota:c.HostConfig.CpuQuota,swap:c.HostConfig.MemorySwap,oom_disabled:c.HostConfig.OomKillDisable}}));
  const game=state.native.find(c=>c.name==='/'+state.fixture.server.uuid);
  if(game){
   if(game.limits.memory!==state.lease.memory_mib*1024**2||game.limits.swap!==game.limits.memory||game.limits.cpu_period!==100000||game.limits.cpu_quota!==100000||game.limits.oom_disabled===true)throw Error('Native hard resource limits mismatch');
   const log=docker(['logs',game.id],true);fs.writeFileSync(path.join(dir,'native.log'),log);fs.writeFileSync(path.join(dir,'native-'+Date.now()+'.log'),log);event('native-observation',{state:game.state,resources:state.resources.current_state});
  }
  try{state.settings=(await api(endpoint()+'/game-settings?file=%2FData%2FSettingsServer.xml')).attributes;}catch(e){state.settings_error=String(e);}
  save();console.log(JSON.stringify({resources:state.resources.current_state,native:state.native,settings:state.settings?{file:state.settings.file,fields:state.settings.fields.map(f=>({key:f.key,type:f.type,readonly:f.readonly}))}:state.settings_error}));
 }else if(phase==='ready-handoff'){
  await checkedRuntime();owned();
  const log=docker(['logs',state.fixture.server.uuid],true).toString('utf8');
  if((await resources()).current_state!=='running'||!log.includes('UDPServer: Socket-server listening on'))throw Error('Real default boot readiness not yet proved');
  state.default_boot={at:new Date().toISOString(),readiness:true,raw_ansi:log.includes('\u001b['),startup:'original defaults including AUTO_UPDATE=1',gameplay_client:false};
  await api(endpoint()+'/startup/variable','PUT',{key:'AUTO_UPDATE',value:'0'});
  releaseInstaller(state.slot);state.installer_slot_released=true;state.keep_slot_for_default_boot=false;save();console.log(JSON.stringify(state.default_boot));
 }else if(phase==='stop'||phase==='restart'){
  await power(phase);state.phase=phase==='stop'?'stopping':'restarting';save();console.log(state.phase);
 }else if(phase==='settings'){
  await checkedRuntime();owned();let view=(await api(endpoint()+'/game-settings?file=%2FData%2FSettingsServer.xml')).attributes;
  let before=await fileRead('/Data/SettingsServer.xml');
  if((await resources()).current_state==='offline'&&!state.comment_fixture){
   fs.writeFileSync(path.join(dir,'settings-before-comment.xml'),before);
   const original=before.toString('utf8');if(!original.includes('</settings>'))throw Error('Native XML closing root missing');
   const tagged=original.replace('</settings>','<!-- VOLTRA_NATIVE_COMMENT_SENTINEL -->\n</settings>');
   const write=await raw(endpoint()+'/files/write?file=%2FData%2FSettingsServer.xml','POST',tagged);if(!write.ok)throw Error('Owned native comment fixture write failed');
   state.comment_fixture={marker:'VOLTRA_NATIVE_COMMENT_SENTINEL',injected_offline:true};save();
   before=await fileRead('/Data/SettingsServer.xml');view=(await api(endpoint()+'/game-settings?file=%2FData%2FSettingsServer.xml')).attributes;
  }
  fs.writeFileSync(path.join(dir,'settings-before.xml'),before);
  const r=await raw(endpoint()+'/game-settings?file=%2FData%2FSettingsServer.xml','PUT',{revision:view.revision,settings:{'server/name':'CryoFall native roundtrip','server/players_max_count':'4'}});
  const body=await r.json();state.settings_write={status:r.status,current_state:(await resources()).current_state};
  if(state.settings_write.current_state!=='offline'){if(r.status!==409)throw Error('Running settings write not rejected');state.running_write=state.settings_write;}
  else {
   if(r.status!==200)throw Error('Stopped settings write failed');
   const after=await fileRead('/Data/SettingsServer.xml');fs.writeFileSync(path.join(dir,'settings-after.xml'),after);
   const reload=(await api(endpoint()+'/game-settings?file=%2FData%2FSettingsServer.xml')).attributes;
   if(reload.fields.find(f=>f.key==='server/name')?.value!=='CryoFall native roundtrip'||reload.fields.find(f=>f.key==='server/players_max_count')?.value!=='4')throw Error('Typed readback mismatch');
   const stale=await raw(endpoint()+'/game-settings?file=%2FData%2FSettingsServer.xml','PUT',{revision:view.revision,settings:{'server/players_max_count':'5'}});
   if(stale.status!==409)throw Error('Stale revision accepted');
   const denied=await raw(endpoint()+'/game-settings?file=%2FData%2FSettingsServer.xml','PUT',{revision:reload.revision,settings:{'network/port':'1'}});
   if(denied.status!==422)throw Error('Runtime-owned field accepted');
   const maskChanged=text=>text.replace(/(<name(?:\s[^>]*)?>)[\s\S]*?(<\/name>)/,'$1VALUE$2').replace(/(<players_max_count(?:\s[^>]*)?>)[\s\S]*?(<\/players_max_count>)/,'$1VALUE$2');
   if(maskChanged(before.toString('utf8'))!==maskChanged(after.toString('utf8')))throw Error('Typed editor changed bytes outside selected native values');
   if(!after.includes(Buffer.from('VOLTRA_NATIVE_COMMENT_SENTINEL')))throw Error('Typed editor lost operator comment');
   state.roundtrip={before_sha256:digest(before),after_sha256:digest(after),readback:true,unrelated_bytes_preserved:true,comment_preserved:true,stale_status:stale.status,runtime_key_status:denied.status};
  }
  save();console.log(JSON.stringify({write:state.settings_write,roundtrip:state.roundtrip}));
 }else if(phase==='persistence'){
  await checkedRuntime();owned();
  const data=await fileRead('/Data/SettingsServer.xml'),text=data.toString('utf8');
  const view=(await api(endpoint()+'/game-settings?file=%2FData%2FSettingsServer.xml')).attributes;
  const values=Object.fromEntries(view.fields.map(f=>[f.key,f.value]));
  if(values['server/name']!=='CryoFall native roundtrip'||values['server/players_max_count']!=='4')throw Error('Native settings values lost after lifecycle');
  const proof={at:new Date().toISOString(),state:(await resources()).current_state,values,comment_preserved:text.includes('VOLTRA_NATIVE_COMMENT_SENTINEL'),xml_sha256:digest(data),same_bytes_as_typed_write:data.equals(fs.readFileSync(path.join(dir,'settings-after.xml')))};
  state.persistence??=[];state.persistence.push(proof);save();console.log(JSON.stringify(proof));
 }else if(phase==='crash'){
  await checkedRuntime();owned();if((await resources()).current_state!=='running')throw Error('Crash fixture requires running native server');
  const code="import os,signal,json; matches=[]\nfor entry in os.listdir('/proc'):\n if entry.isdigit():\n  try:\n   argv=open('/proc/'+entry+'/cmdline','rb').read().split(b'\\0')\n   if len(argv)>1 and argv[0].endswith(b'/dotnet') and argv[1].endswith(b'/CryoFall_Server.dll'): matches.append(int(entry))\n  except (FileNotFoundError,PermissionError): pass\nassert len(matches)==1,matches\nprint(json.dumps({'child_pid':matches[0],'signal':9}),flush=True);os.kill(matches[0],signal.SIGKILL)";
  state.crash={at:new Date().toISOString(),injected:true,proof:JSON.parse(docker(['exec','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib',state.fixture.server.uuid,'/home/container/.voltra/python/bin/python3','-c',code]).trim())};save();console.log(JSON.stringify(state.crash));
 }else if(phase==='permissions'){
  await checkedRuntime();owned();if((await resources()).current_state!=='offline')throw Error('Permission save tests require offline server');
  if(!state.reader){const suffix=Date.now();state.reader=(await api('/api/application/users','POST',{username:'cryoreader'+suffix,email:'cryoreader'+suffix+'@example.invalid',first_name:'Native',last_name:'Reader',root_admin:false})).attributes;save();}
  const identity=await raw('/api/client/account','GET',undefined,state.reader.id);const account=(await identity.json()).attributes;
  if(account.id!==state.reader.id||account.root_admin)throw Error('Non-admin identity not established');
  if(!state.subuser){state.subuser=(await api(endpoint()+'/users','POST',{email:state.reader.email,permissions:['file.read','file.read-content']})).attributes;save();}
  const read=await raw(endpoint()+'/game-settings?file=%2FData%2FSettingsServer.xml','GET',undefined,state.reader.id);const view=(await read.json()).attributes;
  const write=await raw(endpoint()+'/game-settings?file=%2FData%2FSettingsServer.xml','PUT',{revision:view.revision,settings:{'server/name':'forbidden edit'}},state.reader.id);
  if(read.status!==200||write.status!==403)throw Error('Non-admin permission boundary mismatch');
  const unauth=await fetch('http://127.0.0.1:18100/api/servers/'+state.fixture.server.uuid);
  if(unauth.status!==401)throw Error('Unauthenticated Wings request accepted');
  state.permissions={identity:'real isolated user via supported loopback dev header; no production session/auth claim',read_status:read.status,write_status:write.status,wings_unauthenticated:unauth.status};save();console.log(JSON.stringify(state.permissions));
 }else if(phase==='protocol'){
  await checkedRuntime();owned();
  if((await resources()).current_state!=='running')throw Error('Native server must be running');
  const table=docker(['exec',state.fixture.server.uuid,'sh','-c','cat /proc/net/udp /proc/net/udp6']);
  fs.writeFileSync(path.join(dir,'native-udp.txt'),table);
  const bound=table.split('\n').some(line=>parseInt((line.trim().split(/\s+/)[1]||'').split(':').at(-1),16)===state.lease.ports[0]);
  if(!bound)throw Error('Expected game UDP port absent');
  state.protocol={native_udp_bound:true,port:state.lease.ports[0],scope:'actual native process/container socket table; no guessed proprietary handshake',player_client:false};save();console.log(JSON.stringify(state.protocol));
 }else if(phase==='console-watch'){
  await checkedRuntime();owned();
  const grant=(await api(endpoint()+'/websocket')).data;
  const proof={started_at:new Date().toISOString(),authenticated:false,events:{},statuses:[],ansi:false,readiness:false};
  const socket=new WebSocket(grant.socket);let finished=false;
  const finish=error=>{if(finished)return;finished=true;proof.finished_at=new Date().toISOString();if(error)proof.error=String(error);fs.writeFileSync(path.join(dir,'console-proof.json'),JSON.stringify(proof,null,2));socket.close();};
  await new Promise((resolve,reject)=>{
   const deadline=setTimeout(()=>{finish();resolve();},180000);
   socket.addEventListener('open',()=>socket.send(JSON.stringify({event:'auth',args:[grant.token]})));
   socket.addEventListener('message',event=>{
    let m;try{m=JSON.parse(String(event.data));}catch{return;}
    proof.events[m.event]=(proof.events[m.event]||0)+1;
    if(m.event==='auth success'){proof.authenticated=true;socket.send(JSON.stringify({event:'send logs',args:[]}));socket.send(JSON.stringify({event:'send stats',args:[]}));console.log('Native console authenticated; capture active');}
    if(m.event==='status')proof.statuses.push({at:new Date().toISOString(),state:m.args?.[0]});
    if(m.event==='console output'){const text=String(m.args?.[0]||'');proof.ansi||=text.includes('\u001b[');proof.readiness||=text.includes('UDPServer: Socket-server listening on');}
    fs.appendFileSync(path.join(dir,'console-events.jsonl'),JSON.stringify({at:new Date().toISOString(),...m})+'\n');
    fs.writeFileSync(path.join(dir,'console-proof.json'),JSON.stringify(proof,null,2));
   });
   socket.addEventListener('error',()=>{clearTimeout(deadline);finish('Websocket error');reject(Error('Websocket error'));});
   socket.addEventListener('close',()=>{clearTimeout(deadline);finish();resolve();});
  });
  console.log(JSON.stringify(proof));
 }else if(phase==='snapshot'){
  await checkedRuntime();owned();if((await resources()).current_state!=='offline')throw Error('Snapshot requires offline native server');
  const uuid=state.fixture.server.uuid;
  const output=docker(['run','--rm','--network','none','--memory','128m','--memory-swap','128m','--cpus','1','--mount',`type=bind,src=/var/lib/voltra-parity-20261029/volumes/${uuid},dst=/v,readonly`,'alpine:3.22','sh','-c',"cd /v && find Data -type f -exec sha256sum '{}' ';' | sort"]);
  const metadata=docker(['run','--rm','--network','none','--memory','128m','--memory-swap','128m','--cpus','1','--mount',`type=bind,src=/var/lib/voltra-parity-20261029/volumes/${uuid},dst=/v,readonly`,'alpine:3.22','sh','-c',"cd /v && find Data -type f -exec stat -c '%a %u %g %s %n' '{}' ';' | sort"]);
  state.snapshots??=[];state.snapshots.push({at:new Date().toISOString(),sha256:digest(output),files:output.trim().split('\n'),metadata:metadata.trim().split('\n')});save();fs.writeFileSync(path.join(dir,'snapshot-'+state.snapshots.length+'.txt'),output);console.log(JSON.stringify({snapshot:state.snapshots.length,files:state.snapshots.at(-1).files.length,sha256:state.snapshots.at(-1).sha256}));
 }else if(phase==='reinstall-comment'){
  await checkedRuntime();owned();if((await resources()).current_state!=='offline')throw Error('Comment fixture requires offline');
  const data=(await fileRead('/Data/SettingsServer.xml')).toString('utf8');if(!data.includes('</settings>'))throw Error('Native XML root missing');
  const tagged=data.includes('VOLTRA_REINSTALL_COMMENT_SENTINEL')?data:data.replace('</settings>','<!-- VOLTRA_REINSTALL_COMMENT_SENTINEL -->\n</settings>');
  const response=await raw(endpoint()+'/files/write?file=%2FData%2FSettingsServer.xml','POST',tagged);if(!response.ok)throw Error('Reinstall comment write failed');
  console.log('Owned offline reinstall comment fixture ready');
 }else if(phase==='compare-reinstall'){
  await checkedRuntime();owned();if((await resources()).current_state!=='offline')throw Error('Comparison requires offline native server');
  const before=state.snapshots[3],after=state.snapshots.at(-1);if(before===after)throw Error('Take post-reinstall snapshot first');
  const files_equal=JSON.stringify(before.files)===JSON.stringify(after.files),metadata_equal=JSON.stringify(before.metadata)===JSON.stringify(after.metadata);
  state.reinstall_snapshot_index=state.snapshots.length;state.reinstall_preservation={files_equal,metadata_equal,before_files:before.files.length,after_files:after.files.length,comment_preserved:(await fileRead('/Data/SettingsServer.xml')).includes(Buffer.from('VOLTRA_REINSTALL_COMMENT_SENTINEL'))};save();
  console.log(JSON.stringify(state.reinstall_preservation));if(!files_equal||!metadata_equal||!state.reinstall_preservation.comment_preserved)throw Error('Reinstall preservation mismatch; inspect exact evidence');
 }else if(phase==='reinstall'){
  if(process.env.CRYOFALL_INSTALL_GO!=='1')throw Error('Coordinator reinstall handoff required');
  await checkedRuntime();owned();if((await resources()).current_state!=='offline')throw Error('Reinstall requires offline native server');
  state.slot=acquireInstaller(state.lease.lease_id,owner);state.installer_slot_released=false;save();
  const exportEgg=await api('/api/admin/eggs/'+state.fixture.egg.id+'/export');const egg=exportEgg.attributes??exportEgg;
  egg.scripts.installation.script=(await import('./campaign-native-20261029.mjs')).installerGate(state.profile.egg.scripts.installation.script,state.slot.token);
  await api('/api/admin/eggs/'+state.fixture.egg.id+'/import','POST',egg);
  await api(endpoint()+'/settings/reinstall','POST',{});
  const observed=await waitNativeInstaller(state.fixture);state.reinstall_proof=observed.proof;save();
  releaseGate(observed.container,state.lease,state.slot.token);state.phase='reinstalling';save();console.log(state.phase);
 }else if(phase==='cleanup'){
  await checkedRuntime();owned();const f=state.fixture;
  if(f?.server){const c=inspectNative();if(c.some(x=>x.State.Running))throw Error('Stop owned game/installer before cleanup');await api('/api/application/servers/'+f.server.id,'DELETE');}
  if(state.reader){await api('/api/application/users/'+state.reader.id,'DELETE');}
  for(const allocation of f?.allocations||[])await api('/api/application/nodes/1/allocations/'+allocation.id,'DELETE');
  if(f?.egg)await api('/api/admin/eggs/'+f.egg.id,'DELETE');if(f?.nest)await api('/api/admin/nests/'+f.nest.id,'DELETE');
  const remaining=f?.server?docker(['ps','-aq','--filter','name='+f.server.uuid]).trim():'';if(remaining)throw Error('Owned containers remain; review cleanup');
  if(f?.server){
   const uuid=f.server.uuid;if(!/^[a-f0-9-]{36}$/.test(uuid))throw Error('Invalid owned cleanup UUID');
   const proof=docker(['run','--rm','--network','none','--memory','128m','--memory-swap','128m','--cpus','1','--mount','type=bind,src=/var/lib/voltra-parity-20261029,dst=/campaign','alpine:3.22','sh','-c',`test ! -d /campaign/machine-id/${uuid} && rm -f -- /campaign/machine-id/${uuid}; for p in /campaign/volumes/${uuid} /campaign/tmp/${uuid} /campaign/machine-id/${uuid}; do test ! -e "$p" || exit 71; done; echo OWNED_PATHS_ABSENT`]);
   if(!proof.includes('OWNED_PATHS_ABSENT'))throw Error('Owned cleanup paths still present');state.cleanup_paths_absent=true;
  }
  state.cleanup={at:new Date().toISOString(),server_removed:true,allocations_removed:true,private_fixture_user_removed:state.reader?true:'not-created',containers_removed:true};
  if(state.slot&&!state.installer_slot_released){releaseInstaller(state.slot);state.installer_slot_released=true;}
  state.lease=releaseNative(state.lease.lease_id,owner,'tested',true);save();console.log(JSON.stringify(state.cleanup));
 }else throw Error('Use claim|resume|install|install-outcome|start|observe|ready-handoff|stop|restart|settings|permissions|protocol|console-watch|snapshot|reinstall|cleanup');
} catch(error){if(phase!=='console-watch'){state.error={at:new Date().toISOString(),phase,message:String(error)};save();}throw error;}
