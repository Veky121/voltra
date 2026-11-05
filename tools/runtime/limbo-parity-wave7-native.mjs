import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {api,docker,verifyRuntime,profileFromRuntime,activeLease,acquireInstaller,releaseInstaller,releaseNative,createNativeFixture,waitNativeInstaller,waitInstallOutcome,installerGate,releaseGate,observePower,createReaderFixture,readerRequest,removeReaderFixture} from './campaign-native-20261029.mjs';
const dir='.local/game-parity-20261029/limbo-root-native',recipe='minecraft/java/limbo/egg-limbo.json',file=dir+'/state.json';
const initial=JSON.parse(fs.readFileSync(dir+'/lease.json'));
let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{lease:initial.lease};
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n'),hash=b=>crypto.createHash('sha256').update(b).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const phase=process.argv[2],jar='.local/limbo-games/limbo.jar',jarSHA='a2de91fcaa2255aed8a111b8786f370213423c7798eee778c00d016d83aa65d2';
activeLease(state.lease.lease_id,state.lease.owner);
if(state.lease.game!==recipe||state.lease.memory_mib!==1024||state.lease.disk_mib!==2048||state.lease.ports.length!==1)throw Error('Exact root-assigned Limbo lease required');
const receipt=await verifyRuntime(),profile=profileFromRuntime(recipe,receipt);state.latest_runtime=receipt;save();
const endpoint=()=>'/api/client/servers/'+state.server.uuid;
if(state.server&&phase!=='cleanup-finish'){const s=(await api('/api/application/servers/'+state.server.id)).attributes;if(s.uuid!==state.server.uuid||s.egg!==state.egg.id||s.node!==1)throw Error('Owned Limbo fixture drift');}
async function contents(name){const r=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/contents?file='+encodeURIComponent('/'+name));if(!r.ok)throw Error('Owned native file unavailable '+name+':'+r.status);return Buffer.from(await r.arrayBuffer());}
async function waitPower(expected){const start=Date.now();while(Date.now()-start<45000){const r=await observePower(state);if(r.current_state===expected)return r;await sleep(500);}throw Error('Expected native power state not observed '+expected);}
function ownedContainers(){const out=[];for(const row of docker(['ps','-a','--filter','name='+state.server.uuid,'--format','{{.ID}}|{{.Names}}']).trim().split(/\r?\n/).filter(Boolean)){const [id,name]=row.split('|');try{out.push({id,name,state:JSON.parse(docker(['inspect','--format','{{json .State}}',id]))});}catch{if(docker(['ps','-aq','--filter','id='+id]).trim())throw Error('Owned state inspection failed');}}return out;}
function attach(container,label){const out={container};for(const [args,name]of[[['logs','--follow',container],label+'.log'],[['wait',container],label+'-wait.txt']]){const fd=fs.openSync(dir+'/'+name,'a'),child=spawn('docker',['--context','desktop-linux',...args],{windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);child.on('error',e=>{state.observer_error=e.message;save();});out[name]=child.pid;}return out;}
async function wire(){
 const a=(await api(endpoint()+'/websocket')).data,u=new URL(a.socket),events=[];
 if(!['127.0.0.1','localhost'].includes(u.hostname)||!['18099','18100'].includes(u.port)||!u.pathname.includes(state.server.uuid))throw Error('Owned loopback WS required');
 const ws=new WebSocket(a.socket),timer=setTimeout(()=>ws.close(),70000);
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>{ws.close();reject(Error('WS auth timeout'));},7000);ws.onopen=()=>ws.send(JSON.stringify({event:'auth',args:[a.token]}));ws.onerror=()=>{clearTimeout(t);reject(Error('WS failed'));};ws.onmessage=m=>{let e;try{e=JSON.parse(String(m.data));}catch{return;}if(e.event==='auth success'){clearTimeout(t);resolve();}if(['status','console output','daemon message','daemon error'].includes(e.event)&&events.length<2000)events.push({at:new Date().toISOString(),event:e.event,args:e.args});};});
 return {events,close(){ws.close();clearTimeout(timer);}};
}
async function capture(label){
 const bytes=await contents('server.properties');fs.writeFileSync(dir+'/'+label+'-server.properties',bytes);fs.writeFileSync(dir+'/'+label+'-native.log',docker(['logs',state.server.uuid]));
 state.captures??={};state.captures[label]={at:new Date().toISOString(),bytes:bytes.length,sha256:hash(bytes),power:await observePower(state)};save();return state.captures[label];
}
async function completeCleanup(){
 const q=state.cleanup_request,uuid=state.server.uuid;if(!q||q.uuid!==uuid||q.server!==state.server.id||q.egg!==state.egg.id||q.nest!==state.nest.id||!/^[a-f0-9-]{36}$/.test(uuid))throw Error('Durable exact owned cleanup receipt required');
 const checks={containers:ownedContainers().length===0,allocations:!(await api('/api/application/nodes/1/allocations')).data.some(r=>q.allocations.includes(r.attributes.id)),reader_removed:state.reader?.user_removed===true&&state.reader?.subuser_removed===true};
 for(const [key,url]of[['server','/api/application/servers/'+q.server],['egg','/api/admin/eggs/'+q.egg],['nest','/api/admin/nests/'+q.nest]]){const r=await fetch('http://127.0.0.1:18099'+url);await r.text();checks[key]=r.status===404;}
 const w=JSON.parse(fs.readFileSync('.local/game-parity-20261029/runtime/wings-private.json'));if(w.system.data!=='/var/lib/voltra-parity-20261029/volumes')throw Error('Exact campaign root required');
 docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--mount','type=bind,source='+w.system.data+',target=/volumes,readonly','python:3.12-slim','python','-B','-c',`from pathlib import Path; p=Path('/volumes/${uuid}'); assert not p.exists() and not p.is_symlink()`]);checks.volume=true;
 state.cleanup={at:new Date().toISOString(),checks,outcome:'blocked',reason:'Assigned bounded native checks complete; real compatible-player/whitelist/proxy-forwarding and external reachability are not claimed'};save();if(!Object.values(checks).every(Boolean))throw Error('Owned cleanup incomplete');releaseNative(state.lease.lease_id,state.lease.owner,'blocked',true);return state.cleanup;
}
if(phase==='install'){
 if(!process.argv.includes('--coordinator-handoff')||state.server)throw Error('Explicit installer GO and no existing fixture required');
 const bytes=fs.readFileSync(jar);if(bytes.length!==8816732||hash(bytes)!==jarSHA)throw Error('Exact reviewed public Limbo cache drift');
 if(profile.egg.features.includes('eula')||profile.egg.variables.some(v=>/EULA|ACCEPT|AGREEMENT/i.test(v.env_variable))||/eula\s*=\s*true/i.test(profile.egg.scripts.installation.script))throw Error('Unaccepted agreement prerequisite; stop for root');
 if(Object.values(profile.egg.docker_images)[0]!=='ghcr.io/pterodactyl/yolks:java_21')throw Error('Reviewed Java21 default changed');
 docker(['image','inspect',profile.egg.scripts.installation.container,'--format','{{.Id}}']);docker(['image','inspect',Object.values(profile.egg.docker_images)[0],'--format','{{.Id}}']);
 state.slot=acquireInstaller(state.lease.lease_id,state.lease.owner);save();
 await createNativeFixture({lease:state.lease,slot:state.slot,profile,name:'Campaign Limbo native wave7',environment:{SERVER_JARFILE:'Limbo.jar'},onStep:s=>{state={...state,...s};save();}});
 const gated=await waitNativeInstaller(state);state.installer_proof=gated.proof;save();
 docker(['exec',gated.container.Id,'mkdir','-p','/mnt/server/.voltra/limbo']);docker(['cp',path.resolve(jar),gated.container.Id+':/mnt/server/.voltra/limbo/download.jar']);
 if(!docker(['exec',gated.container.Id,'sha256sum','/mnt/server/.voltra/limbo/download.jar']).startsWith(jarSHA))throw Error('Copied Limbo publisher cache differs');
 state.cache={file:jar,sha256:jarSHA,bytes:bytes.length,source:'Retained official publisher build76; no fresh game acquisition'};state.installer_observers=attach(gated.container.Id,'installer');save();releaseGate(gated.container,state.lease,state.slot.token);
 state.install_outcome=await waitInstallOutcome(state);save();if(!state.install_outcome.success)throw Error('Limbo installer failed; preserve slot/owned receipt for review');releaseInstaller(state.slot);state.slot_released=true;save();console.log(JSON.stringify({uuid:state.server.uuid,install:state.install_outcome,slot_released:true}));
}else if(phase==='start'){
 if(!state.install_outcome?.success)throw Error('Actual canonical installation required');
 if((await observePower(state)).current_state!=='offline')throw Error('A fresh native start requires actual offline state');
 const helpers=[...profile.egg.scripts.installation.script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].filter(m=>m[1].endsWith('.py'));if(helpers.length!==2)throw Error('Reviewed two-helper Limbo body changed');state.helpers=[];
 for(const m of helpers){const actual=hash(await contents(m[1])),source=m[3]+'\n';if(![hash(source),hash(source.replaceAll('\r\n','\n'))].includes(actual))throw Error('Installed helper drift '+m[1]);state.helpers.push({file:m[1],sha256:actual});}save();
 await api(endpoint()+'/power','POST',{signal:'start'});await waitPower('running');
 const began=Date.now();let ready=false;while(Date.now()-began<45000){const s=JSON.parse(docker(['inspect','--format','{{json .State}}',state.server.uuid]));if(s.Running&&docker(['logs','--since',s.StartedAt,state.server.uuid]).includes('Limbo server listening on ')){ready=true;break;}await sleep(500);}if(!ready)throw Error('Real Limbo readiness marker absent');
 const installedSHA=docker(['exec',state.server.uuid,'sha256sum','/home/container/Limbo.jar']).split(/\s+/)[0],javaVersion=docker(['exec',state.server.uuid,'java','--version']);
 if(installedSHA!==jarSHA||!/^openjdk 21[.\s]/m.test(javaVersion))throw Error('Native JAR or reviewed Java21 runtime drift');
 const release=JSON.parse(await contents('.voltra/limbo/release.json'));if(release.sha256!==jarSHA||release.class_major!==65||release.main_class!=='com.loohp.limbo.Limbo')throw Error('Installed release receipt differs');
 state.native_identity={jar_sha256:installedSHA,java_version:javaVersion,release};save();
 const label=process.argv[3]||'baseline',c=await capture(label);
 const list=(await api(endpoint()+'/files/list?directory=%2F')).data.map(x=>x.attributes.name);if(list.some(n=>/^eula\.txt$/i.test(n))){state.unexpected_agreement={at:new Date().toISOString(),filename:'eula.txt',action:'Stopped without reading/writing acceptance flags'};save();await api(endpoint()+'/power','POST',{signal:'stop'});await waitPower('offline');throw Error('Unexpected publisher agreement file appeared; preserved evidence and stopped for root');}
 state.starts??=[];state.starts.push({label,at:new Date().toISOString(),ready:true,eula_file_present:false});save();console.log(JSON.stringify({ready:true,settings_sha256:c.sha256,agreement_file_present:false}));
}else if(phase==='stop'){
 await api(endpoint()+'/power','POST',{signal:'stop'});state.stop_power=await waitPower('offline');state.stop_native=JSON.parse(docker(['inspect','--format','{{json .State}}',state.server.uuid]));fs.writeFileSync(dir+'/last-stop-native.log',docker(['logs',state.server.uuid]));state.stops??=[];state.stops.push({at:new Date().toISOString(),native:state.stop_native});save();console.log(JSON.stringify(state.stop_native));
}else if(phase==='query'){
 if((await observePower(state)).current_state!=='running')throw Error('Actual ready native game required');
 const label=process.argv[3]||'status';if(!/^[a-z0-9_-]+$/.test(label))throw Error('Explicit safe query label required');
 const out=execFileSync(process.execPath,['tools/game-query/minecraft-status.mjs','127.0.0.1',String(state.lease.ports[0]),dir+'/'+label+'-status.json'],{encoding:'utf8',windowsHide:true,timeout:10000});
 const result=JSON.parse(out);if(!result.native_ping_nonce_matched)throw Error('Native ping nonce failed');state.queries??={};state.queries[label]={at:new Date().toISOString(),...result};save();console.log(JSON.stringify(result));
}else if(phase==='settings'){
 if((await observePower(state)).current_state!=='offline')throw Error('Native config writes require offline');
 const url=endpoint()+'/game-settings?file=%2Fserver.properties',view=(await api(url)).attributes,before=await contents('server.properties');
 if(view.fields.length!==27||view.fields.filter(f=>f.type==='boolean').length!==10)throw Error('Native source field exposure differs from generated schema');
 for(const key of ['server-ip','server-port'])if(view.fields.find(f=>f.key===key)?.readonly!==true)throw Error('Allocated listener not readonly');
 const secret=view.fields.find(f=>f.key==='forwarding-secrets');if(!secret?.secret||secret.value!==null)throw Error('Forwarding secret exposed');
 const generated=crypto.randomBytes(24).toString('hex');fs.writeFileSync(dir+'/private-secrets.json',JSON.stringify({forwarding:generated})+'\n');
 const motd=JSON.stringify({text:'Voltra Limbo native parity',color:'aqua'}),changes={'max-players':'4',motd,'allow-flight':true,'forwarding-secrets':generated};
 state.settings={at:new Date().toISOString(),runtime_pid:receipt.pid,fields:view.fields,before_sha256:hash(before),changed_keys:Object.keys(changes),expected:{maxplayers:4,motd,allow_flight:true},negative_cases:[]};save();
 await api(url,'PUT',{revision:view.revision,settings:changes});const loaded=(await api(url)).attributes,after=await contents('server.properties');
 for(const [key,value]of Object.entries(changes)){const f=loaded.fields.find(f=>f.key===key);if(key==='forwarding-secrets'){if(f.value!==null||!f.configured)throw Error('Configured forwarding secret not masked');}else if(String(f.value)!==String(value))throw Error('Typed native roundtrip mismatch '+key);}
 const comments=b=>b.toString().split(/\r?\n/).filter(line=>line.startsWith('#'));
 if(JSON.stringify(comments(before))!==JSON.stringify(comments(after)))throw Error('Native property comments changed');
 const stale=await fetch('http://127.0.0.1:18099'+url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:view.revision,settings:{'max-players':'5'}})});await stale.text();if(stale.status!==409)throw Error('Stale native revision accepted');
 state.settings.changed_sha256=hash(after);state.settings.stale_revision_status=stale.status;state.settings.secret_hidden=true;state.settings.comments_preserved=true;save();
 for(const value of ['NaN','4\nserver-port=1']){const r=await fetch('http://127.0.0.1:18099'+url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:loaded.revision,settings:{'max-players':value}})});await r.text();const unchanged=hash(await contents('server.properties'))===hash(after);state.settings.negative_cases.push({name:value==='NaN'?'nonfinite-number':'newline-injection',status:r.status,unchanged});save();if(r.ok||!unchanged)throw Error('Unsafe numeric property input accepted');}
 console.log(JSON.stringify({fields:27,booleans:10,secret_hidden:true,comments_preserved:true,stale_revision_status:stale.status,negative_cases:state.settings.negative_cases}));
}else if(phase==='player-limit'){
 if((await observePower(state)).current_state!=='offline')throw Error('Offline required for native limit scenario');
 const value=process.argv[3];if(!['-1','4'].includes(value))throw Error('Only publisher-supported unlimited/controlled native fixture values');
 const url=endpoint()+'/game-settings?file=%2Fserver.properties',view=(await api(url)).attributes;
 await api(url,'PUT',{revision:view.revision,settings:{'max-players':value}});const loaded=(await api(url)).attributes;
 if(String(loaded.fields.find(f=>f.key==='max-players').value)!==value)throw Error('Native player limit editor roundtrip failed');
 state.limit_edits??=[];state.limit_edits.push({at:new Date().toISOString(),value,status:200,native_game:loaded.game});save();console.log(JSON.stringify(state.limit_edits.at(-1)));
}else if(phase==='version-command'){
 if((await observePower(state)).current_state!=='running')throw Error('Actual running native required');
 const before=docker(['logs',state.server.uuid]);await api(endpoint()+'/command','POST',{command:'version'});
 const began=Date.now();let added='';while(Date.now()-began<5000){added=docker(['logs',state.server.uuid]).slice(before.length);if(/2026\.0\.3/.test(added))break;await sleep(200);}
 if(!/2026\.0\.3/.test(added))throw Error('Native version command not acknowledged');
 fs.writeFileSync(dir+'/version-command.log',added);state.console_command={at:new Date().toISOString(),command:'version',native_version_acknowledged:true,evidence:dir+'/version-command.log'};save();console.log(JSON.stringify(state.console_command));
}else if(phase==='restart'){
 if((await observePower(state)).current_state!=='running')throw Error('Actual running native required');
 const before=JSON.parse(docker(['inspect','--format','{{json .State}}',state.server.uuid]));await api(endpoint()+'/power','POST',{signal:'restart'});
 let after;const began=Date.now();while(Date.now()-began<60000){try{const s=JSON.parse(docker(['inspect','--format','{{json .State}}',state.server.uuid]));if(s.Running&&s.StartedAt!==before.StartedAt&&docker(['logs','--since',s.StartedAt,state.server.uuid]).includes('Limbo server listening on ')){after=s;break;}}catch{}await sleep(500);}
 if(!after)throw Error('Explicit restart new native readiness unverified');state.restart={at:new Date().toISOString(),before:before.StartedAt,after:after.StartedAt,new_native_readiness:true};save();await capture('after-explicit-restart');console.log(JSON.stringify(state.restart));
}else if(phase==='permissions'){
 if((await observePower(state)).current_state!=='offline')throw Error('Offline native permission fixture required');
 if(state.reader&&!state.reader.user_removed)throw Error('Existing owned reader requires cleanup');
 state.reader=await createReaderFixture(state,r=>{state.reader=r;save();});
 const url=endpoint()+'/game-settings?file=%2Fserver.properties',response=await readerRequest(state.reader,url),view=(await response.json()).attributes,before=hash(await contents('server.properties'));
 if(response.status!==200||view.fields.length<27||view.fields.find(f=>f.key==='forwarding-secrets')?.value!==null)throw Error('Reader exposure/privacy mismatch');
 state.permissions={at:new Date().toISOString(),identity_boundary:state.reader.identity_boundary,typed_read_status:response.status,field_count:view.fields.length,configured_secret_hidden:true,outcomes:[]};save();
 for(const [name,target,method,body]of[['settings-write',url,'PUT',{revision:view.revision,settings:{'max-players':'5'}}],['startup-write',endpoint()+'/startup/variable','PUT',{key:'SERVER_JARFILE',value:'Forbidden.jar'}],['power-start',endpoint()+'/power','POST',{signal:'start'}],['console-command',endpoint()+'/command','POST',{command:'version'}],['raw-file-write',endpoint()+'/files/write?file=%2Fserver.properties','POST',{}]]){const r=await readerRequest(state.reader,target,method,body);await r.text();state.permissions.outcomes.push({name,status:r.status});save();if(r.status!==403)throw Error('Forbidden reader action not403 '+name);}
 state.permissions.native_bytes_unchanged=hash(await contents('server.properties'))===before;state.permissions.remains_offline=(await observePower(state)).current_state==='offline';save();if(!state.permissions.native_bytes_unchanged||!state.permissions.remains_offline)throw Error('Forbidden action changed owned game');
 await removeReaderFixture(state.reader,r=>{state.reader=r;save();});console.log(JSON.stringify(state.permissions));
}else if(phase==='lifecycle-ws'){
 if((await observePower(state)).current_state!=='offline')throw Error('Actual offline game required');const socket=await wire();
 try{await sleep(100);const start=socket.events.length;await api(endpoint()+'/power','POST',{signal:'start'});await waitPower('running');
  const began=Date.now();let ready=false;while(Date.now()-began<45000){const s=JSON.parse(docker(['inspect','--format','{{json .State}}',state.server.uuid]));if(s.Running&&docker(['logs','--since',s.StartedAt,state.server.uuid]).includes('Limbo server listening on ')){ready=true;break;}await sleep(250);}if(!ready)throw Error('Actual native readiness absent');
  await capture('ws-lifecycle');await api(endpoint()+'/power','POST',{signal:'stop'});await waitPower('offline');await sleep(200);
  const events=socket.events.slice(start),native=JSON.parse(docker(['inspect','--format','{{json .State}}',state.server.uuid]));fs.writeFileSync(dir+'/lifecycle-ws.json',JSON.stringify(events,null,2)+'\n');
  state.lifecycle_ws={at:new Date().toISOString(),runtime_pid:receipt.pid,sequence:events.filter(e=>e.event==='status').map(e=>e.args[0]),native_ready_log:events.some(e=>e.event==='console output'&&e.args.some(v=>String(v).includes('Limbo server listening on '))),shutdown_log:events.some(e=>e.event==='console output'&&e.args.some(v=>String(v).includes('Server closed'))),native,evidence:dir+'/lifecycle-ws.json'};save();console.log(JSON.stringify(state.lifecycle_ws));
 }finally{socket.close();}
}else if(phase==='unexpected-kill'){
 if((await observePower(state)).current_state!=='running')throw Error('Actual ready native JVM required');
 const pids=docker(['exec',state.server.uuid,'/bin/ls','/proc']).split(/\s+/).filter(n=>/^\d+$/.test(n)),matches=[];
 for(const pid of pids){let args;try{args=docker(['exec',state.server.uuid,'/bin/cat','/proc/'+pid+'/cmdline'],true).toString().split('\0');}catch{continue;}const index=args.indexOf('-jar');if(index>=0&&path.posix.basename(args[index+1]||'')==='Limbo.jar'&&args.includes('--nogui')){const exe=docker(['exec',state.server.uuid,'readlink','-f','/proc/'+pid+'/exe']).trim(),cwd=docker(['exec',state.server.uuid,'readlink','-f','/proc/'+pid+'/cwd']).trim();if(exe.endsWith('/bin/java')&&cwd==='/home/container')matches.push({pid:Number(pid),exe,cwd});}}
 if(matches.length!==1)throw Error('Exact single native JVM not identified');const socket=await wire();
 try{state.unexpected_attempts??=[];if(state.unexpected)state.unexpected_attempts.push({...state.unexpected,result:'Earlier same-namespace signal to PID1 left JVM running; not a verified crash'});
  state.unexpected={at:new Date().toISOString(),scope:'Only exact owned native JVM namespace PID; no host PID',target:matches[0],signal:'SIGKILL',method:matches[0].pid===1?'Docker SIGKILL to verified native PID1 (JVM itself is init)':'Namespace child signal',observations:[]};save();
  if(matches[0].pid===1)docker(['kill','--signal','KILL',state.server.uuid]);
  else docker(['exec',state.server.uuid,'/bin/sh','-c','kill -KILL "$1"','owned-native-kill',String(matches[0].pid)]);
  const began=Date.now();while(Date.now()-began<12000){state.unexpected.observations.push({at:new Date().toISOString(),containers:ownedContainers(),power:await observePower(state)});save();await sleep(1000);}
  fs.writeFileSync(dir+'/unexpected-ws.json',JSON.stringify(socket.events,null,2)+'\n');fs.writeFileSync(dir+'/unexpected-native.log',docker(['logs',state.server.uuid]));
  state.unexpected.websocket={file:dir+'/unexpected-ws.json',sequence:socket.events.filter(e=>e.event==='status').map(e=>e.args[0]),crash_lines:socket.events.filter(e=>e.event==='console output'&&e.args.some(v=>/crash|exit code|error/i.test(String(v))))};
  state.unexpected.native_death_observed=state.unexpected.observations.some(o=>o.containers.some(c=>!c.state.Running&&c.state.ExitCode!==0&&!c.state.OOMKilled));save();if(!state.unexpected.native_death_observed)throw Error('Native fatal exit not observed; do not count as crash acceptance');
  console.log(JSON.stringify({target:state.unexpected.target,final:await observePower(state),native:ownedContainers().map(c=>c.state),websocket:state.unexpected.websocket}));
 }finally{socket.close();}
}else if(phase==='malformed-schematic'){
 if((await observePower(state)).current_state!=='offline')throw Error('Stopped disposable native fixture required');
 const view=(await api(endpoint()+'/game-settings?file=%2Fserver.properties')).attributes;
 if(view.fields.find(f=>f.key==='level-name')?.value!=='world;spawn.schem')throw Error('Only the reviewed default schematic may be tested');
 const original=await contents('spawn.schem');fs.writeFileSync(dir+'/original-spawn.schem',original);
 const write=async body=>{const r=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/write?file=%2Fspawn.schem',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body});await r.text();if(!r.ok)throw Error('Owned schematic fixture write failed');};
 const socket=await wire();state.malformed_schematic={at:new Date().toISOString(),original_sha256:hash(original),scope:'Temporarily replace only owned default schematic with one invalid NBT tag byte; original bytes restored in finally',observations:[]};save();
 try{
  await sleep(100);const index=socket.events.length;await write(Buffer.from([255]));await api(endpoint()+'/power','POST',{signal:'start'});
  const began=Date.now();let failed=false,starting=false;
  while(Date.now()-began<25000){const power=await observePower(state),containers=ownedContainers();const events=socket.events.slice(index);starting||=events.some(e=>e.event==='status'&&e.args[0]==='starting');state.malformed_schematic.observations.push({at:new Date().toISOString(),power,containers});save();if(starting&&power.current_state==='offline'&&containers.some(c=>!c.state.Running&&c.state.ExitCode!==0)){failed=true;break;}await sleep(250);}
  await sleep(200);const events=socket.events.slice(index),logs=docker(['logs',state.server.uuid]);fs.writeFileSync(dir+'/malformed-schematic-native.log',logs);fs.writeFileSync(dir+'/malformed-schematic-ws.json',JSON.stringify(events,null,2)+'\n');
  state.malformed_schematic.failed_before_online=failed&&!events.some(e=>e.event==='status'&&e.args[0]==='running');state.malformed_schematic.sequence=events.filter(e=>e.event==='status').map(e=>e.args[0]);state.malformed_schematic.native_ready_marker=logs.includes('Limbo server listening on ');state.malformed_schematic.native_states=ownedContainers().map(c=>c.state);save();
  if(!state.malformed_schematic.failed_before_online||state.malformed_schematic.native_ready_marker)throw Error('Bad schematic did not fail without false online');
 }finally{if((await observePower(state)).current_state!=='offline'){await api(endpoint()+'/power','POST',{signal:'stop'});await waitPower('offline');}await write(original);state.malformed_schematic.original_restored=hash(await contents('spawn.schem'))===hash(original);save();socket.close();}
 if(!state.malformed_schematic.original_restored)throw Error('Original schematic restore mismatch');console.log(JSON.stringify({failed_before_online:state.malformed_schematic.failed_before_online,sequence:state.malformed_schematic.sequence,native:state.malformed_schematic.native_states,restored_exact:true}));
}else if(phase==='operator-seed'){
 if((await observePower(state)).current_state!=='offline')throw Error('Offline operator fixture required');
 const before=await contents('server.properties'),addition='\n# Voltra operator comment retained\nvoltra-operator-note=preserve unknown value\n';if(before.includes(Buffer.from('voltra-operator-note=')))throw Error('Operator fixture already exists');
 for(const [name,body]of[['server.properties',Buffer.concat([before,Buffer.from(addition)])],['plugins/voltra-operator-retention.txt',Buffer.from('Unknown plugin-side operator file\r\nkeep punctuation ! # ;\r\n')]]){const r=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/write?file='+encodeURIComponent('/'+name),{method:'POST',headers:{'Content-Type':'text/plain'},body});await r.text();if(!r.ok)throw Error('Owned operator seed failed');}
 state.operator_seed={at:new Date().toISOString(),before_sha256:hash(before),after_sha256:hash(Buffer.concat([before,Buffer.from(addition)])),paths:['server.properties','plugins/voltra-operator-retention.txt']};save();console.log(JSON.stringify(state.operator_seed));
}else if(phase==='snapshot'){
 const label=process.argv[3];if(!/^[a-z0-9_-]+$/.test(label||'')||(await observePower(state)).current_state!=='offline'||ownedContainers().some(c=>c.state.Running))throw Error('Safe snapshot label and stopped owned resources required');
 const w=JSON.parse(fs.readFileSync('.local/game-parity-20261029/runtime/wings-private.json'));if(w.system.data!=='/var/lib/voltra-parity-20261029/volumes'||!/^[a-f0-9-]{36}$/.test(state.server.uuid))throw Error('Exact campaign mount required');
 const code="from pathlib import Path\nimport hashlib,json,stat,os\nr=Path('/volume');out={};excluded=[]\nfor f in sorted(r.rglob('*')):\n name=f.relative_to(r).as_posix()\n if name.split('/')[0].startswith('.campaign-release-'):excluded.append(name);continue\n if f.is_symlink():out[name]={'link':os.readlink(f)};continue\n if not f.is_file():continue\n s=f.stat()\n with f.open('rb') as stream:h=hashlib.file_digest(stream,'sha256').hexdigest()\n out[name]={'bytes':s.st_size,'sha256':h,'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid}\nprint(json.dumps({'files':out,'excluded_owned_test_gates':excluded}))";
 const snapshot=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--mount','type=bind,source='+w.system.data+'/'+state.server.uuid+',target=/volume,readonly','python:3.12-slim','python','-B','-c',code]));
 state.snapshots??={};state.snapshots[label]={at:new Date().toISOString(),...snapshot};save();console.log(JSON.stringify({label,files:Object.keys(snapshot.files).length,excluded_owned_gates:snapshot.excluded_owned_test_gates.length}));
}else if(phase==='reinstall'){
 if(!process.argv.includes('--coordinator-handoff')||(await observePower(state)).current_state!=='offline'||!state.slot_released||hash(profile.egg.scripts.installation.script)!==state.installer_body_sha256)throw Error('Serialized exact original cached reinstall prerequisites required');
 state.slot=acquireInstaller(state.lease.lease_id,state.lease.owner);state.slot_released=false;save();
 await api('/api/admin/eggs/'+state.egg.id+'/scripts','PATCH',{script_install:installerGate(profile.egg.scripts.installation.script,state.slot.token)});state.reinstall_request={at:new Date().toISOString(),slot:state.slot,installer_body_sha256:state.installer_body_sha256};save();await api('/api/application/servers/'+state.server.id+'/reinstall','POST',{});
 const gated=await waitNativeInstaller(state);state.reinstall_proof=gated.proof;state.reinstall_observers=attach(gated.container.Id,'reinstall');save();releaseGate(gated.container,state.lease,state.slot.token);
 state.reinstall_outcome=await waitInstallOutcome(state);save();if(!state.reinstall_outcome.success)throw Error('Reinstall failed; preserve slot and owned resources');releaseInstaller(state.slot);state.slot_released=true;save();console.log(JSON.stringify({reinstalled:true,outcome:state.reinstall_outcome,slot_released:true}));
}else if(phase==='cleanup'){
 if(!state.slot_released||(await observePower(state)).current_state!=='offline'||ownedContainers().some(c=>c.state.Running)||!state.reader?.user_removed)throw Error('Stopped game, released installer and removed reader required');
 const nest=(await api('/api/admin/nests/'+state.nest.id)).attributes,egg=(await api('/api/admin/eggs/'+state.egg.id)).attributes;if(nest.name!=='Campaign Limbo native wave7'||egg.nest_id!==nest.id)throw Error('Owned temporary definitions drift');
 state.cleanup_request={at:new Date().toISOString(),uuid:state.server.uuid,server:state.server.id,egg:state.egg.id,nest:state.nest.id,allocations:state.allocations.map(a=>a.id)};save();await api('/api/application/servers/'+state.server.id,'DELETE');
 for(const a of state.allocations){const current=(await api('/api/application/nodes/1/allocations')).data.map(r=>r.attributes).find(r=>r.id===a.id);if(!current||current.server_id!=null||current.port!==a.port||current.ip!=='127.0.0.1'||!state.lease.ports.includes(current.port))throw Error('Owned allocation drift');await api('/api/application/nodes/1/allocations/'+a.id,'DELETE');}
 await api('/api/admin/eggs/'+state.egg.id,'DELETE');await api('/api/admin/nests/'+state.nest.id,'DELETE');console.log(JSON.stringify(await completeCleanup()));
}else if(phase==='cleanup-finish'){
 console.log(JSON.stringify(await completeCleanup()));
}else throw Error('Use install --coordinator-handoff|start [label]|stop|query [label]');
