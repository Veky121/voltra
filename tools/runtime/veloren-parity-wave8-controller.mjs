import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {verifyRuntime,profileFromRuntime,activeLease,api,docker,observePower,createReaderFixture,readerRequest,removeReaderFixture} from './campaign-native-20261029.mjs';
const dir='.local/game-parity-20261029/veloren-root-native',file=dir+'/state.json',state=JSON.parse(fs.readFileSync(file)),save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n'),phase=process.argv[2],label=process.argv[3]||phase;
if(!/^[a-z0-9_-]{1,50}$/.test(label))throw Error('Explicit safe evidence label required');
activeLease(state.lease.lease_id,state.lease.owner);state.latest_runtime=await verifyRuntime();save();
if(!state.server||!state.install_outcome?.success||!state.slot_released)throw Error('Canonical install and acquisition slot release required');
const owned=(await api('/api/application/servers/'+state.server.id)).attributes;
if(owned.uuid!==state.server.uuid||owned.egg!==state.egg.id||owned.node!==1)throw Error('Owned native fixture identity drift');
const endpoint='/api/client/servers/'+state.server.uuid,sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function contents(name){const r=await fetch('http://127.0.0.1:18099'+endpoint+'/files/contents?file='+encodeURIComponent('/'+name));if(!r.ok)throw Error('Owned file unavailable '+name+':'+r.status);return Buffer.from(await r.arrayBuffer());}
function native(){const r=spawnSync('docker',['--context','desktop-linux','inspect','--format','{"id":{{json .Id}},"running":{{json .State.Running}},"exit_code":{{json .State.ExitCode}},"oom_killed":{{json .State.OOMKilled}},"started":{{json .State.StartedAt}},"finished":{{json .State.FinishedAt}},"pid":{{json .State.Pid}}}',state.server.uuid],{encoding:'utf8',windowsHide:true,maxBuffer:1024**2});if(r.status===0)return JSON.parse(r.stdout);if(/No such (object|container)/.test(r.stderr||''))return{missing:true,running:false,started:'0001-01-01T00:00:00Z'};throw Error('Owned native state observation failed');}
function startLogs(s){const r=spawnSync('docker',['--context','desktop-linux','logs','--since',s.started,s.id],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024**2});if(r.status===0)return r.stdout+r.stderr;const error=String(r.stderr||'');state.observer_log_failures??=[];state.observer_log_failures.push({at:new Date().toISOString(),container:s.id,error:error.slice(0,500)});save();if(/No such container|No such object|has not been started|has been marked for removal|is marked for removal|can not get logs from container which is dead or marked for removal/.test(error))return null;throw Error('Owned start log observation failed; captured redacted daemon error');}
async function waitOffline(){for(let n=0;n<120;n++){const p=await observePower(state);if(p.current_state==='offline')return p;await sleep(500);}throw Error('Bounded native shutdown did not reach offline');}
async function wire(){const a=(await api(endpoint+'/websocket')).data,u=new URL(a.socket);if(!['127.0.0.1','localhost'].includes(u.hostname)||!['18099','18100'].includes(u.port)||!u.pathname.includes(state.server.uuid))throw Error('Owned loopback socket required');const ws=new WebSocket(a.socket),events=[];await new Promise((resolve,reject)=>{const t=setTimeout(()=>{ws.close();reject(Error('WS authentication timed out'));},7000);ws.onopen=()=>ws.send(JSON.stringify({event:'auth',args:[a.token]}));ws.onerror=()=>{clearTimeout(t);reject(Error('Owned WS failed'));};ws.onmessage=m=>{let e;try{e=JSON.parse(String(m.data));}catch{return;}if(e.event==='auth success'){clearTimeout(t);resolve();}if(['status','console output','daemon message','daemon error'].includes(e.event)&&events.length<3000)events.push({at:new Date().toISOString(),event:e.event,args:e.args});};});return{events,close(){ws.close();}};}
async function capture(){const records={};for(const name of ['userdata/server/server_config/settings.ron','userdata/server-cli/settings.ron','.voltra/veloren-release.json']){const bytes=await contents(name),local=dir+'/'+label+'-'+name.replaceAll('/','_');fs.writeFileSync(local,bytes);records[name]={file:local,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};}fs.writeFileSync(dir+'/'+label+'-native.log',docker(['logs',state.server.uuid]));state.captures??={};state.captures[label]={at:new Date().toISOString(),records,native:native(),power:await observePower(state)};save();return state.captures[label];}
if(phase==='attest'){
 const profile=profileFromRuntime(state.lease.game,state.latest_runtime),helpers=[...profile.egg.scripts.installation.script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)];
 if(helpers.length!==7)throw Error('Exact reviewed seven embedded resources required');
 const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');state.helper_attestation=[];
 for(const m of helpers){const actual=await contents(m[1]),digest=hash(actual);if(![hash(m[3]+'\n'),hash((m[3]+'\n').replaceAll('\r\n','\n'))].includes(digest))throw Error('Installed embedded resource differs '+m[1]);state.helper_attestation.push({file:m[1],bytes:actual.length,sha256:digest});}
 const release=JSON.parse(await contents('.voltra/veloren-release.json'));if(release.sha256!==state.cache.sha256||release.bytes!==state.cache.bytes||release.architecture!=='x86_64'||release.channel!=='weekly')throw Error('Actual native release receipt differs from reviewed publisher archive');
 state.native_identity={release,at:new Date().toISOString()};save();console.log(JSON.stringify({resources:state.helper_attestation.length,release_sha256:release.sha256,architecture:release.architecture}));
}else if(phase==='start'){
 const observeExisting=process.argv.includes('--observe-existing-start');
 if(observeExisting){if(!native().running)throw Error('Existing native start must actually be running');state.harness_corrections??=[];state.harness_corrections.push({at:new Date().toISOString(),reason:'Observer reattached to actual existing generation after a start log read failed; no duplicate start action. Initial transition coverage is partial for this attempt.'});save();}
 else if((await observePower(state)).current_state!=='offline')throw Error('Fresh start requires offline fixture');
 const ws=await wire();try{if(!observeExisting)await api(endpoint+'/power','POST',{signal:'start'});const began=Date.now();let ready=false;
 while(Date.now()-began<300000){const s=native();if(s.started.startsWith('0001-')){await sleep(250);continue;}const logs=startLogs(s);if(s.running&&logs?.includes('Server is ready to accept connections')&&(await observePower(state)).current_state==='running'){ready=true;break;}if(!s.running&&Date.now()-began>3000)break;await sleep(1000);}
 state.starts??=[];state.starts.push({label,at:new Date().toISOString(),ready,native:native(),power:await observePower(state)});fs.writeFileSync(dir+'/'+label+'-ws.json',JSON.stringify(ws.events,null,2)+'\n');save();if(!ready){fs.writeFileSync(dir+'/'+label+'-native.log',docker(['logs',state.server.uuid]));throw Error('Actual native readiness not reached; preserve failure and review');}await capture();console.log(JSON.stringify({uuid:state.server.uuid,ready:true,native:native()}));
 }finally{ws.close();}
}else if(phase==='restart'){
 const before=native();if(!before.running||(await observePower(state)).current_state!=='running')throw Error('Actual running native game required for restart');
 const ws=await wire();try{await api(endpoint+'/power','POST',{signal:'restart'});const began=Date.now();let ready=false;while(Date.now()-began<300000){const s=native();if(s.running&&!s.started.startsWith('0001-')&&s.started!==before.started&&startLogs(s)?.includes('Server is ready to accept connections')&&(await observePower(state)).current_state==='running'){ready=true;break;}await sleep(500);}const after=native();state.restarts??=[];state.restarts.push({label,at:new Date().toISOString(),before,after,ready,sequence:ws.events.filter(x=>x.event==='status').map(x=>x.args[0])});fs.writeFileSync(dir+'/'+label+'-ws.json',JSON.stringify(ws.events,null,2)+'\n');save();if(!ready)throw Error('Real restart failed to reach new native readiness');await capture();console.log(JSON.stringify(state.restarts.at(-1)));}finally{ws.close();}
}else if(phase==='unexpected-kill'){
 if((await observePower(state)).current_state!=='running')throw Error('Actual ready native game required');
 const inspect='import os,json; rows=[]\nfor n in os.listdir("/proc"):\n if n.isdigit():\n  try:\n   if os.readlink("/proc/"+n+"/exe")=="/home/container/veloren-server-cli": rows.append(int(n))\n  except OSError: pass\nprint(json.dumps(rows))';
 const children=JSON.parse(docker(['exec',state.server.uuid,'python3','-c',inspect]));if(children.length!==1||!Number.isInteger(children[0])||children[0]<=1)throw Error('Exactly one real native child PID required');
 const ws=await wire();try{docker(['exec',state.server.uuid,'python3','-c','import os,signal,sys; p=int(sys.argv[1]); assert os.readlink("/proc/"+str(p)+"/exe")=="/home/container/veloren-server-cli"; os.kill(p,signal.SIGKILL)',String(children[0])]);const power=await waitOffline(),after=native();await sleep(250);state.crash={at:new Date().toISOString(),native_child_pid:children[0],requested_signal:'SIGKILL',native:after,power,sequence:ws.events.filter(x=>x.event==='status').map(x=>x.args[0]),boundary:'Exact native child killed, not host/Docker daemon/container PID1; observed wrapper exit retained without remapping'};fs.writeFileSync(dir+'/'+label+'-ws.json',JSON.stringify(ws.events,null,2)+'\n');fs.writeFileSync(dir+'/'+label+'-native.log',docker(['logs',state.server.uuid]));save();if(after.running||after.oom_killed||after.exit_code===0)throw Error('Unexpected native exit proof differs');console.log(JSON.stringify(state.crash));}finally{ws.close();}
}else if(phase==='stop'){
 const ws=await wire();try{await api(endpoint+'/power','POST',{signal:'stop'});const power=await waitOffline();state.stops??=[];state.stops.push({label,at:new Date().toISOString(),native:native(),power});await sleep(250);fs.writeFileSync(dir+'/'+label+'-ws.json',JSON.stringify(ws.events,null,2)+'\n');fs.writeFileSync(dir+'/'+label+'-native.log',docker(['logs',state.server.uuid]));save();console.log(JSON.stringify(state.stops.at(-1)));}finally{ws.close();}
}else if(phase==='permissions'){
 if((await observePower(state)).current_state!=='offline')throw Error('Permission mutation refusals require stopped fixture');
 if(state.reader&&!state.reader.user_removed)throw Error('Existing reader requires review');
 state.reader=await createReaderFixture(state,r=>{state.reader=r;save();});
 state.permission_matrix_attempts??=[];if(state.permission_matrix)state.permission_matrix_attempts.push(state.permission_matrix);
 state.permission_matrix=[];const nativeBefore=crypto.createHash('sha256').update(await contents('userdata/server/server_config/settings.ron')).digest('hex');save();
 try{
  for(const [key,url,method,body,expected] of [
   ['native_file_read',endpoint+'/files/contents?file=%2Fuserdata%2Fserver%2Fserver_config%2Fsettings.ron','GET',undefined,200],
   ['write',endpoint+'/files/write?file=%2Fparity-denied-write.txt','POST','permission fixture must refuse',403],
   ['power',endpoint+'/power','POST',{signal:'stop'},403],
   ['console_command',endpoint+'/command','POST',{command:'help'},403],
   ['delete',endpoint+'/files/delete','POST',{root:'/',files:['parity-denied-write.txt']},403],
   ['typed_document_unsupported',endpoint+'/game-settings?file=%2Fuserdata%2Fserver%2Fserver_config%2Fsettings.ron','PUT',{settings:{day_length:'1440.0'}},404],
   ['startup_variable',endpoint+'/startup/variable','PUT',{key:'SERVER_NAME',value:'permission fixture must refuse'},403]
  ]){const response=await readerRequest(state.reader,url,method,body);await response.arrayBuffer();state.permission_matrix.push({key,method,status:response.status,expected,pass:response.status===expected});save();if(response.status!==expected)throw Error('Nonadmin permission boundary differed: '+key);}
  state.permissions_native_unchanged=crypto.createHash('sha256').update(await contents('userdata/server/server_config/settings.ron')).digest('hex')===nativeBefore;
  state.permissions_offline=(await observePower(state)).current_state==='offline';save();if(!state.permissions_native_unchanged||!state.permissions_offline)throw Error('Permission tests changed native state');
 }finally{await removeReaderFixture(state.reader,r=>{state.reader=r;save();});}
 console.log(JSON.stringify({identity:state.reader.identity_boundary,matrix:state.permission_matrix,reader_removed:state.reader.user_removed,subuser_removed:state.reader.subuser_removed}));
}else if(phase==='capture'){console.log(JSON.stringify(await capture()));}
else if(phase==='query'){
 if((await observePower(state)).current_state!=='running'||!state.query_build?.binary)throw Error('Actual running game and reviewed query binary required');
 const probe='/home/container/.voltra/acceptance-query';
 docker(['cp',state.query_build.binary.file,state.server.uuid+':'+probe]);
 if(!docker(['exec',state.server.uuid,'sha256sum',probe]).startsWith(state.query_build.binary.sha256))throw Error('Copied upstream query binary identity differs');
 docker(['exec','--user','0',state.server.uuid,'chmod','755',probe]);
 const raw=docker(['exec',state.server.uuid,probe,'127.0.0.1:'+state.lease.ports[0]]),query=JSON.parse(raw);if(!Number.isInteger(query.player_cap)||typeof query.git_hash!=='string')throw Error('Native upstream query response malformed');state.queries??={};state.queries[label]={at:new Date().toISOString(),...query,boundary:'Native UDP challenge/query only, not authenticated player/gameplay/external reachability'};fs.writeFileSync(dir+'/'+label+'-query.json',JSON.stringify(state.queries[label],null,2)+'\n');save();console.log(JSON.stringify(state.queries[label]));
}else throw Error('Use attest|start|stop|restart|unexpected-kill|capture|query|permissions');
