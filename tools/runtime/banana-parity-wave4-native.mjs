// Owned Banana native phases. Running this file without a phase is read-only.
// Installer execution requires the runtime coordinator's explicit handoff.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {
  runtime,api,docker,digest,verifyRuntime,profileFromRuntime,claimNative,
  activeLease,acquireInstaller,releaseInstaller,createNativeFixture,
  waitNativeInstaller,waitInstallOutcome,releaseGate,observePower,
  createReaderFixture,readerRequest,removeReaderFixture,
  releaseNative,
} from './campaign-native-20261029.mjs';

const recipe='banana_shooter/egg-banana-shooter.json',owner='banana_native_wave4';
const dir=path.join(runtime,'banana-wave4-native'),stateFile=path.join(dir,'state.json');
let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):{};
const save=()=>{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n');};
const owned=()=>activeLease(state.lease?.lease_id,owner);
const endpoint=()=>'/api/client/servers/'+state.fixture.server.uuid;
const settingsPath='/Servers/VoltraNative/Config.json';
async function raw(route,method='GET',body){const response=await fetch('http://127.0.0.1:18099'+route,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.text()};}
const settingsEndpoint=()=>endpoint()+'/game-settings?file='+encodeURIComponent(settingsPath);
async function nativeConfig(){const response=await raw(endpoint()+'/files/contents?file='+encodeURIComponent(settingsPath));if(response.status!==200)throw Error('Native config unavailable');return {bytes:response.body,json:JSON.parse(response.body)};}
async function activeProfile(){
  const receipt=await verifyRuntime(),profile=profileFromRuntime(recipe,receipt);
  const script=profile.egg.scripts.installation.script;
  if(!script.endsWith('python3 .voltra/light_games_next_install.py banana\n'))throw Error('Fresh suffix-fix activation required; do not create old fixture');
  const marker="cat > .voltra/banana_native_authority.py <<'VOLTRA_BANANA_AUTHORITY_WAVE4'\n";
  if(script.split(marker).length!==2)throw Error('Exactly one served Banana authority helper required');
  const body=script.split(marker)[1].split('VOLTRA_BANANA_AUTHORITY_WAVE4\n')[0];
  if(digest(body)!==digest(fs.readFileSync('internal/panel/game_library/scripts/banana-native-authority.py')))throw Error('Served authority differs from canonical helper');
  return {receipt,profile};
}
const phase=process.argv[2]||'plan';
if(phase==='plan'){
  const {receipt,profile}=await activeProfile();
  console.log(JSON.stringify({recipe,runtime_pid:receipt.pid,binary_sha256:receipt.binary_sha256,controls:profile.egg.variables.length,resources:{memory_mib:2048,disk_mib:8192,cpu:100,swap:0,ports:1},native_path:'/Servers/VoltraNative/Config.json',prerequisites:{steam_app:2406780,anonymous_entitlement:'Historical No subscription on 2026-10-23; current outcome not yet measured',private_credentials:'Not requested or supplied; private acquisition remains fail-closed',login_token:'Blank LAN only; public listing/player acceptance may require user-owned GSLT'},five_gates:'All native gates pending actual attempt; source suites do not promote them'}));
}else if(phase==='claim'){
  const current=await activeProfile();
  if(state.lease)owned();else state.lease=claimNative({game:recipe,owner,memory_mib:2048,disk_mib:8192,ports:1});
  state.runtime=current.receipt;save();console.log(JSON.stringify({lease:state.lease,source:state.runtime.binary_sha256}));
}else if(phase==='install'){
  owned();const current=await activeProfile();
  if(process.argv[3]!=='coordinator-handoff')throw Error('Explicit coordinator handoff argument required');
  if(state.fixture?.server)throw Error('Owned fixture exists; inspect rather than recreate');
  for(const image of [current.profile.egg.scripts.installation.container,...Object.values(current.profile.egg.docker_images)])docker(['image','inspect',image]);
  const image=JSON.parse(docker(['image','inspect',current.profile.egg.scripts.installation.container]))[0];
  if(image.Config.Entrypoint?.length)throw Error('Installer gate requires empty ENTRYPOINT');
  state.slot=acquireInstaller(state.lease.lease_id,owner);state.runtime=current.receipt;state.profile=current.profile;save();
  state.fixture=await createNativeFixture({lease:state.lease,slot:state.slot,profile:state.profile,environment:{SERVER:'VoltraNative',SERVER_NAME:'Voltra Banana Native',STEAM_USER:'',STEAM_PASS:'',STEAM_AUTH:'',STEAM_GSLT:''},name:'Campaign Banana native',onStep:async partial=>{state.fixture=partial;save();}});
  const {container,proof}=await waitNativeInstaller(state.fixture);
  state.installer={...proof,cgroup:docker(['exec',container.Id,'sh','-c','cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max']).trim()};save();
  const attempt=Date.now(),log=path.join(dir,`installer-${attempt}.log`),wait=path.join(dir,`installer-${attempt}.exit`),error=path.join(dir,`installer-${attempt}.stderr`);
  const logFd=fs.openSync(log,'a'),waitFd=fs.openSync(wait,'a'),errorFd=fs.openSync(error,'a');
  const logger=spawn('docker',['--context','desktop-linux','logs','--follow',container.Id],{detached:true,windowsHide:true,stdio:['ignore',logFd,logFd]});
  const waiter=spawn('docker',['--context','desktop-linux','wait',container.Id],{detached:true,windowsHide:true,stdio:['ignore',waitFd,errorFd]});
  logger.unref();waiter.unref();fs.closeSync(logFd);fs.closeSync(waitFd);fs.closeSync(errorFd);
  state.installer_capture={log,wait,error,log_pid:logger.pid,wait_pid:waiter.pid,attached_before_release:true};save();
  for(let n=0;n<20&&!fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE');n++)await new Promise(r=>setTimeout(r,100));
  if(!fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE'))throw Error('Resource gate not captured; remain closed');
  releaseGate(container,state.lease,state.slot.token);state.status='installing';save();
  console.log(JSON.stringify({uuid:state.fixture.server.uuid,proof:state.installer,status:state.status}));
}else if(phase==='installed'){
  owned();state.install_outcome=await waitInstallOutcome(state.fixture,{timeoutMs:55000});save();
  releaseInstaller(state.slot);state.slot_released=true;state.status=state.install_outcome.success?'installed':'install_failed';save();
  console.log(JSON.stringify(state.install_outcome));
}else if(phase==='installer-evidence'){
  owned();if(!state.install_outcome)throw Error('Terminal installer observation required');
  const capture=state.installer_capture;if(!capture?.attached_before_release)throw Error('Original installer capture unavailable');
  const logs=fs.readFileSync(capture.log,'utf8'),wait=fs.existsSync(capture.wait)?fs.readFileSync(capture.wait,'utf8').trim():'';
  if(!/^\d+$/.test(wait))throw Error('Actual terminal Docker wait code unavailable');
  const rootResponse=await raw(endpoint()+'/files/list?directory=%2F');
  let root=rootResponse.status===200?JSON.parse(rootResponse.body).data.map(entry=>entry.attributes):[];
  const steamapps=await raw(endpoint()+'/files/list?directory=%2Fsteamapps');
  let manifests=steamapps.status===200?JSON.parse(steamapps.body).data.map(entry=>entry.attributes):[];
  let payloadBoundary='Stopped file API';
  if(rootResponse.status===409&&state.install_outcome.success===false){
    const uuid=state.fixture.server.uuid;if(!/^[a-f0-9-]{36}$/.test(uuid))throw Error('Exact owned UUID required');
    const code="from pathlib import Path\nimport json\nroot=Path('/owned')\nprint(json.dumps({'root':[{'name':p.name} for p in root.iterdir()],'steamapps':[{'name':p.name} for p in (root/'steamapps').iterdir()] if (root/'steamapps').is_dir() else []}))";
    const image='sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704';
    const payload=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','128m','--memory-swap','128m','--cpus','1','--mount',`type=bind,source=/var/lib/voltra-parity-20261029/volumes/${uuid},target=/owned,readonly`,image,'python','-B','-c',code]));
    root=payload.root;manifests=payload.steamapps;payloadBoundary='Owned failed-install volume mounted read-only in bounded network-none helper; application file API remained409';
  }else if(rootResponse.status!==200)throw Error('Unexpected native payload inspection response');
  const proof={at:new Date().toISOString(),steam_app:2406780,anonymous:true,private_credentials_supplied:false,actual_exit_code:Number(wait),panel:state.install_outcome,resource_gate:logs.includes('CAMPAIGN_RESOURCE_GATE'),no_subscription:/Failed to install app ['"]?2406780['"]? \(No subscription\)/i.test(logs),login_failure:/Invalid Password|Account Logon Denied|Two-factor/i.test(logs),binary_present:root.some(entry=>entry.name==='BSDS.x86_64'),appmanifest_present:manifests.some(entry=>entry.name==='appmanifest_2406780.acf'),payload_boundary:payloadBoundary,file_api_status:rootResponse.status,installer_log_sha256:digest(logs)};
  proof.classification=proof.no_subscription&&!proof.panel.success&&!proof.binary_present&&!proof.appmanifest_present?'Publisher entitlement prerequisite: anonymous app2406780 denied; user-owned entitled Steam account required, private credential transport remains fail-closed':proof.panel.success?'Installation succeeded; native gates still require startup and acceptance':'Installer failure requires diagnosis; entitlement not established by current evidence';
  state.installer_evidence=proof;save();fs.writeFileSync('artifacts/game-parity-20261029/banana-wave4-native-installer.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
}else if(['start','stop','restart'].includes(phase)){
  owned();await activeProfile();
  if(!(await api('/api/application/servers/'+state.fixture.server.id)).attributes.container?.installed)throw Error('Completed native installation required');
  await api(endpoint()+'/power','POST',{signal:phase});state.actions??=[];state.actions.push({at:new Date().toISOString(),signal:phase});save();console.log(JSON.stringify(state.actions.at(-1)));
}else if(phase==='inspect'){
  owned();state.power=await observePower(state.fixture);
  state.server=(await api('/api/application/servers/'+state.fixture.server.id)).attributes;
  const ids=docker(['ps','-aq','--filter','name='+state.fixture.server.uuid]).trim().split(/\s+/).filter(Boolean);
  state.containers=ids.length?JSON.parse(docker(['inspect',...ids])).map(c=>({id:c.Id,name:c.Name,state:c.State,limits:{memory:c.HostConfig.Memory,memory_swap:c.HostConfig.MemorySwap,cpu_quota:c.HostConfig.CpuQuota,cpu_period:c.HostConfig.CpuPeriod,oom_disabled:c.HostConfig.OomKillDisable}})):[];
  save();console.log(JSON.stringify({power:state.power,installed:state.server.container?.installed,status:state.server.status,containers:state.containers}));
}else if(phase==='helpers'){
  owned();state.helper_proof=[];
  for(const match of state.profile.egg.scripts.installation.script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)){
    if(!match[1].endsWith('.py'))continue;
    const response=await raw(endpoint()+'/files/contents?file='+encodeURIComponent('/'+match[1]));
    const expected=digest(match[3]+'\n');
    if(response.status!==200||digest(response.body)!==expected)throw Error('Installed helper mismatch: '+match[1]);
    state.helper_proof.push({file:match[1],sha256:expected});save();
  }
  if(!state.helper_proof.some(h=>h.file==='.voltra/banana_native_authority.py'))throw Error('Authority proof missing');
  console.log(JSON.stringify(state.helper_proof));
}else if(phase==='settings'){
  owned();const config=await nativeConfig(),response=await raw(settingsEndpoint());
  if(response.status!==200)throw Error('Typed native settings unavailable');
  const view=JSON.parse(response.body).attributes;
  for(const key of ['/Server/Login_Token','/Server/STEAM_GSLT']){
    const field=view.fields.find(f=>f.key===key);
    if(field&&(!field.secret||field.value!=null))throw Error('Native credential field not masked');
  }
  const credentials=[config.json.Server?.Login_Token,config.json.Server?.STEAM_GSLT].filter(v=>typeof v==='string'&&v.length>0);
  if(credentials.some(value=>response.body.includes(value)))throw Error('Native credential exposed by settings API');
  state.settings={at:new Date().toISOString(),status:response.status,file:view.file,revision:view.revision,fields:view.fields.map(f=>({key:f.key,type:f.type,readonly:f.readonly,secret:f.secret})),config_sha256:digest(config.bytes),native_name:config.json.Browser?.Server_Name};save();
  console.log(JSON.stringify(state.settings));
}else if(phase==='edit-name'){
  owned();if((await observePower(state.fixture)).current_state!=='offline')throw Error('Stop before native settings edit');
  const before=await nativeConfig(),response=await raw(settingsEndpoint());if(response.status!==200)throw Error('Typed native settings unavailable');
  const view=JSON.parse(response.body).attributes,name='Voltra Native Roundtrip';
  const write=await raw(settingsEndpoint(),'PUT',{revision:view.revision,settings:{'/Browser/Server_Name':name}});
  if(write.status!==200)throw Error('Stopped native name edit rejected: '+write.status);
  const after=await nativeConfig();if(after.json.Browser?.Server_Name!==name)throw Error('Name edit did not reach native file');
  const originalName=before.json.Browser?.Server_Name;before.json.Browser.Server_Name=name;
  if(JSON.stringify(before.json)!==JSON.stringify(after.json))throw Error('Name edit changed unrelated native values');
  fs.writeFileSync(path.join(dir,'config-checkpoint.json'),after.bytes);
  state.preservation={at:new Date().toISOString(),native_name:name,original_name:originalName,sha256:digest(after.bytes),name_edit_only:true};save();console.log(JSON.stringify(state.preservation));
}else if(phase==='preserved'){
  owned();if(!state.preservation)throw Error('Native checkpoint required');
  const config=await nativeConfig(),check={at:new Date().toISOString(),exact:digest(config.bytes)===state.preservation.sha256,name:config.json.Browser?.Server_Name===state.preservation.native_name};
  state.preservation_checks??=[];state.preservation_checks.push(check);save();if(!check.exact||!check.name)throw Error('Native config changed across lifecycle');console.log(JSON.stringify(check));
}else if(phase==='permissions'){
  owned();const view=await raw(settingsEndpoint());if(view.status!==200)throw Error('Typed document required before permission test');
  if(state.reader&&!state.reader.user_removed)throw Error('Existing reader must be cleaned before replacement');
  state.reader=await createReaderFixture(state.fixture,async reader=>{state.reader=reader;save();});
  const read=await readerRequest(state.reader,settingsEndpoint());
  const write=await readerRequest(state.reader,settingsEndpoint(),'PUT',{revision:JSON.parse(view.body).attributes.revision,settings:{'/Browser/Server_Name':'Unauthorized'}});
  state.permission_proof={at:new Date().toISOString(),read:read.status,write:write.status,boundary:state.reader.identity_boundary};save();
  await removeReaderFixture(state.reader,async reader=>{state.reader=reader;save();});
  if(read.status!==200||write.status!==403)throw Error('Native reader permission enforcement failed');console.log(JSON.stringify(state.permission_proof));
}else if(phase==='observe'){
  owned();const expected=process.argv[3];if(!['running','offline'].includes(expected))throw Error('Specify running or offline');
  const began=Date.now();state.lifecycle??=[];
  while(Date.now()-began<50000){const observation=await observePower(state.fixture);state.lifecycle.push(observation);save();if(observation.current_state===expected){console.log(JSON.stringify(observation));process.exit(0);}await new Promise(r=>setTimeout(r,1000));}
  throw Error('Native lifecycle target not reached within50s; evidence retained');
}else if(phase==='logs'){
  owned();const ids=docker(['ps','-aq','--filter','name='+state.fixture.server.uuid]).trim().split(/\s+/).filter(Boolean);
  const containers=ids.length?JSON.parse(docker(['inspect',...ids])):[];
  const game=containers.find(c=>!c.Name.includes('installer')&&c.Name.replace(/^\//,'')===state.fixture.server.uuid);if(!game)throw Error('Owned game container absent');
  const logs=docker(['logs',game.Id]);let credentials=[];
  try{const config=await nativeConfig();credentials=[config.json.Server?.Login_Token,config.json.Server?.STEAM_GSLT].filter(v=>typeof v==='string'&&v.length>0);}catch(error){if(state.server?.container?.installed===1)throw error;}
  const leaks=credentials.some(value=>logs.includes(value));if(leaks)throw Error('Native token leaked into logs');
  fs.writeFileSync(path.join(dir,'native.log'),logs);
  state.log_proof={at:new Date().toISOString(),container:game.Id,readiness:logs.includes('Connect to steam server successfully'),secret_count:credentials.length,secrets_exposed:leaks,bytes:Buffer.byteLength(logs),ansi_escape:logs.includes('\u001b['),state:game.State};save();console.log(JSON.stringify(state.log_proof));
}else if(phase==='panel-console'){
  owned();const history=await api(endpoint()+'/console-history');
  fs.writeFileSync(path.join(dir,'panel-console.json'),JSON.stringify(history,null,2)+'\n');
  const lines=history.data.map(entry=>entry.line).join('\n');
  state.panel_console={at:new Date().toISOString(),capture:history.capture,lines:history.data.length,events:[...new Set(history.data.map(entry=>entry.event))],readiness:lines.includes('Connect to steam server successfully'),ansi_color:lines.includes('\u001b['),start:lines.includes('Starting server'),stop:lines.includes('Stopping server'),restart:lines.includes('Restarting server'),failure:/error|failed|crash/i.test(lines),more:history.more};save();console.log(JSON.stringify(state.panel_console));
}else if(phase==='crash'){
  owned();if((await observePower(state.fixture)).current_state!=='running')throw Error('Running native server required for controlled child-crash acceptance');
  const uuid=state.fixture.server.uuid,container=JSON.parse(docker(['inspect',uuid]))[0];
  if(container.Name!=='/'+uuid||!container.State.Running||container.HostConfig.NetworkMode!=='voltra-parity-20261029')throw Error('Owned campaign game identity mismatch');
  const code="import pathlib,os,signal,json\nmatches=[]\nfor process in pathlib.Path('/proc').iterdir():\n if not process.name.isdigit():continue\n try:args=(process/'cmdline').read_bytes().split(bytes([0]))\n except OSError:continue\n if args and args[0]==b'/home/container/BSDS.x86_64':matches.append(int(process.name))\nif len(matches)!=1:raise RuntimeError('Expected exactly one owned native Banana child')\nos.kill(matches[0],signal.SIGKILL)\nprint(json.dumps({'signal':'SIGKILL','child_pid':matches[0]}))";
  const proof=JSON.parse(docker(['exec',container.Id,'python3','-B','-c',code]));state.controlled_crash={at:new Date().toISOString(),...proof};save();console.log(JSON.stringify(state.controlled_crash));
}else if(phase==='cleanup'){
  owned();await verifyRuntime();const fixture=state.fixture,uuid=fixture?.server?.uuid;
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(uuid))throw Error('Exact owned UUID required');
  const ids=docker(['ps','-aq','--filter','name='+uuid]).trim().split(/\s+/).filter(Boolean);
  const existing=ids.length?JSON.parse(docker(['inspect',...ids])):[];
  if(existing.some(c=>c.State.Running))throw Error('Stop owned game and await installer terminal before cleanup');
  if(state.reader&&!state.reader.user_removed)await removeReaderFixture(state.reader,async reader=>{state.reader=reader;save();});
  if(!state.server_removed){
    const actual=(await api('/api/application/servers/'+fixture.server.id)).attributes;
    if(actual.uuid!==uuid||actual.egg!==fixture.egg.id||actual.node!==1)throw Error('Owned server identity mismatch');
    await api('/api/application/servers/'+fixture.server.id,'DELETE');state.server_removed=true;save();
  }
  state.allocations_removed??=[];
  for(const allocation of fixture.allocations){
    if(state.allocations_removed.includes(allocation.id))continue;
    const actual=(await api('/api/application/nodes/1/allocations')).data.map(v=>v.attributes).find(a=>a.id===allocation.id);
    if(!actual||actual.server_id!=null||actual.ip!=='127.0.0.1'||!state.lease.ports.includes(actual.port))throw Error('Owned allocation not safely unassigned');
    await api('/api/application/nodes/1/allocations/'+allocation.id,'DELETE');state.allocations_removed.push(allocation.id);save();
  }
  if(!state.egg_removed){const egg=(await api('/api/admin/eggs/'+fixture.egg.id)).attributes;if(egg.nest_id!==fixture.nest.id)throw Error('Owned egg/nest mismatch');await api('/api/admin/eggs/'+fixture.egg.id,'DELETE');state.egg_removed=true;save();}
  if(!state.nest_removed){const nest=(await api('/api/admin/nests/'+fixture.nest.id)).attributes;if(nest.name!=='Campaign Banana native')throw Error('Owned nest name mismatch');await api('/api/admin/nests/'+fixture.nest.id,'DELETE');state.nest_removed=true;save();}
  if(docker(['ps','-aq','--filter','name='+uuid]).trim())throw Error('Owned native containers remain after server deletion');
  const image='sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704';docker(['image','inspect',image]);
  const code=`from pathlib import Path\nimport json,shutil\nroot=Path('/campaign')\nuuid='${uuid}'\nremoved=[]\nfor category in ('volumes','tmp','machine-id'):\n parent=root/category\n target=parent/uuid\n if parent.is_symlink() or target.is_symlink():raise RuntimeError('Unexpected campaign cleanup symlink')\n if target.resolve().parent!=parent.resolve():raise RuntimeError('Cleanup escaped UUID parent')\n if target.exists():\n  if target.is_dir():shutil.rmtree(target)\n  else:target.unlink()\n removed.append({'category':category,'uuid':uuid,'absent':not target.exists()})\nprint(json.dumps(removed))`;
  state.filesystem_cleanup=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--memory','128m','--memory-swap','128m','--cpus','1','--mount','type=bind,source=/var/lib/voltra-parity-20261029,target=/campaign',image,'python','-B','-c',code]));save();
  if(!state.slot_released){releaseInstaller(state.slot);state.slot_released=true;save();}
  const outcome=state.install_outcome?.success?'tested':'blocked';state.lease=releaseNative(state.lease.lease_id,owner,outcome,true);state.lease_released=true;state.cleanup_at=new Date().toISOString();save();
  console.log(JSON.stringify({uuid,server_removed:true,egg_removed:true,nest_removed:true,allocations_removed:state.allocations_removed,filesystem:state.filesystem_cleanup,lease_outcome:outcome,native_completion:false}));
}else throw Error('Use plan|claim|install coordinator-handoff|installed|start|stop|restart|inspect|helpers|settings|edit-name|preserved|permissions|observe running|logs|cleanup.');
