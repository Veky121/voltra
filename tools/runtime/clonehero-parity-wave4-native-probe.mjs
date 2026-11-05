// Owned cached-publisher Clone Hero probe. Runtime actions require an active
// coordinator lease; installation additionally requires explicit queue handoff.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {api,docker,containers,verifyRuntime,profileFromRuntime,activeLease,acquireInstaller,releaseInstaller,releaseNative,createNativeFixture,waitNativeInstaller,waitInstallOutcome,installerGate,releaseGate,observePower,createReaderFixture,readerRequest,removeReaderFixture} from './campaign-native-20261029.mjs';
const dir='.local/game-parity-20261029/clonehero-root-probe';fs.mkdirSync(dir,{recursive:true});
const file=dir+'/state.json',leaseReceipt=JSON.parse(fs.readFileSync(dir+'/lease.json'));
let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{lease:leaseReceipt.lease};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');
const phase=process.argv[2],archive='.local/small-games-family/clone.archive',archiveSHA='b64804a4834b0b66f5f1a77a526273ff699db9fbd1a092ef519615e28cf7d5ae';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const owner=state.lease.owner;
activeLease(state.lease.lease_id,owner);
if(state.lease.game!=='clone_hero/egg-clone-hero.json'||state.lease.memory_mib!==512||state.lease.disk_mib!==2048||state.lease.ports.length!==1)throw Error('Unexpected Clone lease');
const current=await verifyRuntime();state.latest_runtime=current;save();
const profile=profileFromRuntime(state.lease.game,current);
const endpoint=()=>'/api/client/servers/'+state.server.uuid;
function ownedContainers(){
 const rows=docker(['ps','-a','--filter','name='+state.server.uuid,'--format','{{.ID}}|{{.Names}}']).trim().split(/\r?\n/).filter(Boolean);
 const result=[];
 for(const row of rows){const [id,name]=row.split('|');
  try{result.push({Id:id,Name:'/'+name,State:JSON.parse(docker(['inspect','--format','{{json .State}}',id]))});}
  catch{if(docker(['ps','-aq','--filter','id='+id]).trim())throw Error('Owned container state inspection failed');}
 }
 return result;
}
if(state.server&&phase!=='cleanup-finish'){
 const owned=(await api('/api/application/servers/'+state.server.id)).attributes;
 if(owned.uuid!==state.server.uuid||owned.egg!==state.egg.id||owned.node!==1)throw Error('Native fixture ownership drift');
}
async function readFile(name){
 const response=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/contents?file='+encodeURIComponent('/'+name));
 if(!response.ok)throw Error('Native file read failed: '+response.status+' '+name);
 const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>65536)throw Error('Probe native config unexpectedly oversized');return bytes;
}
async function waitState(expected,timeout=40000){
 const start=Date.now();while(Date.now()-start<timeout){const observed=await observePower(state);if(observed.current_state===expected)return observed;await sleep(500);}throw Error('Native state observation timed out: '+expected);
}
async function capture(label){
 const bytes=await readFile('clone/settings.ini');fs.writeFileSync(dir+'/'+label+'-settings.ini',bytes);
 const records=[];let section='';
 for(const original of bytes.toString('utf8').replace(/^\uFEFF/,'').split(/\r?\n/)){
  const line=original.trim();if(!line||line.startsWith(';')||line.startsWith('#'))continue;
  const header=/^\[([^\]]+)\]$/.exec(line);if(header){section=header[1];continue;}
  const item=/^([^=]+)=(.*)$/.exec(original);if(!item){records.push({unsupported_line:true});continue;}
  const key=item[1].trim(),value=item[2].trim();records.push({section,key,value:/password|secret|token/i.test(key)?'[redacted]':value,observed_type:/^(true|false)$/i.test(value)?'boolean':/^-?\d+(\.\d+)?$/.test(value)?'number':'text'});
 }
 const inspect=JSON.parse(docker(['inspect',state.server.uuid]))[0];
 const logs=docker(['logs',state.server.uuid],true);fs.writeFileSync(dir+'/'+label+'-native.log',logs);
 const result={at:new Date().toISOString(),bytes:bytes.length,sha256:hash(bytes),records,native_state:inspect.State,resources:await observePower(state)};
 state.captures??={};state.captures[label]=result;save();return result;
}
if(phase==='install'){
 if(!process.argv.includes('--coordinator-handoff'))throw Error('Explicit coordinator installer handoff required');
 if(state.server)throw Error('Fixture already exists; inspect instead of creating another');
 if(fs.statSync(archive).size!==71307454||hash(fs.readFileSync(archive))!==archiveSHA)throw Error('Pinned cached publisher archive mismatch');
 if(!profile.egg.scripts.installation.script.includes('public-cache'))throw Error('Served installer lacks reviewed cache support');
 docker(['image','inspect',profile.egg.scripts.installation.container]);docker(['image','inspect',Object.values(profile.egg.docker_images)[0]]);
 state.slot=acquireInstaller(state.lease.lease_id,owner);save();
 await createNativeFixture({lease:state.lease,slot:state.slot,profile,environment:{SERVER_DISPLAY_NAME:'Voltra Clone schema baseline',SERVER_PASSWORD:'',LOG_LEVEL:'4',VERSION:'latest'},name:'Clone Hero native schema probe',onStep:step=>{state={...state,...step};save();}});
 const gated=await waitNativeInstaller(state);state.installer_proof=gated.proof;save();
 docker(['exec',gated.container.Id,'mkdir','-p','/mnt/server/.voltra/public-cache']);
 docker(['cp',path.resolve(archive),gated.container.Id+':/mnt/server/.voltra/public-cache/'+archiveSHA]);
 if(!docker(['exec',gated.container.Id,'sha256sum','/mnt/server/.voltra/public-cache/'+archiveSHA]).startsWith(archiveSHA))throw Error('Copied publisher cache mismatch');
 const attach=(args,file)=>{const fd=fs.openSync(dir+'/'+file,'a');const child=spawn('docker',['--context','desktop-linux',...args],{windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);child.on('error',error=>{state.attach_error=error.message;save();});return child.pid;};
 state.installer_observers={logs_pid:attach(['logs','--follow',gated.container.Id],'installer.log'),wait_pid:attach(['wait',gated.container.Id],'installer-wait.txt'),container:gated.container.Id,attached_before_gate_release:true};save();
 state.publisher={version:'v1.1.0.6142-final',sha256:archiveSHA,bytes:71307454,source:'Existing verified public archive; no fresh game acquisition'};save();
 releaseGate(gated.container,state.lease,state.slot.token);
 state.install_outcome=await waitInstallOutcome(state);save();
 if(!state.install_outcome.success)throw Error('Native installation failed; preserve slot and inspect actual installer identity');
 releaseInstaller(state.slot);state.installer_slot_released=true;save();
 console.log(JSON.stringify({phase,server_uuid:state.server.uuid,install:state.install_outcome,installer_slot_released:true}));
}else if(phase==='start'){
 if(!state.install_outcome?.success)throw Error('Successful installation required');
 const helpers=[...profile.egg.scripts.installation.script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].filter(match=>match[1].endsWith('.py'));
 state.helper_proof=[];
 for(const helper of helpers){
  const response=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/contents?file='+encodeURIComponent('/'+helper[1]));
  if(!response.ok)throw Error('Installed helper missing: '+helper[1]);const bytes=Buffer.from(await response.arrayBuffer());
  const expected=hash(helper[3]+'\n'),lf=hash((helper[3]+'\n').replaceAll('\r\n','\n')),actual=hash(bytes);
  if(![expected,lf].includes(actual))throw Error('Installed helper differs: '+helper[1]);state.helper_proof.push({file:helper[1],expected,expected_lf:lf,installed:actual});
 }
 save();await api(endpoint()+'/power','POST',{signal:'start'});await waitState('running');
 const start=Date.now();while(Date.now()-start<30000){if(docker(['logs',state.server.uuid]).includes('Server running...'))break;await sleep(500);}
 if(!docker(['logs',state.server.uuid]).includes('Server running...'))throw Error('Native readiness marker absent');
 const result=await capture(process.argv[3]||'baseline');console.log(JSON.stringify({phase,fields:result.records,settings_sha256:result.sha256}));
}else if(phase==='stop'){
 await api(endpoint()+'/power','POST',{signal:'stop'});state.stop_observation=await waitState('offline');
 state.stop_native=JSON.parse(docker(['inspect',state.server.uuid]))[0].State;save();console.log(JSON.stringify(state.stop_native));
 const stopLogs=docker(['logs',state.server.uuid]);fs.writeFileSync(dir+'/last-stop-native.log',stopLogs);
 state.stop_history??=[];state.stop_history.push({at:new Date().toISOString(),native:state.stop_native,diagnostics:stopLogs.split(/\r?\n/).filter(line=>line.startsWith('VOLTRA_CLONE_RAW_EXIT ')).map(line=>JSON.parse(line.slice('VOLTRA_CLONE_RAW_EXIT '.length)))});save();
}else if(phase==='restart'){
 if((await observePower(state)).current_state!=='running')throw Error('Restart requires actual running owned game');
 const before=JSON.parse(docker(['inspect',state.server.uuid]))[0];
 await api(endpoint()+'/power','POST',{signal:'restart'});
 const began=Date.now();let after;
 while(Date.now()-began<60000){
  try{const candidate=JSON.parse(docker(['inspect',state.server.uuid]))[0];if(candidate.State.Running&&candidate.State.StartedAt!==before.State.StartedAt&&docker(['logs','--since',candidate.State.StartedAt,state.server.uuid]).includes('Server running...')){after=candidate;break;}}catch{}
  await sleep(500);
 }
 if(!after)throw Error('Fresh native process/readiness after restart unverified');
 state.restart={at:new Date().toISOString(),before:{id:before.Id,started_at:before.State.StartedAt},after:{id:after.Id,started_at:after.State.StartedAt},new_native_readiness:true,resources:await observePower(state)};save();
 await capture('after-explicit-restart');console.log(JSON.stringify(state.restart));
}else if(phase==='cli-second'){
 if((await observePower(state)).current_state!=='offline')throw Error('Stop native before controlled CLI update');
 await api(endpoint()+'/startup/variable','PUT',{key:'SERVER_DISPLAY_NAME',value:'Voltra Clone CLI precedence second'});
 state.cli_second={name:'Voltra Clone CLI precedence second',changed:'Original Startup server-display-name field only; native INI remains untouched'};save();console.log('Controlled CLI scenario prepared; run start cli-second, then stop and compare captures.');
}else if(phase==='compare'){
 const a=state.captures?.baseline,b=state.captures?.['cli-second'];if(!a||!b)throw Error('Both actual native captures required');
 const logs=fs.readFileSync(dir+'/cli-second-native.log','utf8');
 state.precedence={native_ini_unchanged:a.sha256===b.sha256,second_cli_name_logged:logs.includes('Voltra Clone CLI precedence second'),captured_schema_keys:a.records.map(record=>record.section+'/'+record.key),scope:'Only actual generated schema and two CLI-selected names. Unknown/unobserved INI aliases are not invented or tested.'};save();
 console.log(JSON.stringify(state.precedence));
}else if(phase==='observe'){
 state.observation=await observePower(state);save();console.log(JSON.stringify(state.observation));
}else if(phase==='settings-roundtrip'){
 if((await observePower(state)).current_state!=='offline')throw Error('Native settings changes require offline');
 const url=endpoint()+'/game-settings?file=%2Fclone%2Fsettings.ini';
 const view=(await api(url)).attributes,expected=state.captures.baseline.records;
 const keys=expected.map(r=>r.section+'/'+r.key).sort();
 if(JSON.stringify(view.fields.map(f=>f.key).sort())!==JSON.stringify(keys))throw Error('Typed API does not expose exact generated14 fields');
 if(view.fields.filter(f=>f.secret).some(f=>f.value!==null)||view.fields.filter(f=>f.secret).length!==1)throw Error('Native Redis password protection mismatch');
 const before=await readFile('clone/settings.ini');if(hash(before)!==state.captures.baseline.sha256)throw Error('Restore baseline before scoped settings probe');
 const settings=Object.fromEntries(view.fields.filter(f=>!f.secret&&!f.readonly).map(f=>[f.key,String(f.value)]));
 if(!Object.hasOwn(settings,'online/maxplayers'))throw Error('Expected maxplayers native number is not editable');
 settings['online/maxplayers']='5';
 state.typed_attempt={at:new Date().toISOString(),fields:view.fields,before_sha256:hash(before),settings};save();
 await api(url,'PUT',{revision:view.revision,settings});
 const after=await readFile('clone/settings.ini');
 if(after.toString('utf8')!==before.toString('utf8').replace(/^(maxplayers\s*=\s*)4(?=\r?$)/m,'$15'))throw Error('Native editor changed unexpected bytes');
 const loaded=(await api(url)).attributes;
 if(String(loaded.fields.find(f=>f.key==='online/maxplayers').value)!=='5')throw Error('Typed reload mismatch');
 const stale=await fetch('http://127.0.0.1:18099'+url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:view.revision,settings:{'online/maxplayers':'6'}})});await stale.text();
 if(stale.status!==409||hash(await readFile('clone/settings.ini'))!==hash(after))throw Error('Stale revision was not safely rejected');
 state.typed_roundtrip={at:new Date().toISOString(),fields:view.fields,editable_nonsecret_fields:Object.keys(settings).length,before_sha256:hash(before),changed_sha256:hash(after),change:'Only online/maxplayers4to5; other editable non-secret generated fields resubmitted unchanged',secret_unchanged:true,stale_revision_status:stale.status};save();
 console.log(JSON.stringify({fields:view.fields.length,editable_nonsecret_fields:Object.keys(settings).length,byte_preservation:true,stale_revision_status:stale.status}));
}else if(phase==='settings-restore'){
 if((await observePower(state)).current_state!=='offline')throw Error('Offline typed probe required');
 const url=endpoint()+'/game-settings?file=%2Fclone%2Fsettings.ini',view=(await api(url)).attributes;
 const bytes=await readFile('clone/settings.ini'),baseline=fs.readFileSync(dir+'/baseline-settings.ini');
 if(bytes.toString('utf8')!==baseline.toString('utf8').replace(/^(maxplayers\s*=\s*)4(?=\r?$)/m,'$15'))throw Error('Only exact owned maxplayers4to5 delta may be restored');
 await api(url,'PUT',{revision:view.revision,settings:{'online/maxplayers':'4'}});
 const restored=hash(await readFile('clone/settings.ini'));if(restored!==state.captures.baseline.sha256)throw Error('Baseline native bytes not restored');
 state.typed_roundtrip??={};state.typed_roundtrip.restored_sha256=restored;save();console.log(JSON.stringify({restored:true,sha256:restored}));
}else if(phase==='settings-security'){
 if((await observePower(state)).current_state!=='offline')throw Error('Negative settings fixtures require offline');
 const url=endpoint()+'/game-settings?file=%2Fclone%2Fsettings.ini',view=(await api(url)).attributes,before=hash(await readFile('clone/settings.ini'));
 const outcomes=[];
 for(const value of ['5\ninjected=1','NaN']){
  const response=await fetch('http://127.0.0.1:18099'+url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:view.revision,settings:{'online/maxplayers':value}})});await response.text();
  const unchanged=hash(await readFile('clone/settings.ini'))===before;outcomes.push({case:value==='NaN'?'nonfinite-number':'newline-injection',status:response.status,unchanged});
  if(response.ok||!unchanged)throw Error('Unsafe native numeric input accepted or changed bytes');
 }
 state.settings_security={at:new Date().toISOString(),before_sha256:before,outcomes};save();console.log(JSON.stringify(state.settings_security));
}else if(phase==='permissions'){
 if((await observePower(state)).current_state!=='offline')throw Error('Offline permission fixture required');
 if(state.reader&&!state.reader.user_removed)throw Error('Existing reader fixture needs exact owned cleanup');
 state.reader=await createReaderFixture(state,reader=>{state.reader=reader;save();});
 const url=endpoint()+'/game-settings?file=%2Fclone%2Fsettings.ini',before=hash(await readFile('clone/settings.ini'));
 const response=await readerRequest(state.reader,url);const view=(await response.json()).attributes;
 if(response.status!==200||view.fields.length!==14||view.fields.some(f=>f.secret&&f.value!==null))throw Error('Nonadmin typed read/privacy mismatch');
 const cases=[['settings-write',url,'PUT',{revision:view.revision,settings:{'online/maxplayers':'6'}}],['startup-write',endpoint()+'/startup/variable','PUT',{key:'SERVER_DISPLAY_NAME',value:'Forbidden reader change'}],['power-start',endpoint()+'/power','POST',{signal:'start'}],['console-command',endpoint()+'/command','POST',{command:'forbidden reader command'}],['raw-file-write',endpoint()+'/files/write?file=%2Fclone%2Fsettings.ini','POST',{}]];
 state.permissions={at:new Date().toISOString(),identity_boundary:state.reader.identity_boundary,reader_read_status:200,typed_fields:14,secret_hidden:true,outcomes:[]};save();
 for(const [name,url,method,body]of cases){const r=await readerRequest(state.reader,url,method,body);await r.text();state.permissions.outcomes.push({name,status:r.status});save();if(r.status!==403)throw Error('Nonadmin forbidden action not403: '+name);}
 state.permissions.native_bytes_unchanged=hash(await readFile('clone/settings.ini'))===before;state.permissions.remains_offline=(await observePower(state)).current_state==='offline';save();
 if(!state.permissions.native_bytes_unchanged||!state.permissions.remains_offline)throw Error('Forbidden action changed owned server');
 await removeReaderFixture(state.reader,reader=>{state.reader=reader;save();});console.log(JSON.stringify(state.permissions));
}else if(phase==='unexpected-kill'){
 if((await observePower(state)).current_state!=='running')throw Error('Real ready game required before bounded child kill');
 const code="from pathlib import Path\nimport os,signal,json\nm=[]\nfor p in Path('/proc').iterdir():\n if not p.name.isdigit():continue\n try:\n  if (p/'exe').resolve()==Path('/home/container/clone/Server'):m.append(int(p.name))\n except OSError:pass\nassert len(m)==1,m\nprint(json.dumps({'native_namespace_pid':m[0],'signal':'SIGKILL','exe':'/home/container/clone/Server'}),flush=True)\nos.kill(m[0],signal.SIGKILL)";
 state.unexpected={at:new Date().toISOString(),container:JSON.parse(docker(['inspect',state.server.uuid]))[0].Id,scope:'Kill only exact native ELF child inside owned container namespace; no supervisor/container kill',observations:[]};save();
 state.unexpected.kill=JSON.parse(docker(['exec',state.server.uuid,'python3','-c',code]));save();
 const began=Date.now();while(Date.now()-began<15000){
  const owned=ownedContainers().filter(c=>c.Name==='/'+state.server.uuid).map(c=>({id:c.Id,state:c.State}));
  let resources;try{resources=await observePower(state);}catch(error){resources={error:String(error)};}
  state.unexpected.observations.push({at:new Date().toISOString(),containers:owned,resources});save();await sleep(1000);
 }
 const logs=docker(['logs',state.server.uuid]);fs.writeFileSync(dir+'/unexpected-native.log',logs);state.unexpected.final_resources=await observePower(state);save();console.log(JSON.stringify({kill:state.unexpected.kill,final:state.unexpected.final_resources,exit_observations:state.unexpected.observations.flatMap(x=>x.containers).filter(c=>!c.state.Running).map(c=>({id:c.id,exit:c.state.ExitCode,oom:c.state.OOMKilled}))}));
}else if(phase==='diagnostics-prepare'){
 if((await observePower(state)).current_state!=='offline')throw Error('Diagnostic startup requires offline fixture');
 const body=fs.readFileSync('tools/runtime/clonehero-parity-wave4-diagnostics.py');
 const response=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/write?file=%2F.voltra%2Fclonehero_diagnostics.py',{method:'POST',headers:{'Content-Type':'text/plain'},body});
 if(!response.ok)throw Error('Diagnostic file write failed: '+response.status);await response.text();
 if(hash(await readFile('.voltra/clonehero_diagnostics.py'))!==hash(body))throw Error('Diagnostic wrapper file differs');
 await api('/api/application/servers/'+state.server.id+'/startup','PATCH',{startup:'exec python3 .voltra/clonehero_diagnostics.py',environment:{}});
 state.diagnostics={at:new Date().toISOString(),wrapper_sha256:hash(body),startup:'exec python3 .voltra/clonehero_diagnostics.py',canonical_helpers_unchanged:true};save();console.log(JSON.stringify(state.diagnostics));
}else if(phase==='diagnostics-restore'){
 if((await observePower(state)).current_state!=='offline')throw Error('Startup restore requires offline fixture');
 await api('/api/application/servers/'+state.server.id+'/startup','PATCH',{startup:profile.egg.startup,environment:{}});
 state.diagnostics.restored_startup=profile.egg.startup;save();console.log('Canonical startup restored; native exits retained in stop_history');
}else if(phase==='operator-seed'){
 if((await observePower(state)).current_state!=='offline')throw Error('Operator fixture needs offline server');
 const before=await readFile('clone/settings.ini'),comment='; Voltra operator comment retained across reinstall\n';
 if(before.includes(Buffer.from(comment)))throw Error('Operator fixture already seeded');
 const body=Buffer.concat([before,Buffer.from(comment)]);
 for(const [name,bytes]of[['clone/settings.ini',body],['clone/voltra-operator-retention.txt',Buffer.from('Operator-owned unknown file\r\nkeep punctuation ! # ;\r\n')]]){
  const response=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/write?file='+encodeURIComponent('/'+name),{method:'POST',headers:{'Content-Type':'text/plain'},body:bytes});
  if(!response.ok)throw Error('Owned operator seed failed: '+response.status);await response.text();
 }
 state.operator_seed={at:new Date().toISOString(),settings_before_sha256:hash(before),settings_after_sha256:hash(body),sidecar:'clone/voltra-operator-retention.txt'};save();console.log(JSON.stringify(state.operator_seed));
}else if(phase==='snapshot'){
 const tag=process.argv[3];if(!/^[a-z0-9_-]+$/.test(tag||''))throw Error('Explicit snapshot label required');
 if((await observePower(state)).current_state!=='offline'||ownedContainers().some(c=>c.State.Running))throw Error('Snapshot needs stopped fixture and installer');
 const wings=JSON.parse(fs.readFileSync('.local/game-parity-20261029/runtime/wings-private.json'));
 if(wings.system.data!=='/var/lib/voltra-parity-20261029/volumes'||!/^[a-f0-9-]{36}$/.test(state.server.uuid))throw Error('Exact campaign mount required');
 const code="from pathlib import Path\nimport hashlib,json,stat,os\nr=Path('/volume');p=r/'clone';out={}\nfor f in sorted(p.rglob('*')):\n if f.is_symlink():out[f.relative_to(r).as_posix()]={'link':os.readlink(f)};continue\n if not f.is_file():continue\n s=f.stat()\n with f.open('rb') as stream:h=hashlib.file_digest(stream,'sha256').hexdigest()\n out[f.relative_to(r).as_posix()]={'bytes':s.st_size,'sha256':h,'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid}\nprint(json.dumps(out))";
 const files=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--mount','type=bind,source='+wings.system.data+'/'+state.server.uuid+',target=/volume,readonly','python:3.12-slim','python','-B','-c',code]));
 state.snapshots??={};state.snapshots[tag]={at:new Date().toISOString(),files};save();fs.writeFileSync(dir+'/snapshot-'+tag+'.json',JSON.stringify(state.snapshots[tag],null,2)+'\n');console.log(JSON.stringify({tag,files:Object.keys(files).length}));
}else if(phase==='reinstall'){
 if(!process.argv.includes('--coordinator-handoff'))throw Error('Explicit serialized reinstall handoff required');
 if((await observePower(state)).current_state!=='offline'||!state.installer_slot_released)throw Error('Stopped fixture and released prior slot required');
 if(hash(profile.egg.scripts.installation.script)!==state.installer_body_sha256)throw Error('Active canonical installer changed since initial test; root review required');
 state.slot=acquireInstaller(state.lease.lease_id,owner);state.installer_slot_released=false;save();
 await api('/api/admin/eggs/'+state.egg.id+'/scripts','PATCH',{script_install:installerGate(profile.egg.scripts.installation.script,state.slot.token)});
 state.reinstall_request={at:new Date().toISOString(),slot:state.slot,installer_body_sha256:state.installer_body_sha256};save();
 await api('/api/application/servers/'+state.server.id+'/reinstall','POST',{});
 const gated=await waitNativeInstaller(state);state.reinstall_proof=gated.proof;save();
 for(const [args,name]of[[['logs','--follow',gated.container.Id],'reinstall.log'],[['wait',gated.container.Id],'reinstall-wait.txt']]){const fd=fs.openSync(dir+'/'+name,'a');const child=spawn('docker',['--context','desktop-linux',...args],{windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);child.on('error',error=>{state.reinstall_observer_error=error.message;save();});}
 releaseGate(gated.container,state.lease,state.slot.token);
 state.reinstall_outcome=await waitInstallOutcome(state);save();if(!state.reinstall_outcome.success)throw Error('Reinstall failed; preserve owned slot for review');
 releaseInstaller(state.slot);state.installer_slot_released=true;save();console.log(JSON.stringify({reinstalled:true,outcome:state.reinstall_outcome,slot_released:true}));
}else if(phase==='cleanup-finish'){
 const request=state.cleanup_request,uuid=state.server.uuid;
 if(!request||request.uuid!==uuid||request.server!==state.server.id||request.egg!==state.egg.id||request.nest!==state.nest.id||!/^[a-f0-9-]{36}$/.test(uuid))throw Error('Durable exact owned cleanup receipt required');
 const checks={containers:ownedContainers().length===0,allocations:!(await api('/api/application/nodes/1/allocations')).data.some(x=>request.allocations.includes(x.attributes.id)),reader_removed:state.reader?.user_removed===true&&state.reader?.subuser_removed===true};
 for(const [key,url]of[['server','/api/application/servers/'+request.server],['egg','/api/admin/eggs/'+request.egg],['nest','/api/admin/nests/'+request.nest]]){const response=await fetch('http://127.0.0.1:18099'+url);await response.text();checks[key]=response.status===404;}
 const wings=JSON.parse(fs.readFileSync('.local/game-parity-20261029/runtime/wings-private.json'));if(wings.system.data!=='/var/lib/voltra-parity-20261029/volumes')throw Error('Exact volume root required');
 docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--mount','type=bind,source='+wings.system.data+',target=/volumes,readonly','python:3.12-slim','python','-B','-c',`from pathlib import Path; p=Path('/volumes/${uuid}'); assert not p.exists() and not p.is_symlink()`]);checks.volume=true;
 state.cleanup={at:new Date().toISOString(),checks,outcome:'blocked',reason:'Native exercise complete; full player/alternate-version/unknown-domain acceptance is not claimed',completion_recovered_from:'Concurrent unrelated container disappeared from shared bulk inspection after owned resource deletion; exact absence proof resumed without repeat deletion'};save();
 if(!Object.values(checks).every(Boolean))throw Error('Owned cleanup absence checks incomplete');releaseNative(state.lease.lease_id,owner,'blocked',true);console.log(JSON.stringify(state.cleanup));
}else if(phase==='cleanup'){
 if(!state.server||!state.installer_slot_released)throw Error('Owned fixture and released installer required');
 const uuid=state.server.uuid;if(!/^[a-f0-9-]{36}$/.test(uuid))throw Error('Exact UUID required');
 const server=(await api('/api/application/servers/'+state.server.id)).attributes;
 const nest=(await api('/api/admin/nests/'+state.nest.id)).attributes,egg=(await api('/api/admin/eggs/'+state.egg.id)).attributes;
 if(server.uuid!==uuid||server.egg!==state.egg.id||nest.name!=='Clone Hero native schema probe'||egg.nest_id!==state.nest.id)throw Error('Owned fixture identity drift');
 if(ownedContainers().some(c=>c.State.Running))throw Error('Stop owned fixture before cleanup');
 state.cleanup_request={at:new Date().toISOString(),uuid,server:server.id,egg:egg.id,nest:nest.id,allocations:state.allocations.map(a=>a.id)};save();
 await api('/api/application/servers/'+state.server.id,'DELETE');
 for(const allocation of state.allocations){
  const current=(await api('/api/application/nodes/1/allocations')).data.map(x=>x.attributes).find(a=>a.id===allocation.id);
  if(!current||current.server_id!=null||current.port!==allocation.port||current.ip!=='127.0.0.1'||!state.lease.ports.includes(current.port))throw Error('Owned allocation drift');
  await api('/api/application/nodes/1/allocations/'+current.id,'DELETE');
 }
 await api('/api/admin/eggs/'+state.egg.id,'DELETE');await api('/api/admin/nests/'+state.nest.id,'DELETE');
 const checks={containers:ownedContainers().length===0,allocations:!(await api('/api/application/nodes/1/allocations')).data.some(x=>state.allocations.some(a=>a.id===x.attributes.id))};
 for(const [key,url]of[['server','/api/application/servers/'+state.server.id],['egg','/api/admin/eggs/'+state.egg.id],['nest','/api/admin/nests/'+state.nest.id]]){const response=await fetch('http://127.0.0.1:18099'+url);await response.text();checks[key]=response.status===404;}
 const wings=JSON.parse(fs.readFileSync('.local/game-parity-20261029/runtime/wings-private.json'));
 if(wings.system.data!=='/var/lib/voltra-parity-20261029/volumes')throw Error('Campaign volume root drift');
 docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--mount','type=bind,source='+wings.system.data+',target=/volumes,readonly','python:3.12-slim','python','-B','-c',`from pathlib import Path; p=Path('/volumes/${uuid}'); assert not p.exists() and not p.is_symlink()`]);checks.volume=true;
 state.cleanup={at:new Date().toISOString(),checks,outcome:'blocked',reason:'Schema probe is partial evidence; five game gates not complete'};save();
 if(!Object.values(checks).every(Boolean))throw Error('Owned cleanup incomplete');
 releaseNative(state.lease.lease_id,owner,'blocked',true);console.log(JSON.stringify(state.cleanup));
}else throw Error('Use install --coordinator-handoff|start [label]|stop|cli-second|compare|observe|cleanup');
