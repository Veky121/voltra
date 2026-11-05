import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {api,docker,verifyRuntime,profileFromRuntime,activeLease,acquireInstaller,releaseInstaller,releaseNative,createNativeFixture,waitNativeInstaller,waitInstallOutcome,installerGate,releaseGate,observePower,createReaderFixture,readerRequest,removeReaderFixture} from './campaign-native-20261029.mjs';
const dir='artifacts/game-parity-20261029/wave190-impostor-live';
const recipe='among_us/impostor_server/egg-among-us--impostor-server.json';
const file=dir+'/state.json',leaseReceipt=JSON.parse(fs.readFileSync(dir+'/lease.json'));
let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{lease:leaseReceipt.lease};
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const phase=process.argv[2];if(!['install','start','stop','observe','protocol','restart','settings','cleanup','cleanup-finish'].includes(phase))throw Error('Phase excluded from practical scope');activeLease(state.lease.lease_id,state.lease.owner);
if(state.lease.game!==recipe||state.lease.memory_mib!==512||state.lease.disk_mib!==4096||state.lease.ports.length!==1)throw Error('Exact owned Impostor lease required');
const receipt=await verifyRuntime(),profile=profileFromRuntime(recipe,receipt);state.latest_runtime=receipt;save();
const endpoint=()=>'/api/client/servers/'+state.server.uuid;
if(state.server&&phase!=='cleanup-finish'){const a=(await api('/api/application/servers/'+state.server.id)).attributes;if(a.uuid!==state.server.uuid||a.egg!==state.egg.id||a.node!==1)throw Error('Owned fixture drift');}
const assets=[
 ['impostor.tar.gz',661654,'54ff18b773fe2cb6458a67d5ae5291b35d5f9f60054ca30e6fc49f07cc784ad8'],
 ['aspnet.tar.gz',42064256,'bde0bb08f1f10d6dd60d0c3d8a220e33d7ce6d1c74c7098cf7f6a4e1a1ef5137'],
 ['impostor-license.txt',35149,'3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986'],
];
function attach(container,label){
 const result={container};
 for(const [args,name]of[[['logs','--follow',container],label+'.log'],[['wait',container],label+'-wait.txt']]){
  const fd=fs.openSync(dir+'/'+name,'a');const child=spawn('docker',['--context','desktop-linux',...args],{windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);
  child.on('error',error=>{state.observer_error=error.message;save();});result[name]=child.pid;
 }return result;
}
async function contents(name){const r=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/contents?file='+encodeURIComponent('/'+name));if(!r.ok)throw Error('Owned native file unavailable '+name+':'+r.status);return Buffer.from(await r.arrayBuffer());}
async function waitPower(expected){const start=Date.now();while(Date.now()-start<45000){const r=await observePower(state);if(r.current_state===expected)return r;await sleep(500);}throw Error('Power state not observed '+expected);}
function ownedContainers(){const out=[];for(const row of docker(['ps','-a','--filter','name='+state.server.uuid,'--format','{{.ID}}|{{.Names}}']).trim().split(/\r?\n/).filter(Boolean)){const [id,name]=row.split('|');try{out.push({id,name,state:JSON.parse(docker(['inspect','--format','{{json .State}}',id]))});}catch{if(docker(['ps','-aq','--filter','id='+id]).trim())throw Error('Owned minimal container inspection failed');}}return out;}
async function completeCleanup(){
 const q=state.cleanup_request,uuid=state.server.uuid;if(!q||q.uuid!==uuid||q.server!==state.server.id||q.egg!==state.egg.id||q.nest!==state.nest.id||!/^[a-f0-9-]{36}$/.test(uuid))throw Error('Exact durable owned cleanup receipt required');
 const checks={containers:ownedContainers().length===0,allocations:!(await api('/api/application/nodes/1/allocations')).data.some(r=>q.allocations.includes(r.attributes.id)),reader_removed:!state.reader||(state.reader.user_removed===true&&state.reader.subuser_removed===true)};
 for(const [key,url]of[['server','/api/application/servers/'+q.server],['egg','/api/admin/eggs/'+q.egg],['nest','/api/admin/nests/'+q.nest]]){const r=await fetch('http://127.0.0.1:18099'+url);await r.text();checks[key]=r.status===404;}
 const w=JSON.parse(fs.readFileSync('.local/game-parity-20261029/runtime/wings-private.json'));if(w.system.data!=='/var/lib/voltra-parity-20261029/volumes')throw Error('Campaign root drift');
 docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--mount','type=bind,source='+w.system.data+',target=/volumes,readonly','python:3.12-slim','python','-B','-c',`from pathlib import Path; p=Path('/volumes/${uuid}'); assert not p.exists() and not p.is_symlink()`]);checks.volume=true;
 state.cleanup={at:new Date().toISOString(),checks,outcome:'tested',reason:'Bounded native practical checks complete; native help command response and client/WAN gameplay unproved'};save();if(!Object.values(checks).every(Boolean))throw Error('Owned cleanup absence proof incomplete');releaseNative(state.lease.lease_id,state.lease.owner,'tested',true);return state.cleanup;
}
async function capture(label){
 const bytes=await contents('impostor/config.json'),value=JSON.parse(bytes);fs.writeFileSync(dir+'/'+label+'-config.json',bytes);
 fs.writeFileSync(dir+'/'+label+'-native.log',docker(['logs',state.server.uuid]));
 state.captures??={};state.captures[label]={at:new Date().toISOString(),sha256:hash(bytes),bytes:bytes.length,config:value,power:await observePower(state)};save();
 return state.captures[label];
}
if(phase==='install'){
 if(!process.argv.includes('--coordinator-handoff')||state.server)throw Error('Explicit installer handoff and no existing fixture required');
 for(const [name,bytes,sha]of assets){const data=fs.readFileSync('.local/among-us-games/'+name);if(data.length!==bytes||hash(data)!==sha)throw Error('Pinned public cache drift '+name);}
 if(!profile.egg.scripts.installation.script.includes('public-cache'))throw Error('Canonical installer lacks reviewed cache support');
 if(profile.egg.variables.some(v=>/eula|consent|agreement/i.test(v.env_variable)))throw Error('Consent prerequisite requires root review');
 if(profile.egg.variables.find(v=>v.env_variable==='AUTO_UPDATE')?.default_value!=='0')throw Error('Unexpected startup acquisition default');
 docker(['image','inspect',profile.egg.scripts.installation.container]);docker(['image','inspect',Object.values(profile.egg.docker_images)[0]]);
 for(let attempt=0;attempt<40;attempt++){try{state.slot=acquireInstaller(state.lease.lease_id,state.lease.owner);break;}catch(e){if(!/slot occupied|headroom/.test(e.message))throw e;const q=JSON.parse(fs.readFileSync('.local/game-parity-20261029/runtime/queue.json'));state.queue_wait={at:new Date().toISOString(),attempt,reason:e.message,held_by:q.installer_slot?.owner};save();console.log(JSON.stringify(state.queue_wait));await sleep(Math.min(15000,2000+attempt*1000));}}if(!state.slot)throw Error('QUEUED installer admission after bounded backoff');save();
 await createNativeFixture({lease:state.lease,slot:state.slot,profile,name:'Campaign ImPostor native wave190',environment:{VERSION:'v1.10.9',DOTNET_CHANNEL:'8',PUBLIC_IP:'127.0.0.1',PUBLIC_PORT:'',AUTO_UPDATE:'0'},onStep:step=>{state={...state,...step};save();}});
 const gated=await waitNativeInstaller(state);state.installer_proof=gated.proof;save();
 docker(['exec',gated.container.Id,'mkdir','-p','/mnt/server/.voltra/public-cache']);
 for(const [name,bytes,sha]of assets){docker(['cp',path.resolve('.local/among-us-games/'+name),gated.container.Id+':/mnt/server/.voltra/public-cache/'+sha]);if(!docker(['exec',gated.container.Id,'sha256sum','/mnt/server/.voltra/public-cache/'+sha]).startsWith(sha))throw Error('Copied cache drift '+name);}
 state.publisher_cache=assets.map(([name,bytes,sha256])=>({name,bytes,sha256,source:'Previously retained exact official public release; no fresh game acquisition'}));
 state.installer_observers=attach(gated.container.Id,'installer');save();releaseGate(gated.container,state.lease,state.slot.token);
 state.install_outcome=await waitInstallOutcome(state);save();if(!state.install_outcome.success)throw Error('Native installer failed; retain slot for bounded review');
 releaseInstaller(state.slot);state.slot_released=true;save();console.log(JSON.stringify({uuid:state.server.uuid,install:state.install_outcome,slot_released:true}));
}else if(phase==='start'){
 if(!state.install_outcome?.success)throw Error('Successful installation required');
 const helpers=[...profile.egg.scripts.installation.script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].filter(m=>m[1].endsWith('.py'));
 if(!helpers.length)throw Error('No embedded helper proof inputs');state.helpers=[];
 for(const m of helpers){const bytes=await contents(m[1]),actual=hash(bytes),source=m[3]+'\n';if(![hash(source),hash(source.replaceAll('\r\n','\n'))].includes(actual))throw Error('Installed helper differs '+m[1]);state.helpers.push({file:m[1],sha256:actual});}save();
 await api(endpoint()+'/power','POST',{signal:'start'});await waitPower('running');
 const began=Date.now();let marker=false;while(Date.now()-began<30000){const c=JSON.parse(docker(['inspect','--format','{{json .State}}',state.server.uuid]));if(c.Running&&docker(['logs','--since',c.StartedAt,state.server.uuid]).includes('Matchmaker is listening on')){marker=true;break;}await sleep(500);}if(!marker)throw Error('Actual Impostor readiness not observed');
 const c=await capture(process.argv[3]||'baseline');console.log(JSON.stringify({ready:true,sha256:c.sha256,public_port:c.config.Server.PublicPort,listen_port:c.config.Server.ListenPort}));
}else if(phase==='stop'){
 await api(endpoint()+'/power','POST',{signal:'stop'});state.stop_power=await waitPower('offline');state.stop_native=JSON.parse(docker(['inspect','--format','{{json .State}}',state.server.uuid]));
 fs.writeFileSync(dir+'/last-stop-native.log',docker(['logs',state.server.uuid]));state.stops??=[];state.stops.push({at:new Date().toISOString(),native:state.stop_native});save();console.log(JSON.stringify(state.stop_native));
}else if(phase==='observe'){
 console.log(JSON.stringify({server:state.server,power:await observePower(state)}));
}else if(phase==='protocol'){
 if((await observePower(state)).current_state!=='running')throw Error('Actual running native required');
 const origin='http://127.0.0.1:'+state.lease.ports[0];
 const hello=await fetch(origin,{signal:AbortSignal.timeout(10000)}),text=await hello.text();
 if(hello.status!==200||!text.includes('Impostor is running'))throw Error('Native HTTP greeting failed');
 const bad=await fetch(origin+'/api/user',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});await bad.text();
 if(bad.status!==400)throw Error('Native malformed authentication request not rejected');
 const request={Puid:'voltra-isolated-protocol-probe',Username:'VoltraProbe',ClientVersion:20240712,Language:0};
 const auth=await fetch(origin+'/api/user',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(10000)});
 const wire=await auth.text();let token;try{const encoded=wire.trim().startsWith('"')?JSON.parse(wire):wire.trim();token=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));}catch{throw Error('Native authentication response shape differs from retained publisher controller');}
 if(auth.status!==200||token.Content.Puid!==request.Puid||token.Content.ClientVersion!==request.ClientVersion)throw Error('Native authentication roundtrip failed');
 const code="from pathlib import Path\nimport json\np="+state.lease.ports[0]+"\nrows=[line.split() for line in Path('/proc/net/udp').read_text().splitlines()[1:]]\nprint(json.dumps({'udp_socket_bound':any(int(row[1].split(':')[-1],16)==p for row in rows),'port':p}))";
 const listener=JSON.parse(docker(['exec',state.server.uuid,'env','PYTHONHOME=/home/container/.voltra/python','LD_LIBRARY_PATH=/home/container/.voltra/python/lib','/home/container/.voltra/python/bin/python3','-c',code]));
 if(!listener.udp_socket_bound)throw Error('Native UDP socket not bound');
 state.protocol={at:new Date().toISOString(),hello_status:hello.status,malformed_auth_status:bad.status,authentication_status:auth.status,puid_roundtrip:true,version_roundtrip:true,credentials_retained:false,listener,scope:'Real loopback native HTTP authentication plus owned-namespace UDP listener. Not a UDP game/client handshake, TLS, forwarding or player join.',external_prerequisite:'Publisher warns modern Among Us clients require HTTPS reverse proxy; none automatically configured'};save();console.log(JSON.stringify(state.protocol));
}else if(phase==='settings'){
 const {checkImpostorSettings}=await import('./impostor-practical-settings.mjs');
 state.settings=await checkImpostorSettings({endpoint:endpoint(),api,readConfig:()=>contents('impostor/config.json')});save();console.log(JSON.stringify(state.settings));
}else if(phase==='permissions'){
 if((await observePower(state)).current_state!=='offline')throw Error('Offline fixture required');
 if(!state.reader||state.reader.user_removed)state.reader=await createReaderFixture(state,r=>{state.reader=r;save();});
 else{if(state.reader.server_uuid!==state.server.uuid)throw Error('Reader scope drift');const who=await readerRequest(state.reader,'/api/client/account');const user=(await who.json()).attributes;if(!who.ok||user.id!==state.reader.user.id||user.root_admin!==false)throw Error('Reader identity drift');}
 const url=endpoint()+'/game-settings?file=%2Fimpostor%2Fconfig.json',r=await readerRequest(state.reader,url),view=(await r.json()).attributes,before=hash(await contents('impostor/config.json'));
 if(r.status!==200||view.fields.length<28)throw Error('Nonadmin native read failed');
 state.permissions={at:new Date().toISOString(),identity_boundary:state.reader.identity_boundary,reader_read_status:r.status,field_count:view.fields.length,outcomes:[]};save();
 for(const [name,target,method,body]of[['settings-write',url,'PUT',{revision:view.revision,settings:{'/Timeout/SpawnTimeout':'2800'}}],['startup-write',endpoint()+'/startup/variable','PUT',{key:'PUBLIC_IP',value:'127.0.0.2'}],['power-start',endpoint()+'/power','POST',{signal:'start'}],['console-command',endpoint()+'/command','POST',{command:'forbidden reader'}],['rawfile-write',endpoint()+'/files/write?file=%2Fimpostor%2Fconfig.json','POST',{}]]){const response=await readerRequest(state.reader,target,method,body);await response.text();state.permissions.outcomes.push({name,status:response.status});save();if(response.status!==403)throw Error('Reader forbidden action not403 '+name);}
 state.permissions.unchanged=hash(await contents('impostor/config.json'))===before;state.permissions.remains_offline=(await observePower(state)).current_state==='offline';save();if(!state.permissions.unchanged||!state.permissions.remains_offline)throw Error('Forbidden request changed server');
 await removeReaderFixture(state.reader,r=>{state.reader=r;save();});console.log(JSON.stringify(state.permissions));
}else if(phase==='settings-security'){
 if((await observePower(state)).current_state!=='offline')throw Error('Offline native settings negative checks required');
 const url=endpoint()+'/game-settings?file=%2Fimpostor%2Fconfig.json',view=(await api(url)).attributes,before=hash(await contents('impostor/config.json'));
 const large=view.fields.find(f=>f.key==='/VoltraOperatorRetention/LargeInteger');if(large?.value!=='9007199254740993')throw Error('Native large integer precision not preserved by typed API');
 state.security={at:new Date().toISOString(),large_integer_literal:large.value,negative_cases:[]};save();
 for(const value of ['NaN','2700\ninjected=1']){const r=await fetch('http://127.0.0.1:18099'+url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:view.revision,settings:{'/Timeout/SpawnTimeout':value}})});await r.text();const unchanged=hash(await contents('impostor/config.json'))===before;state.security.negative_cases.push({name:value==='NaN'?'nonfinite-number':'newline-injection',status:r.status,unchanged});save();if(r.ok||!unchanged)throw Error('Unsafe JSON native numeric patch accepted');}
 console.log(JSON.stringify(state.security));
}else if(phase==='managed-case-probe'){
 if((await observePower(state)).current_state!=='offline')throw Error('Offline only; native is never started with this temporary alias');
 const url=endpoint()+'/game-settings?file=%2Fimpostor%2Fconfig.json',raw=endpoint()+'/files/write?file=%2Fimpostor%2Fconfig.json',before=await contents('impostor/config.json');
 const altered=before.toString().replace(/("HttpServer"\s*:\s*\{[\s\S]*?)"ListenPort"(\s*:)/,'$1"listenport"$2');if(altered===before.toString())throw Error('Expected canonical listener key not found');
 const write=async body=>{const r=await fetch('http://127.0.0.1:18099'+raw,{method:'POST',headers:{'Content-Type':'text/plain'},body});await r.text();if(!r.ok)throw Error('Owned case fixture write failed');};
 fs.writeFileSync(dir+'/case-probe-original-config.json',before);
 try{
  await write(altered);const view=(await api(url)).attributes,field=view.fields.find(f=>f.key==='/HttpServer/listenport');
  if(!field)throw Error('Case fixture field unavailable');
  const r=await fetch('http://127.0.0.1:18099'+url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:view.revision,settings:{'/HttpServer/listenport':String(state.lease.ports[0]+1)}})});await r.text();
  state.managed_case_probe={at:new Date().toISOString(),runtime_pid:receipt.pid,key:field.key,readonly:field.readonly,patch_status:r.status,mutation_accepted:r.ok,scope:'Temporary owned offline JSON case alias, never started. Original raw bytes restored in finally.'};save();
 }finally{await write(before);state.managed_case_probe??={};state.managed_case_probe.restored_exact=hash(await contents('impostor/config.json'))===hash(before);save();}
 if(!state.managed_case_probe.restored_exact)throw Error('Case fixture baseline restore failed');console.log(JSON.stringify(state.managed_case_probe));
}else if(phase==='advertised-address'){
 if((await observePower(state)).current_state!=='offline')throw Error('Startup authority scenario needs offline');
 const value=process.argv[3];if(!['127.0.0.1','127.0.0.2'].includes(value))throw Error('Only isolated advertised loopback scenario allowed');
 await api(endpoint()+'/startup/variable','PUT',{key:'PUBLIC_IP',value});state.advertised_address={at:new Date().toISOString(),value,scope:'Original PUBLIC_IP Startup field, bound listener remains allocated/all-interfaces'};save();console.log(JSON.stringify(state.advertised_address));
}else if(phase==='lifecycle-ws'){
 if((await observePower(state)).current_state!=='offline')throw Error('Actual offline fixture required');
 const auth=(await api(endpoint()+'/websocket')).data,u=new URL(auth.socket),events=[];
 if(!['127.0.0.1','localhost'].includes(u.hostname)||!['18099','18100'].includes(u.port)||!u.pathname.includes(state.server.uuid))throw Error('Owned loopback websocket required');
 const ws=new WebSocket(auth.socket),timer=setTimeout(()=>ws.close(),60000);
 try{
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('WS auth timeout')),7000);ws.onopen=()=>ws.send(JSON.stringify({event:'auth',args:[auth.token]}));ws.onerror=()=>{clearTimeout(t);reject(Error('WS failed'));};ws.onmessage=m=>{let e;try{e=JSON.parse(String(m.data));}catch{return;}if(e.event==='auth success'){clearTimeout(t);resolve();}if(['status','console output','daemon message','daemon error'].includes(e.event)&&events.length<2000)events.push({at:new Date().toISOString(),event:e.event,args:e.args});};});
  await sleep(100);const startIndex=events.length;
  await api(endpoint()+'/power','POST',{signal:'start'});await waitPower('running');
  const began=Date.now();let ready=false;while(Date.now()-began<30000){const c=JSON.parse(docker(['inspect','--format','{{json .State}}',state.server.uuid]));if(c.Running&&docker(['logs','--since',c.StartedAt,state.server.uuid]).includes('Matchmaker is listening on')){ready=true;break;}await sleep(250);}if(!ready)throw Error('New native readiness missing');
  await capture('ws-lifecycle');await sleep(200);await api(endpoint()+'/power','POST',{signal:'stop'});await waitPower('offline');await sleep(200);
  const current=events.slice(startIndex),native=JSON.parse(docker(['inspect','--format','{{json .State}}',state.server.uuid]));
  state.lifecycle_ws={at:new Date().toISOString(),runtime_pid:receipt.pid,sequence:current.filter(e=>e.event==='status').map(e=>e.args[0]),new_native_ready_log:current.some(e=>e.event==='console output'&&e.args.some(a=>String(a).includes('Matchmaker is listening on'))),native_stop:native,evidence:dir+'/lifecycle-ws.json'};
  fs.writeFileSync(dir+'/lifecycle-ws.json',JSON.stringify(current,null,2)+'\n');save();console.log(JSON.stringify(state.lifecycle_ws));
 }finally{ws.close();clearTimeout(timer);}
}else if(phase==='unexpected-kill'){
 if((await observePower(state)).current_state!=='running')throw Error('Real ready native required');
 let ws,wsTimer,events=[];
 if(process.argv.includes('--ws')){
  const auth=(await api(endpoint()+'/websocket')).data,u=new URL(auth.socket);
  if(!['127.0.0.1','localhost'].includes(u.hostname)||!['18099','18100'].includes(u.port)||!u.pathname.includes(state.server.uuid)||!u.pathname.endsWith('/ws'))throw Error('Unexpected Wings WS authority');
  ws=new WebSocket(auth.socket);wsTimer=setTimeout(()=>ws.close(),25000);
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{ws.close();reject(Error('Real WS authentication timeout'));},7000);
   ws.onopen=()=>ws.send(JSON.stringify({event:'auth',args:[auth.token]}));
   ws.onerror=()=>{clearTimeout(timeout);reject(Error('Real Wings WS failed'));};
   ws.onmessage=message=>{let event;try{event=JSON.parse(String(message.data));}catch{return;}
    if(event.event==='auth success'){clearTimeout(timeout);ws.send(JSON.stringify({event:'send logs',args:[]}));ws.send(JSON.stringify({event:'send stats',args:[]}));resolve();}
    if(['status','console output','daemon message','daemon error','install output'].includes(event.event)&&events.length<2000)events.push({at:new Date().toISOString(),event:event.event,args:event.args});
   };
  });
 }
 const code="from pathlib import Path\nimport os,signal,json\nm=[]\nfor p in Path('/proc').iterdir():\n if not p.name.isdigit():continue\n try:\n  if (p/'exe').resolve()==Path('/home/container/impostor/Impostor.Server'):m.append(int(p.name))\n except OSError:pass\nassert len(m)==1,m\nprint(json.dumps({'namespace_pid':m[0],'signal':'SIGKILL','exe':'/home/container/impostor/Impostor.Server'}),flush=True)\nos.kill(m[0],signal.SIGKILL)";
 state.unexpected_history??=[];if(state.unexpected)state.unexpected_history.push(state.unexpected);
 state.unexpected={at:new Date().toISOString(),scope:'Exact native child in owned container namespace only; supervisor/container not killed',observations:[]};save();
 state.unexpected.kill=JSON.parse(docker(['exec',state.server.uuid,'env','PYTHONHOME=/home/container/.voltra/python','LD_LIBRARY_PATH=/home/container/.voltra/python/lib','/home/container/.voltra/python/bin/python3','-c',code]));save();
 const begin=Date.now();while(Date.now()-begin<12000){const c=ownedContainers(),power=await observePower(state);state.unexpected.observations.push({at:new Date().toISOString(),containers:c,power});save();await sleep(1000);}
 fs.writeFileSync(dir+'/unexpected-native.log',docker(['logs',state.server.uuid]));
 if(ws){ws.close();clearTimeout(wsTimer);fs.writeFileSync(dir+'/unexpected-ws.json',JSON.stringify(events,null,2)+'\n');state.unexpected.websocket={file:dir+'/unexpected-ws.json',events:events.length,status_events:events.filter(e=>e.event==='status'),daemon_errors:events.filter(e=>/daemon/.test(e.event)),crash_lines:events.filter(e=>/crash|exit code|137|error/i.test(JSON.stringify(e.args)))};save();}
 console.log(JSON.stringify({kill:state.unexpected.kill,final:await observePower(state),exit:ownedContainers().map(c=>({exit:c.state.ExitCode,oom:c.state.OOMKilled,running:c.state.Running})),websocket:state.unexpected.websocket}));
}else if(phase==='operator-seed'){
 if((await observePower(state)).current_state!=='offline')throw Error('Offline required');
 const before=(await contents('impostor/config.json')).toString();if(before.includes('VoltraOperatorRetention'))throw Error('Operator fixture exists');
 const after=before.replace(/\n}\s*$/,',\n  "VoltraOperatorRetention": {\n    "LargeInteger": 9007199254740993,\n    "Text": "retain unknown settings"\n  }\n}\n');
 if(after===before)throw Error('Unknown native JSON layout');
 for(const [name,body]of[['impostor/config.json',after],['impostor/voltra-operator-retention.txt','Unknown operator file\r\nretain punctuation ! # ;\r\n']]){const r=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/write?file='+encodeURIComponent('/'+name),{method:'POST',headers:{'Content-Type':'text/plain'},body});await r.text();if(!r.ok)throw Error('Owned operator fixture write failed');}
 state.operator_seed={at:new Date().toISOString(),before_sha256:hash(before),after_sha256:hash(after),large_integer_literal:'9007199254740993',sidecar:'impostor/voltra-operator-retention.txt'};save();console.log(JSON.stringify(state.operator_seed));
}else if(phase==='snapshot'){
 const label=process.argv[3];if(!/^[a-z0-9_-]+$/.test(label||'')||(await observePower(state)).current_state!=='offline'||ownedContainers().some(c=>c.state.Running))throw Error('Explicit snapshot label and stopped game/installer required');
 const w=JSON.parse(fs.readFileSync('.local/game-parity-20261029/runtime/wings-private.json'));if(w.system.data!=='/var/lib/voltra-parity-20261029/volumes'||!/^[a-f0-9-]{36}$/.test(state.server.uuid))throw Error('Exact campaign mount required');
 const code="from pathlib import Path\nimport hashlib,json,stat,os\nr=Path('/volume');out={}\nfor relative in ('impostor','.voltra/impostor/release.json','.voltra/dotnet/voltra-release.json','.voltra/among-us','.voltra/public-cache'):\n p=r/relative\n for f in ([p,*p.rglob('*')] if p.is_dir() else [p]):\n  if f.is_symlink():out[f.relative_to(r).as_posix()]={'link':os.readlink(f)};continue\n  if not f.is_file():continue\n  s=f.stat()\n  with f.open('rb') as stream:h=hashlib.file_digest(stream,'sha256').hexdigest()\n  out[f.relative_to(r).as_posix()]={'bytes':s.st_size,'sha256':h,'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid}\nprint(json.dumps(out))";
 const files=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--mount','type=bind,source='+w.system.data+'/'+state.server.uuid+',target=/volume,readonly','python:3.12-slim','python','-B','-c',code]));
 state.snapshots??={};state.snapshots[label]={at:new Date().toISOString(),files};save();console.log(JSON.stringify({label,files:Object.keys(files).length}));
}else if(phase==='reinstall'){
 if(!process.argv.includes('--coordinator-handoff')||(await observePower(state)).current_state!=='offline'||!state.slot_released||hash(profile.egg.scripts.installation.script)!==state.installer_body_sha256)throw Error('Owned serialized original installer prerequisites not met');
 state.slot=acquireInstaller(state.lease.lease_id,state.lease.owner);state.slot_released=false;save();
 await api('/api/admin/eggs/'+state.egg.id+'/scripts','PATCH',{script_install:installerGate(profile.egg.scripts.installation.script,state.slot.token)});
 state.reinstall_request={at:new Date().toISOString(),installer_body_sha256:state.installer_body_sha256,slot:state.slot};save();await api('/api/application/servers/'+state.server.id+'/reinstall','POST',{});
 const gated=await waitNativeInstaller(state);state.reinstall_proof=gated.proof;state.reinstall_observers=attach(gated.container.Id,'reinstall');save();releaseGate(gated.container,state.lease,state.slot.token);
 state.reinstall_outcome=await waitInstallOutcome(state);save();if(!state.reinstall_outcome.success)throw Error('Reinstall failed; retain owned slot');releaseInstaller(state.slot);state.slot_released=true;save();console.log(JSON.stringify({reinstalled:true,outcome:state.reinstall_outcome,slot_released:true}));
}else if(phase==='restart'){
 if((await observePower(state)).current_state!=='running')throw Error('Actual running game required');
 const before=JSON.parse(docker(['inspect','--format','{{json .State}}',state.server.uuid]));await api(endpoint()+'/power','POST',{signal:'restart'});
 const began=Date.now();let after;while(Date.now()-began<45000){try{const c=JSON.parse(docker(['inspect','--format','{{json .State}}',state.server.uuid]));if(c.Running&&c.StartedAt!==before.StartedAt&&docker(['logs','--since',c.StartedAt,state.server.uuid]).includes('Matchmaker is listening on')){after=c;break;}}catch{}await sleep(500);}
 if(!after)throw Error('New native readiness after restart not observed');state.restart={at:new Date().toISOString(),before:before.StartedAt,after:after.StartedAt,new_native_readiness:true};save();await capture('after-explicit-restart');console.log(JSON.stringify(state.restart));
}else if(phase==='cleanup'){
 if(!state.slot_released||(await observePower(state)).current_state!=='offline'||ownedContainers().some(c=>c.state.Running))throw Error('Stopped fixture, released installer and removed reader required');
 const nest=(await api('/api/admin/nests/'+state.nest.id)).attributes,egg=(await api('/api/admin/eggs/'+state.egg.id)).attributes;
 if(nest.name!=='Campaign ImPostor native wave190'||egg.nest_id!==nest.id)throw Error('Owned temporary definitions drift');
 state.cleanup_request={at:new Date().toISOString(),uuid:state.server.uuid,server:state.server.id,egg:state.egg.id,nest:state.nest.id,allocations:state.allocations.map(a=>a.id)};save();
 await api('/api/application/servers/'+state.server.id,'DELETE');
 for(const a of state.allocations){const current=(await api('/api/application/nodes/1/allocations')).data.map(r=>r.attributes).find(r=>r.id===a.id);if(!current||current.server_id!=null||current.port!==a.port||current.ip!=='127.0.0.1'||!state.lease.ports.includes(current.port))throw Error('Owned allocation drift');await api('/api/application/nodes/1/allocations/'+a.id,'DELETE');}
 await api('/api/admin/eggs/'+state.egg.id,'DELETE');await api('/api/admin/nests/'+state.nest.id,'DELETE');console.log(JSON.stringify(await completeCleanup()));
}else if(phase==='cleanup-finish'){
 console.log(JSON.stringify(await completeCleanup()));
}else throw Error('Unknown explicitly scoped native phase');
