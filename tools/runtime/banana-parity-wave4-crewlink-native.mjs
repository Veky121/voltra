// BetterCrewLink native acceptance, shared campaign admission and installer gate.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {runtime,api,docker,digest,verifyRuntime,profileFromRuntime,claimNative,activeLease,acquireInstaller,releaseInstaller,createNativeFixture,waitNativeInstaller,waitInstallOutcome,releaseGate,observePower,installerGate,createReaderFixture,readerRequest,removeReaderFixture,releaseNative} from './campaign-native-20261029.mjs';
const recipe='among_us/bettercrewlink_server/egg-better-crewlink-server.json',owner='crewlink_native_banana';
const dir=path.join(runtime,'banana-wave4-crewlink'),stateFile=path.join(dir,'state.json');
let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):{};
const save=()=>{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n');};
const owned=()=>activeLease(state.lease?.lease_id,owner);
const endpoint=()=>'/api/client/servers/'+state.fixture.server.uuid;
const config='/crewlink/config/peerConfig.yml';
const settings=()=>endpoint()+'/game-settings?file='+encodeURIComponent(config);
const publicAssets=[
 {file:'.local/among-us-games/crew.tar.gz',sha256:'7f65a378fa4aa388ddb19aa344820ef48a4ba75768f50f49ed15791be44b84cf'},
 {file:'.local/among-us-games/yarn.tgz',sha256:'c17d3797fb9a9115bf375e31bfd30058cac6bc9c3b8807a3d8cb2094794b51ca'},
];
function verifyPublicAssets(){return publicAssets.map(asset=>{if(digest(fs.readFileSync(asset.file))!==asset.sha256)throw Error('Retained publisher archive mismatch');return {...asset,bytes:fs.statSync(asset.file).size,verified:true};});}
async function raw(route,method='GET',body){const response=await fetch('http://127.0.0.1:18099'+route,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.text()};}
async function served(){
 const receipt=await verifyRuntime(),profile=profileFromRuntime(recipe,receipt);
 const marker="cat > .voltra/crewlink-controls.py <<'VOLTRA_CREWLINK_WAVE4'\n",script=profile.egg.scripts.installation.script;
 if(script.split(marker).length!==2)throw Error('Exactly one served CrewLink helper required');
 const body=script.split(marker)[1].split('VOLTRA_CREWLINK_WAVE4\n')[0];
 if(digest(body)!==digest(fs.readFileSync('internal/panel/game_library/scripts/crewlink-controls.py')))throw Error('Fresh seed helper snapshot required before native fixture');
 return {receipt,profile};
}
async function attachAndRelease(){
 const {container,proof}=await waitNativeInstaller(state.fixture);
 const cgroup=docker(['exec',container.Id,'sh','-c','cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max']).trim();
 const stamp=Date.now(),log=path.join(dir,`installer-${stamp}.log`),wait=path.join(dir,`installer-${stamp}.exit`),error=path.join(dir,`installer-${stamp}.stderr`);
 const logFd=fs.openSync(log,'a'),waitFd=fs.openSync(wait,'a'),errorFd=fs.openSync(error,'a');
 const logger=spawn('docker',['--context','desktop-linux','logs','--follow',container.Id],{detached:true,windowsHide:true,stdio:['ignore',logFd,logFd]});
 const waiter=spawn('docker',['--context','desktop-linux','wait',container.Id],{detached:true,windowsHide:true,stdio:['ignore',waitFd,errorFd]});
 logger.unref();waiter.unref();fs.closeSync(logFd);fs.closeSync(waitFd);fs.closeSync(errorFd);
 state.installers??=[];state.installers.push({at:new Date().toISOString(),proof,cgroup,log,wait,error,attached_before_release:true});save();
 for(let n=0;n<20&&!fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE');n++)await new Promise(r=>setTimeout(r,100));
 if(!fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE'))throw Error('Gate not captured; leave closed');
 docker(['exec',container.Id,'mkdir','-p','/mnt/server/.voltra/public-cache']);
 state.public_assets=verifyPublicAssets();
 for(const asset of state.public_assets){docker(['cp',path.resolve(asset.file),container.Id+':/mnt/server/.voltra/public-cache/'+asset.sha256]);if(!docker(['exec',container.Id,'sha256sum','/mnt/server/.voltra/public-cache/'+asset.sha256]).startsWith(asset.sha256))throw Error('Owned publisher archive cache copy mismatch');}
 save();
 releaseGate(container,state.lease,state.slot.token);state.status='installing';save();console.log(JSON.stringify({uuid:state.fixture.server.uuid,proof,cgroup,status:state.status}));
}
async function powerWithConsole(signal,action){
 const credentials=(await api(endpoint()+'/websocket')).data;
 const socketURL=new URL(credentials.socket);
 if(socketURL.protocol!=='ws:'||socketURL.hostname!=='127.0.0.1'||socketURL.port!=='18099'||socketURL.pathname!==endpoint()+'/ws')throw Error('Refuse console credential transport outside owned loopback fixture');
 const socket=new WebSocket(credentials.socket),events=[];
 try{await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Native console authentication timed out before action')),10000);
  socket.addEventListener('open',()=>socket.send(JSON.stringify({event:'auth',args:[credentials.token]})));
  socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Native panel console connection failed before action'));});
  socket.addEventListener('message',message=>{
   let value;try{value=JSON.parse(String(message.data));}catch{clearTimeout(timer);reject(Error('Invalid native console packet'));return;}
   if(value.event==='auth success'){clearTimeout(timer);resolve();}
   if(['status','console output','daemon message','stats'].includes(value.event))events.push({at:new Date().toISOString(),...value});
  });
 });}catch(error){socket.close();throw error;}
 const at=new Date().toISOString();
 let accepted=false;
 try{
  socket.send(JSON.stringify({event:'send stats',args:[]}));
  if(action)await action();else await api(endpoint()+'/power','POST',{signal});
  accepted=true;
  const began=Date.now();
  while(Date.now()-began<10000){
   const statuses=events.filter(event=>event.event==='status'&&event.at>=at).map(event=>event.args?.[0]);
   const target=['stop','controlled-crash'].includes(signal)?'offline':'running';
   if(statuses.at(-1)===target&&(signal!=='restart'||statuses.some(status=>['stopping','offline','starting'].includes(status))))break;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
 }finally{
  socket.close();
  const log=path.join(dir,`console-${signal}-${Date.now()}.json`);fs.writeFileSync(log,JSON.stringify(events,null,2)+'\n');
  const statuses=events.filter(event=>event.event==='status'&&event.at>=at).map(event=>event.args?.[0]);
  state.actions??=[];state.actions.push({signal,at,accepted,console_authenticated:true,console_events:events.length,statuses,log});save();
 }
 return state.actions.at(-1);
}
const phase=process.argv[2]||'plan';
if(phase==='plan'){
 const current=await served();console.log(JSON.stringify({recipe,pid:current.receipt.pid,sha256:current.receipt.binary_sha256,controls:current.profile.egg.variables.length,defaults:current.profile.defaults,resources:{memory_mib:512,disk_mib:4096,ports:1,cpu:100,swap:0},public_assets:verifyPublicAssets(),native_config:config,publisher:'https://github.com/OhMyGuus/BetterCrewLink-server',scope:'HTTP/Socket.IO signaling and lifecycle; actual Among Us audio/voice clients remain separate acceptance'}));
}else if(phase==='claim'){
 const current=await served();if(state.lease)owned();else state.lease=claimNative({game:recipe,owner,memory_mib:512,disk_mib:4096,ports:1});state.runtime=current.receipt;save();console.log(JSON.stringify({lease:state.lease}));
}else if(phase==='install'){
 owned();const current=await served();if(process.argv[3]!=='coordinator-handoff')throw Error('Coordinator handoff required');if(state.fixture?.server)throw Error('Owned fixture exists');verifyPublicAssets();
 for(const image of [current.profile.egg.scripts.installation.container,...Object.values(current.profile.egg.docker_images)])docker(['image','inspect',image]);
 if(JSON.parse(docker(['image','inspect',current.profile.egg.scripts.installation.container]))[0].Config.Entrypoint?.length)throw Error('Installer ENTRYPOINT must be empty');
 state.slot=acquireInstaller(state.lease.lease_id,owner);state.slot_released=false;state.runtime=current.receipt;state.profile=current.profile;save();
 state.fixture=await createNativeFixture({lease:state.lease,slot:state.slot,profile:state.profile,name:'Campaign BetterCrewLink native',environment:{},onStep:async partial=>{state.fixture=partial;save();}});await attachAndRelease();
}else if(phase==='installed'){
 owned();state.install_outcome=await waitInstallOutcome(state.fixture,{timeoutMs:55000});save();if(!state.slot_released){releaseInstaller(state.slot);state.slot_released=true;save();}
 const attempt=state.installers.at(-1);attempt.terminal_events=docker(['events','--since',attempt.at,'--until',new Date().toISOString(),'--filter','container='+attempt.proof.id,'--format','{{json .}}']).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));attempt.oom_observed=attempt.terminal_events.some(event=>event.Action==='oom'||event.status==='oom');attempt.actual_wait_code=fs.existsSync(attempt.wait)?fs.readFileSync(attempt.wait,'utf8').trim():null;save();
 save();console.log(JSON.stringify({outcome:state.install_outcome,actual_wait_code:attempt.actual_wait_code,oom_observed:attempt.oom_observed}));
}else if(phase==='reinstall'||phase==='retry-install'){
 owned();const current=await served();if(process.argv[3]!=='coordinator-handoff')throw Error('Coordinator handoff required');
 if(phase==='reinstall'){if((await observePower(state.fixture)).current_state!=='offline')throw Error('Stop before reinstall');}
 else{const actual=(await api('/api/application/servers/'+state.fixture.server.id)).attributes;if(actual.uuid!==state.fixture.server.uuid||!['install_failed','reinstall_failed'].includes(actual.status))throw Error('Owned failed installer required');const ids=docker(['ps','-aq','--filter','name='+actual.uuid]).trim().split(/\s+/).filter(Boolean);if(ids.length&&JSON.parse(docker(['inspect',...ids])).some(container=>container.State.Running))throw Error('Prior owned process still running');}
 verifyPublicAssets();
 const egg=(await api('/api/admin/eggs/'+state.fixture.egg.id)).attributes;if(egg.nest_id!==state.fixture.nest.id)throw Error('Owned egg mismatch');
 state.slot=acquireInstaller(state.lease.lease_id,owner);state.slot_released=false;state.runtime=current.receipt;state.profile=current.profile;save();
 await api('/api/admin/eggs/'+state.fixture.egg.id+'/scripts','PATCH',{script_install:installerGate(state.profile.egg.scripts.installation.script,state.slot.token),script_entry:state.profile.egg.scripts.installation.entrypoint,script_container:state.profile.egg.scripts.installation.container});
 await api(phase==='reinstall'?endpoint()+'/settings/reinstall':'/api/application/servers/'+state.fixture.server.id+'/reinstall','POST',{});await attachAndRelease();
}else if(['start','stop','restart'].includes(phase)){
 owned();await served();const actual=(await api('/api/application/servers/'+state.fixture.server.id)).attributes;if(actual.uuid!==state.fixture.server.uuid||actual.container?.installed!==1)throw Error('Owned installed server required');console.log(JSON.stringify(await powerWithConsole(phase)));
}else if(phase==='observe'){
 owned();const target=process.argv[3];if(!['running','offline'].includes(target))throw Error('Specify running or offline');state.lifecycle??=[];const began=Date.now();while(Date.now()-began<50000){const power=await observePower(state.fixture);state.lifecycle.push(power);save();if(power.current_state===target){console.log(JSON.stringify(power));process.exit(0);}await new Promise(r=>setTimeout(r,1000));}throw Error('Target not observed within50seconds');
}else if(phase==='health'){
 owned();const base='http://127.0.0.1:'+state.lease.ports[0],response=await fetch(base+'/health',{signal:AbortSignal.timeout(10000)}),health=await response.json();if(!response.ok||health.name!=='My BetterCrewLink'||typeof health.uptime!=='number')throw Error('Canonical default health response not observed');const lobbies=await fetch(base+'/lobbies',{signal:AbortSignal.timeout(10000)});state.health={at:new Date().toISOString(),status:response.status,body:health,lobbies_status:lobbies.status,lobbies:await lobbies.json()};save();console.log(JSON.stringify(state.health));
}else if(phase==='verify-planning'){
 owned();const current=await served(),route='/api/client/game-library/templates/'+digest(recipe).slice(0,16),options=(await api(route)).attributes;
 if(options.primary_port_env!=='PORT')throw Error('Fresh declared-primary metadata is not actually served');
 const environment=Object.fromEntries(options.variables.map(v=>[v.env_variable,v.default_value])),checks=[];
 for(const [mode,port,wantStatus] of [['blank','',200],['explicit','29191',200],['occupied',String(state.lease.ports[0]),422],['noncanonical','029191',422]]){
  const response=await raw(route+'/ports','POST',{node_id:1,environment:{...environment,PORT:port}}),body=JSON.parse(response.body);
  checks.push({mode,requested_port:port,status:response.status,body});
  if(response.status!==wantStatus||wantStatus===200&&(body.attributes?.ports?.length!==1||mode==='explicit'&&body.attributes.ports[0].port!==29191))throw Error('Live declared listener planning failed: '+mode);
 }
 state.fixed_planning={at:new Date().toISOString(),runtime:{pid:current.receipt.pid,sha256:current.receipt.binary_sha256},primary_port_env:options.primary_port_env,checks,source:'Actual read-only ports-preview routes; no server or allocation creation',host_bind_and_forwarding:'Retain response capability/forwarding status; this test does not establish external reachability'};save();fs.writeFileSync('artifacts/game-parity-20261029/banana-wave4-crewlink-planning-fixed.json',JSON.stringify(state.fixed_planning,null,2)+'\n');console.log(JSON.stringify(state.fixed_planning));
}else if(phase==='settings'){
 owned();const response=await raw(settings());if(response.status!==200)throw Error('Native YAML settings unavailable: '+response.status);const view=JSON.parse(response.body).attributes;
 const flag=view.fields.find(f=>f.key==='/forceRelayOnly');if(flag?.type!=='boolean'||flag.readonly)throw Error('Native relay switch unavailable');
 for(const key of ['/integratedRelay/enabled','/integratedRelay/listeningPort','/integratedRelay/minPort','/integratedRelay/maxPort','/integratedRelay/listeningIps','/integratedRelay/relayIps','/integratedRelay/externalIps'])if(!view.fields.find(f=>f.key===key)?.readonly)throw Error('Managed TURN control writable: '+key);
 const password=view.fields.find(f=>f.key==='/integratedRelay/defaultPassword');if(!password?.secret||password.value!=null)throw Error('Native relay credential not masked');
 state.settings={at:new Date().toISOString(),revision:view.revision,file:view.file,fields:view.fields.map(f=>({key:f.key,type:f.type,readonly:f.readonly,secret:f.secret})),forceRelayOnly:flag.value};save();console.log(JSON.stringify(state.settings));
}else if(phase==='edit-setting'){
 owned();if((await observePower(state.fixture)).current_state!=='offline')throw Error('Stopped server required');const view=(await api(settings())).attributes,flag=view.fields.find(f=>f.key==='/forceRelayOnly');if(flag?.type!=='boolean')throw Error('Expected native switch');
 const rawBefore=await raw(endpoint()+'/files/contents?file='+encodeURIComponent(config));if(rawBefore.status!==200)throw Error('Native file unavailable');
 await api(settings(),'PUT',{revision:view.revision,settings:{'/forceRelayOnly':!flag.value}});
 const rawAfter=await raw(endpoint()+'/files/contents?file='+encodeURIComponent(config));if(rawAfter.status!==200)throw Error('Edited native file unavailable');
 const updated=(await api(settings())).attributes;
 const comparable=fields=>fields.filter(f=>f.key!=='/forceRelayOnly').map(f=>({key:f.key,value:f.value,type:f.type,secret:f.secret,readonly:f.readonly}));
 if(updated.fields.find(f=>f.key==='/forceRelayOnly')?.value!==!flag.value||JSON.stringify(comparable(view.fields))!==JSON.stringify(comparable(updated.fields)))throw Error('Typed edit changed unrelated native settings');
 const credentialRows=text=>text.split(/\r?\n/).filter(line=>/^\s*defaultPassword\s*:/.test(line)).map(line=>line.trim().replace(/^defaultPassword\s*:\s*/,''));
 if(JSON.stringify(credentialRows(rawBefore.body))!==JSON.stringify(credentialRows(rawAfter.body)))throw Error('Typed edit changed native credential');
 fs.writeFileSync(path.join(dir,'native-checkpoint.yml'),rawAfter.body);state.checkpoint={at:new Date().toISOString(),sha256:digest(rawAfter.body),forceRelayOnly:!flag.value,unrelated_native_values_preserved:true,credential_preserved:true,editor_normalized_format:rawAfter.body!==rawBefore.body.replace(/forceRelayOnly: (true|false)/,'forceRelayOnly: '+String(!flag.value))};save();console.log(JSON.stringify(state.checkpoint));
}else if(phase==='preserved'){
 owned();const response=await raw(endpoint()+'/files/contents?file='+encodeURIComponent(config));state.preservation??=[];const check={at:new Date().toISOString(),status:response.status,exact:digest(response.body)===state.checkpoint?.sha256};state.preservation.push(check);save();if(response.status!==200||!check.exact)throw Error('Native YAML checkpoint changed');console.log(JSON.stringify(check));
}else if(phase==='guards'){
 owned();if((await observePower(state.fixture)).current_state!=='offline')throw Error('Stop before stale/managed native guard tests');const view=(await api(settings())).attributes;
 const before=await raw(endpoint()+'/files/contents?file='+encodeURIComponent(config));
 const stale=await raw(settings(),'PUT',{revision:'stale-native-fixture',settings:{'/forceRelayOnly':true}}),managed=await raw(settings(),'PUT',{revision:view.revision,settings:{'/integratedRelay/enabled':true}});
 const after=await raw(endpoint()+'/files/contents?file='+encodeURIComponent(config));state.guards={at:new Date().toISOString(),stale:stale.status,managed:managed.status,unchanged:before.status===200&&after.status===200&&before.body===after.body};save();if(stale.status!==409||managed.status!==422||!state.guards.unchanged)throw Error('Native settings safety guard failed');console.log(JSON.stringify(state.guards));
}else if(phase==='running-guard'){
 owned();if((await observePower(state.fixture)).current_state!=='running')throw Error('Running native server required');const view=(await api(settings())).attributes,response=await raw(settings(),'PUT',{revision:view.revision,settings:{'/forceRelayOnly':true}});state.running_guard={at:new Date().toISOString(),status:response.status};save();if(response.status!==409)throw Error('Running edit not refused');console.log(JSON.stringify(state.running_guard));
}else if(phase==='operator-file'){
 owned();if((await observePower(state.fixture)).current_state!=='offline')throw Error('Stop before operator checkpoint');const file='/crewlink/config/voltra-operator-preserve.txt',body='Voltra disposable fixture: unknown operator config file must survive reinstall.\n';const write=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/write?file='+encodeURIComponent(file),{method:'POST',headers:{'Content-Type':'text/plain'},body});if(!write.ok)throw Error('Operator checkpoint write failed');state.operator_file={file,sha256:digest(body)};save();console.log(JSON.stringify(state.operator_file));
}else if(phase==='operator-preserved'){
 owned();if(!state.operator_file)throw Error('Operator checkpoint required');const result=await raw(endpoint()+'/files/contents?file='+encodeURIComponent(state.operator_file.file));const check={at:new Date().toISOString(),status:result.status,exact:digest(result.body)===state.operator_file.sha256};state.operator_checks??=[];state.operator_checks.push(check);save();if(result.status!==200||!check.exact)throw Error('Unknown operator file changed');console.log(JSON.stringify(check));
}else if(phase==='checkpoint-files'||phase==='verify-checkpoint-files'){
 owned();if(phase==='checkpoint-files'&&(await observePower(state.fixture)).current_state!=='offline')throw Error('Stop before preservation baseline');
 const files=phase==='checkpoint-files'?[config,state.operator_file.file,'/.voltra/crewlink/release.json','/.voltra/node/voltra-release.json','/.voltra/yarn/voltra-release.json','/crewlink/dist/index.js','/crewlink/src/index.ts','/crewlink/VOLTRA-MODIFICATIONS.txt','/crewlink/LICENSE']:state.reinstall_checkpoint.map(row=>row.file),observed=[];
 for(const file of files){const result=await raw(endpoint()+'/files/contents?file='+encodeURIComponent(file));if(result.status!==200)throw Error('Preservation file unavailable: '+file);observed.push({file,sha256:digest(result.body),bytes:Buffer.byteLength(result.body)});}
 if(phase==='checkpoint-files')state.reinstall_checkpoint=observed;else{const exact=JSON.stringify(observed)===JSON.stringify(state.reinstall_checkpoint);state.reinstall_preservation={at:new Date().toISOString(),exact,files:observed.length};save();if(!exact)throw Error('Native YAML, operator file, runtime/source receipts or compiled content changed');}
 save();console.log(JSON.stringify(phase==='checkpoint-files'?observed:state.reinstall_preservation));
}else if(phase==='helpers'){
 owned();state.helper_proof=[];for(const match of state.profile.egg.scripts.installation.script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)){if(!match[1].endsWith('.py'))continue;const actual=await raw(endpoint()+'/files/contents?file='+encodeURIComponent('/'+match[1])),expected=digest(match[3]+'\n');if(actual.status!==200||digest(actual.body)!==expected)throw Error('Installed helper differs from served recipe: '+match[1]);state.helper_proof.push({file:match[1],sha256:expected});save();}if(!state.helper_proof.some(h=>h.file==='.voltra/crewlink-controls.py'))throw Error('CrewLink authority proof missing');console.log(JSON.stringify(state.helper_proof));
}else if(phase==='permissions'){
 owned();const view=(await api(settings())).attributes;state.reader=await createReaderFixture(state.fixture,async reader=>{state.reader=reader;save();});
 const read=await readerRequest(state.reader,settings()),readBody=await read.json(),write=await readerRequest(state.reader,settings(),'PUT',{revision:view.revision,settings:{'/forceRelayOnly':false}});const password=readBody.attributes?.fields?.find(f=>f.key==='/integratedRelay/defaultPassword');state.permissions={read:read.status,write:write.status,secret_masked:password?.secret===true&&password.value==null,boundary:state.reader.identity_boundary};save();await removeReaderFixture(state.reader,async reader=>{state.reader=reader;save();});if(read.status!==200||write.status!==403||!state.permissions.secret_masked)throw Error('Reader permissions or masking incorrect');console.log(JSON.stringify(state.permissions));
}else if(phase==='file-metadata'){
 owned();const uuid=state.fixture.server.uuid,mode=docker(['exec',uuid,'stat','-c','%a %u:%g','/home/container'+config]).trim(),cgroup=docker(['exec',uuid,'sh','-c','cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max']).trim();const values=cgroup.split(/\s+/);state.native_metadata??=[];const proof={at:new Date().toISOString(),mode_owner:mode,cgroup};state.native_metadata.push(proof);save();if(!mode.startsWith('600 ')||values[0]!==String(state.lease.memory_mib*1024**2)||values[1]!=='0'||values[2]!=='100000'||values[3]!=='100000')throw Error('Native file mode or cgroup limits differ from source/lease');console.log(JSON.stringify(proof));
}else if(phase==='evidence'){
 owned();const container=JSON.parse(docker(['inspect',state.fixture.server.uuid]))[0],logs=docker(['logs',container.Id]);fs.writeFileSync(path.join(dir,'native.log'),logs);const history=await api(endpoint()+'/console-history');fs.writeFileSync(path.join(dir,'panel-console.json'),JSON.stringify(history,null,2)+'\n');state.evidence={at:new Date().toISOString(),readiness:logs.includes('BetterCrewLink Server started'),native_listener_closed:logs.includes('Voltra native listeners closed'),native_ansi:logs.includes('\u001b['),panel_lines:history.data.length,panel_capture:history.capture,panel_ansi:history.data.some(e=>e.line.includes('\u001b[')),state:container.State,limits:{memory:container.HostConfig.Memory,memory_swap:container.HostConfig.MemorySwap,cpu_quota:container.HostConfig.CpuQuota,cpu_period:container.HostConfig.CpuPeriod,oom_disabled:container.HostConfig.OomKillDisable}};save();console.log(JSON.stringify(state.evidence));
}else if(phase==='crash'){
 owned();if((await observePower(state.fixture)).current_state!=='running')throw Error('Running owned native process required');const uuid=state.fixture.server.uuid,container=JSON.parse(docker(['inspect',uuid]))[0];if(container.Name!=='/'+uuid||container.HostConfig.NetworkMode!=='voltra-parity-20261029'||!container.State.Running)throw Error('Owned native container identity mismatch');
 const code="import pathlib,os,signal,json\nmatches=[]\nfor process in pathlib.Path('/proc').iterdir():\n if not process.name.isdigit():continue\n try:args=(process/'cmdline').read_bytes().split(bytes([0]))\n except OSError:continue\n if len(args)>1 and args[0]==b'/home/container/.voltra/node/bin/node' and args[1]==b'/home/container/crewlink/dist/index.js':matches.append(int(process.name))\nif len(matches)!=1:raise RuntimeError('Expected exactly one owned native CrewLink child')\nos.kill(matches[0],signal.SIGKILL)\nprint(json.dumps({'signal':'SIGKILL','child_pid':matches[0]}))";
 const action=await powerWithConsole('controlled-crash',async()=>{const at=new Date().toISOString(),proof=JSON.parse(docker(['exec',container.Id,'env','PYTHONHOME=/home/container/.voltra/python','LD_LIBRARY_PATH=/home/container/.voltra/python/lib','/home/container/.voltra/python/bin/python3','-B','-c',code]));state.crash={at,container:container.Id,generation_started_at:container.State.StartedAt,...proof};save();});
 state.crash.events=docker(['events','--since',state.crash.at,'--until',new Date().toISOString(),'--filter','container='+container.Id,'--format','{{json .}}']).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));state.crash.exit_codes=state.crash.events.filter(event=>event.Action==='die').map(event=>event.Actor?.Attributes?.exitCode);state.crash.oom_observed=state.crash.events.some(event=>event.Action==='oom');state.crash.power=await observePower(state.fixture);state.crash.container_state=JSON.parse(docker(['inspect',container.Id]))[0].State;save();console.log(JSON.stringify({crash:{at:state.crash.at,signal:state.crash.signal,exit_codes:state.crash.exit_codes,oom_observed:state.crash.oom_observed,power:state.crash.power.current_state,container_state:state.crash.container_state},action}));
}else throw Error('Use plan|claim|install coordinator-handoff|installed|reinstall coordinator-handoff|start|stop|restart|observe running|health|settings|edit-setting|preserved|permissions|evidence.');
