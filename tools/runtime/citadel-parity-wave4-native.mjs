import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {root,runtime,verifyRuntime,activeLease,acquireInstaller,releaseInstaller,releaseNative,profileFromRuntime,createNativeFixture,waitNativeInstaller,installerGate,releaseGate,api,observePower,containers} from './campaign-native-20261029.mjs';

// Explicit one-step commands keep acquisition, gate release and power reviewable.
const dir=path.join(runtime,'citadel-wave4');
const artifact=path.join(root,'artifacts/game-parity-20261029');
const recipe='citadel/egg-citadel-forged-with-fire.json';
const statePath=path.join(dir,'state.json');
const read=p=>JSON.parse(fs.readFileSync(p));
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');
function lease(){const l=read(path.join(artifact,'citadel-wave4-native-lease.json'));activeLease(l.lease_id,'citadel_native');if(l.game!==recipe||l.ports[1]!==27015)throw Error('Exact Citadel lease required');return l;}
async function owned(){await verifyRuntime();const s=read(statePath),l=lease();if(s.lease.lease_id!==l.lease_id)throw Error('Fixture lease mismatch');const a=(await api('/api/application/servers/'+s.server.id)).attributes;if(a.uuid!==s.server.uuid||a.egg!==s.egg.id||a.node!==1)throw Error('Owned fixture identity mismatch');return s;}
const command=process.argv[2];
if(command==='create'){
 await verifyRuntime();if(fs.existsSync(statePath))throw Error('Existing state: inspect same fixture');
 const l=lease(),slot=acquireInstaller(l.lease_id,l.owner);fs.mkdirSync(dir,{recursive:true});write(path.join(dir,'slot.json'),slot);
 const secret=crypto.randomBytes(20).toString('hex');write(path.join(dir,'credentials.json'),{test_password:secret});
 const receipt=await verifyRuntime(),profile=profileFromRuntime(recipe,receipt);
 const s=await createNativeFixture({lease:l,slot,profile,environment:{ADMIN_PASSWD:secret},name:'Campaign Citadel wave4',onStep:s=>write(statePath,s)});
 console.log(JSON.stringify({created:true,uuid:s.server.uuid,lease:l.lease_id,ports:l.ports}));
}else if(command==='prove'){
 const s=await owned(),p=await waitNativeInstaller(s,{timeoutMs:30000});write(path.join(dir,'installer-proof.json'),p.proof);console.log(JSON.stringify(p.proof));
}else if(command==='reinstall'){
 const s=await owned();if((await observePower(s)).current_state!=='offline'||containers().some(c=>c.Name.includes(s.server.uuid)&&c.State.Running))throw Error('Stopped owned fixture required');
 if(!fs.existsSync(path.join(dir,'installer-released.json')))throw Error('Previous installer slot not released');
 const profile=profileFromRuntime(s.recipe,s.runtime),script=profile.egg.scripts.installation.script;if(crypto.createHash('sha256').update(script).digest('hex')!==s.installer_body_sha256)throw Error('Original frozen installer body drift');
 const slot=acquireInstaller(s.lease.lease_id,s.lease.owner);write(path.join(dir,'reinstall-slot-'+Date.now()+'.json'),slot);s.slot=slot;write(statePath,s);
 await api('/api/admin/eggs/'+s.egg.id+'/scripts','PATCH',{script_install:installerGate(script,slot.token)});
 fs.unlinkSync(path.join(dir,'installer-released.json'));write(path.join(dir,'reinstall-request-'+Date.now()+'.json'),{at:new Date().toISOString(),uuid:s.server.uuid,installer_body_sha256:s.installer_body_sha256});
 await api('/api/application/servers/'+s.server.id+'/reinstall','POST',{});console.log('Owned exact-original installer requeued behind a fresh resource gate');
}else if(command==='release-gate'){
 const s=await owned(),p=await waitNativeInstaller(s,{timeoutMs:30000});releaseGate(p.container,s.lease,s.slot.token);write(path.join(dir,'gate-released.json'),{at:new Date().toISOString(),proof:p.proof});console.log('Owned installer resource gate released');
}else if(command==='status'){
 const s=await owned(),a=(await api('/api/application/servers/'+s.server.id)).attributes;
 const own=containers().filter(c=>c.Name.includes(s.server.uuid)).map(c=>({id:c.Id,name:c.Name,state:c.State,memory:c.HostConfig.Memory,memory_swap:c.HostConfig.MemorySwap,cpu_period:c.HostConfig.CpuPeriod,cpu_quota:c.HostConfig.CpuQuota}));
 const power=a.status==='installing'?{unavailable:'Server is installing; client resources correctly returns409'}:await observePower(s);
 const result={at:new Date().toISOString(),uuid:a.uuid,status:a.status,installed:a.container?.installed,power,containers:own};write(path.join(dir,'status.json'),result);console.log(JSON.stringify(result));
}else if(command==='power'){
 const s=await owned(),signal=process.argv[3];if(!['start','stop','restart'].includes(signal))throw Error('Explicit supported power action required');
 const observationMs=process.argv[4]===undefined?25000:Number(process.argv[4]);if(!Number.isSafeInteger(observationMs)||observationMs<1000||observationMs>30000)throw Error('Observation must be bounded1000..30000ms');
 if(signal==='start'&&!fs.existsSync(path.join(dir,'gate-released.json')))throw Error('Installer gate receipt required');
 const secret=read(path.join(dir,'credentials.json')).test_password;
 const auth=(await api('/api/client/servers/'+s.server.uuid+'/websocket')).data;
 const socket=new WebSocket(auth.socket),events=[],tag=Date.now(),stream=fs.createWriteStream(path.join(dir,'console-'+tag+'.jsonl'),{flags:'wx'});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Console authentication timed out')),10000);socket.addEventListener('open',()=>socket.send(JSON.stringify({event:'auth',args:[auth.token]})));socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Console connection failed'));});socket.addEventListener('message',m=>{const e=JSON.parse(String(m.data));if(e.event==='auth success'){clearTimeout(timer);resolve();}if(['console output','status','install output','install completed'].includes(e.event)){const safe={at:new Date().toISOString(),event:e.event,args:e.args?.map(x=>String(x).replaceAll(secret,'[REDACTED]'))};events.push(safe);stream.write(JSON.stringify(safe)+'\n');}});});
  const evidence={at:new Date().toISOString(),signal,before:await observePower(s),console_authenticated:true};write(path.join(dir,'power-'+tag+'.json'),evidence);
  await api('/api/client/servers/'+s.server.uuid+'/power','POST',{signal});await new Promise(r=>setTimeout(r,observationMs));
  evidence.after=await observePower(s);evidence.status_events=events.filter(e=>e.event==='status');evidence.console_lines=events.filter(e=>e.event==='console output').length;write(path.join(dir,'power-'+tag+'.json'),evidence);console.log(JSON.stringify(evidence));
 }finally{socket.close();stream.end();}
}else if(command==='logs'){
 const s=await owned(),secret=read(path.join(dir,'credentials.json')).test_password;const own=containers().filter(c=>c.Name.includes(s.server.uuid));const out=[];
 for(const c of own){const r=spawnSync('docker',['--context','desktop-linux','logs','--tail','1600',c.Id],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024**2});if(r.status)throw Error('Owned container log read failed');const logs=(r.stdout+r.stderr).replaceAll(secret,'[REDACTED]');fs.writeFileSync(path.join(dir,c.Name.includes('installer')?'installer.log':'native.log'),logs);out.push({name:c.Name,bytes:logs.length,ready:logs.includes('Steam Server initialized and registered with UWorks'),exit:c.State.ExitCode,oom:c.State.OOMKilled});}console.log(JSON.stringify(out));
}else if(command==='settings'){
 const s=await owned(),result=await api('/api/client/servers/'+s.server.uuid+'/game-settings?file=%2FConfig%2FGame.ini');write(path.join(dir,'settings.json'),result);console.log(JSON.stringify(result));
}else if(command==='settings-edit'){
 const s=await owned(),endpoint='/api/client/servers/'+s.server.uuid+'/game-settings?file=%2FConfig%2FGame.ini';
 const changes=JSON.parse(['@planned','planned'].includes(process.argv[3])?fs.readFileSync(path.join(dir,'planned-settings.json')):process.argv[3]||'{}');if(!Object.keys(changes).length)throw Error('Explicit typed changes required');
 const rawurl='http://127.0.0.1:18099/api/client/servers/'+s.server.uuid+'/files/contents?file=%2FConfig%2FGame.ini';
 const first=await fetch(rawurl);if(!first.ok)throw Error('Native before read failed');const rawBefore=await first.text();
 const before=await api(endpoint),result=await api(endpoint,'PUT',{revision:before.attributes.revision,settings:changes}),after=await api(endpoint);
 const last=await fetch(rawurl);if(!last.ok)throw Error('Native after read failed');const rawAfter=await last.text(),tag=Date.now();fs.writeFileSync(path.join(dir,'settings-before-'+tag+'.ini'),rawBefore);fs.writeFileSync(path.join(dir,'settings-after-'+tag+'.ini'),rawAfter);
 const operatorSuffix='; Voltra operator comment retained byte for byte\n[VoltraOperatorRetention]\nUnknownText=keep exact spaces and punctuation ! # ;\n';const unknown_preserved=!rawBefore.includes(operatorSuffix)||rawAfter.includes(operatorSuffix);
 write(path.join(dir,'settings-roundtrip-'+tag+'.json'),{at:new Date().toISOString(),changes,before,result,after,unknown_preserved});if(!unknown_preserved)throw Error('Operator bytes changed');console.log(JSON.stringify({saved:true,changes,unknown_preserved,field_count:after.attributes.fields.length}));
}else if(command==='settings-guards'){
 const s=await owned(),base='/api/client/servers/'+s.server.uuid+'/game-settings',endpoint=base+'?file=%2FConfig%2FGame.ini',before=await api(endpoint),power=await observePower(s),checks=[];
 const requests=power.current_state==='offline'?[{name:'managed queryport',url:endpoint,settings:{'UWorks/QueryPort':'29999'},expect:422},{name:'managed queryport case alias',url:endpoint,settings:{'uwORks/QueryPORT':'29999'},expect:422},{name:'managed admin secret',url:endpoint,settings:{'/Script/Citadel.SocialManager/Password':'rejected-fixture-value'},expect:422},{name:'managed admin case alias',url:endpoint,settings:{'/script/citadel.socialmanager/password':'rejected-fixture-value'},expect:422},{name:'tuple injection',url:endpoint,settings:{'/Script/Citadel.CitadelGameInstance/WorldCreationSettings/ServerName':'bad\nInjected=true'},expect:422},{name:'traversal',url:base+'?file=%2FConfig%2F..%2FGame.ini',settings:{x:'bad'},expect:404},{name:'document case alias',url:base+'?file=%2Fconfig%2Fgame.ini',settings:{x:'bad'},expect:404}]:[{name:'running setting edit',url:endpoint,settings:{'/Script/Citadel.CitadelGameInstance/WorldCreationSettings/PlayerLimit':'21'},expect:409}];
 for(const q of requests){const response=await fetch('http://127.0.0.1:18099'+q.url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:before.attributes.revision,settings:q.settings})});const body=await response.json();checks.push({name:q.name,status:response.status,expected:q.expect,pass:response.status===q.expect,errors:body.errors});}
 const after=await api(endpoint),result={at:new Date().toISOString(),power:power.current_state,checks,revision_unchanged:before.attributes.revision===after.attributes.revision};write(path.join(dir,'settings-guards-'+Date.now()+'.json'),result);console.log(JSON.stringify(result));if(!result.revision_unchanged||checks.some(c=>!c.pass))throw Error('Native settings guard regression');
}else if(command==='seed-operator'){
 const s=await owned();if((await observePower(s)).current_state!=='offline')throw Error('Stop fixture first');
 const base='http://127.0.0.1:18099/api/client/servers/'+s.server.uuid+'/files',file='%2FConfig%2FGame.ini';
 const response=await fetch(base+'/contents?file='+file);if(!response.ok)throw Error('Owned native file read failed');const before=await response.text();
 if(before.includes('VoltraOperatorRetention'))throw Error('Operator fixture already seeded');
 const after=before+'\n; Voltra operator comment retained byte for byte\n[VoltraOperatorRetention]\nUnknownText=keep exact spaces and punctuation ! # ;\n';
 for(const [target,body]of[[file,after],['%2FConfig%2Foperator-retention.txt','operator sidecar\r\nuntouched bytes\r\n']]){const r=await fetch(base+'/write?file='+target,{method:'POST',headers:{'Content-Type':'text/plain'},body});if(!r.ok)throw Error('Owned operator fixture write failed: '+r.status);await r.text();}
 write(path.join(dir,'operator-seed.json'),{at:new Date().toISOString(),before_sha256:crypto.createHash('sha256').update(before).digest('hex'),after_sha256:crypto.createHash('sha256').update(after).digest('hex')});console.log('Scoped operator unknown section/comment and sidecar seeded via real file API');
}else if(command==='config-proof'){
 const s=await owned(),files={},checks=[];for(const file of['/Config/Game.ini','/Citadel/Saved/Config/LinuxServer/Game.ini','/Engine/Saved/Config/LinuxServer/Game.ini']){
 const response=await fetch('http://127.0.0.1:18099/api/client/servers/'+s.server.uuid+'/files/contents?file='+encodeURIComponent(file));if(!response.ok)throw Error('Native config read failed: '+file);const raw=await response.text();files[file]={sha256:crypto.createHash('sha256').update(raw).digest('hex'),bytes:Buffer.byteLength(raw)};
 checks.push({file,name:raw.includes('ServerName="Voltra Citadel parity"'),players:/PlayerLimit=8[,)]/.test(raw),experience:/ExperienceMultiplier=1\.25[,)]/.test(raw),boolean:/bThronesDecay=false[,)]/i.test(raw),unknown:raw.includes('UnknownText=keep exact spaces and punctuation ! # ;')});}
 const sidecar=await fetch('http://127.0.0.1:18099/api/client/servers/'+s.server.uuid+'/files/contents?file=%2FConfig%2Foperator-retention.txt');const sidecar_exact=sidecar.ok&&(await sidecar.text())==='operator sidecar\r\nuntouched bytes\r\n';const result={at:new Date().toISOString(),files,checks,sidecar_exact,scope:'Only the managed tuple/ports/admin are mirrored; unknown primary sections stay in primary, preserving each mirror unknown contents.'};write(path.join(dir,'config-proof-'+Date.now()+'.json'),result);console.log(JSON.stringify(result));if(!sidecar_exact||checks.some(c=>!c.name||!c.players||!c.experience||!c.boolean||(c.file==='/Config/Game.ini'&&!c.unknown)))throw Error('Native config mirroring/retention failed');
}else if(command==='fault-config'||command==='restore-config'){
 const s=await owned();if((await observePower(s)).current_state!=='offline')throw Error('Owned fixture must be offline');const backup=path.join(dir,'before-fault.ini'),base='http://127.0.0.1:18099/api/client/servers/'+s.server.uuid+'/files';const response=await fetch(base+'/contents?file=%2FConfig%2FGame.ini');if(!response.ok)throw Error('Owned config read failed');const current=await response.text();let desired;
 if(command==='fault-config'){if(fs.existsSync(backup))throw Error('Fault already armed; inspect existing exact backup');fs.writeFileSync(backup,current,{flag:'wx'});desired=current+'\n; VOLTRA_PREFLIGHT_REFUSAL_FIXTURE\n[/Script/Citadel.CitadelGameInstance]\nWorldCreationSettings=(ServerName="Rejected duplicate")\n';}
 else{desired=fs.readFileSync(backup,'utf8');if(!current.includes('VOLTRA_PREFLIGHT_REFUSAL_FIXTURE'))throw Error('Expected owned refusal marker missing');}
 const changed=await fetch(base+'/write?file=%2FConfig%2FGame.ini',{method:'POST',headers:{'Content-Type':'text/plain'},body:desired});await changed.text();if(!changed.ok)throw Error('Owned fault/restore failed');const reread=await fetch(base+'/contents?file=%2FConfig%2FGame.ini');if(!reread.ok||(await reread.text())!==desired)throw Error('Owned config exact readback failed');write(path.join(dir,command+'.json'),{at:new Date().toISOString(),before_sha256:crypto.createHash('sha256').update(current).digest('hex'),after_sha256:crypto.createHash('sha256').update(desired).digest('hex'),bytes:Buffer.byteLength(desired)});console.log(JSON.stringify({command,exact_readback:true}));
}else if(command==='compare-snapshots'){
 const before=process.argv[3],after=process.argv[4];if(![before,after].every(t=>/^[a-z0-9_-]+$/.test(t||'')))throw Error('Two explicit snapshot tags required');const left=read(path.join(dir,'snapshot-'+before+'.json')),right=read(path.join(dir,'snapshot-'+after+'.json'));if(left.uuid!==right.uuid)throw Error('Snapshot identity mismatch');const differences=Object.keys(left.files).filter(k=>JSON.stringify(left.files[k])!==JSON.stringify(right.files[k])),added=Object.keys(right.files).filter(k=>!left.files[k]);const result={at:new Date().toISOString(),before,after,existing_rows:Object.keys(left.files).length,unchanged:differences.length===0,differences,added};write(path.join(dir,'comparison-'+before+'-'+after+'.json'),result);console.log(JSON.stringify(result));if(differences.length)process.exitCode=1;
}else if(command==='snapshot'){
 const s=await owned(),tag=process.argv[3];if(!/^[a-z0-9_-]+$/.test(tag||''))throw Error('Explicit snapshot tag required');
 if(containers().some(c=>c.Name.includes(s.server.uuid)&&c.State.Running))throw Error('Snapshot requires owned fixture and installer stopped');
 const w=read(path.join(runtime,'wings-private.json')),volume=w.system.data+'/'+s.server.uuid;if(!/^[a-f0-9-]{36}$/.test(s.server.uuid)||w.system.data!=='/var/lib/voltra-parity-20261029/volumes')throw Error('Exact campaign mount required');
 const code=`from pathlib import Path\nimport json,hashlib,stat,os\nr=Path('/volume');out={}\nfor relative in ('Config','Citadel/Saved','Engine/Saved','Mods','Citadel/Mods','.voltra/fantasy-worlds/citadel-sdk.json'):\n p=r/relative\n for f in ([p,*p.rglob('*')] if p.is_dir() else [p]):\n  if f.is_symlink():out[f.relative_to(r).as_posix()]={'link':os.readlink(f)};continue\n  if not f.is_file():continue\n  st=f.stat()\n  with f.open('rb') as source:digest=hashlib.file_digest(source,'sha256').hexdigest()\n  out[f.relative_to(r).as_posix()]={'bytes':st.st_size,'sha256':digest,'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid}\nprint(json.dumps(out))`;
 const p=spawnSync('docker',['--context','desktop-linux','run','--rm','--pull','never','--network','none','--read-only','--user','988:988','--memory','256m','--memory-swap','256m','--cpus','1','--cap-drop','ALL','--security-opt','no-new-privileges','--mount',`type=bind,source=${volume},target=/volume,readonly`,'python:3.12-slim','python','-B','-c',code],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024**2});if(p.status)throw Error('Bounded owned snapshot failed: '+p.stderr.slice(0,300));const files=JSON.parse(p.stdout);write(path.join(dir,'snapshot-'+tag+'.json'),{at:new Date().toISOString(),uuid:s.server.uuid,files});console.log(JSON.stringify({files:Object.keys(files).length,tag}));
}else if(command==='installer-release'){
 const s=await owned(),a=(await api('/api/application/servers/'+s.server.id)).attributes;if(a.status==='installing')throw Error('Installer still pending');releaseInstaller(s.slot);write(path.join(dir,'installer-released.json'),{at:new Date().toISOString(),status:a.status,installed:a.container?.installed});console.log('Owned installer slot released');
}else if(command==='cleanup'){
 const s=await owned();if(!fs.existsSync(path.join(dir,'installer-released.json')))throw Error('Release owned installer slot first');
 if(containers().some(c=>c.Name.includes(s.server.uuid)&&c.State.Running))throw Error('Owned runtime still active');
 const nest=(await api('/api/admin/nests/'+s.nest.id)).attributes,egg=(await api('/api/admin/eggs/'+s.egg.id)).attributes;
 if(nest.name!=='Campaign Citadel wave4'||egg.nest_id!==s.nest.id)throw Error('Temporary fixture definitions drifted');
 write(path.join(dir,'cleanup-request.json'),{at:new Date().toISOString(),uuid:s.server.uuid,server:s.server.id,egg:s.egg.id,nest:s.nest.id,allocations:s.allocations.map(a=>a.id)});
 await api('/api/application/servers/'+s.server.id,'DELETE');
 for(const allocated of s.allocations){const a=(await api('/api/application/nodes/1/allocations')).data.map(x=>x.attributes).find(a=>a.id===allocated.id);if(!a||a.server_id!=null||a.port!==allocated.port||a.ip!=='127.0.0.1')throw Error('Owned allocation drift');await api('/api/application/nodes/1/allocations/'+a.id,'DELETE');}
 await api('/api/admin/eggs/'+s.egg.id,'DELETE');await api('/api/admin/nests/'+s.nest.id,'DELETE');
 const checks={containers:!containers().some(c=>c.Name.includes(s.server.uuid)),allocations:!(await api('/api/application/nodes/1/allocations')).data.some(x=>s.allocations.some(a=>a.id===x.attributes.id))};
 for(const [key,url]of[['server','/api/application/servers/'+s.server.id],['egg','/api/admin/eggs/'+s.egg.id],['nest','/api/admin/nests/'+s.nest.id]]){const r=await fetch('http://127.0.0.1:18099'+url);await r.text();checks[key]=r.status===404;}
 const code=`from pathlib import Path; assert not Path('/volumes/${s.server.uuid}').exists();print('absent')`;
 const p=spawnSync('docker',['--context','desktop-linux','run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--mount','type=bind,source=/var/lib/voltra-parity-20261029/volumes,target=/volumes,readonly','python:3.12-slim','python','-B','-c',code],{encoding:'utf8',windowsHide:true,timeout:20000});checks.volume=p.status===0;
 const outcome=process.argv[3]||'blocked';if(!['tested','blocked'].includes(outcome))throw Error('Explicit tested/blocked cleanup outcome required');
 write(path.join(dir,'cleanup.json'),{at:new Date().toISOString(),uuid:s.server.uuid,checks,outcome});if(!Object.values(checks).every(Boolean))throw Error('Owned cleanup incomplete');releaseNative(s.lease.lease_id,s.lease.owner,outcome,true);console.log(JSON.stringify({cleaned:true,checks,outcome}));
}else throw Error('Use create|prove|release-gate|status|power start/stop/restart|logs|settings');
