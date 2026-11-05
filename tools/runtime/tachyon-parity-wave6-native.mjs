import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';
import {runtime,verifyRuntime,claimNative,activeLease,api,docker,profileFromRuntime,acquireInstaller,createNativeFixture,waitNativeInstaller,releaseGate,waitInstallOutcome,releaseInstaller,observePower,digest,installerGate} from './campaign-native-20261029.mjs';
const recipe='ftl_tachyon/egg-tachyon.json',owner='tachyon_native',dir=path.join(runtime,'tachyon-native');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'state.json'),s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
const save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n'),owned=()=>activeLease(s.lease.lease_id,owner),endpoint=()=>'/api/client/servers/'+s.fixture.server.uuid;
const phase=process.argv[2]||'plan';
if(phase==='plan'){
 s.plan={recipe,memory_mib:1024,disk_mib:4096,ports:1,publisher:'https://github.com/Davwyn/TachyonsCE/releases/tag/v1.0.2',pinned_archive_sha256:'516cc90196e1bc4c27ae2bf8fed01ad25730d9fbc92b23fc49ead0935dfb85ac',bytes:165409658,java8:'Reviewed Temurin1.8.0_504-b01 pinned shared Java installer',universe:'Publisher default100x100; never shrink below startcoords as a resource workaround',native_config:'/tachyon/config.cfg',no_steam:true};save();console.log(JSON.stringify(s.plan));
}else if(phase==='claim'){
 s.runtime=await verifyRuntime();if(s.lease)owned();else s.lease=claimNative({game:recipe,owner,memory_mib:1024,disk_mib:4096,ports:1});save();console.log(JSON.stringify(s.lease));
}else if(phase==='profile-proof'){
 owned();s.runtime=await verifyRuntime();s.profile=profileFromRuntime(recipe,s.runtime);
 if(s.profile.egg.startup!=='exec python3 .voltra/tachyon_preflight.py')throw Error('Wrong served startup');
 const native=fs.readFileSync('internal/panel/game_library/scripts/tachyon-preflight.py','utf8').replaceAll('\r\n','\n');
 const match=s.profile.egg.scripts.installation.script.match(/cat > \.voltra\/tachyon_preflight\.py <<'VOLTRA_TACHYON_PREFLIGHT'\n([\s\S]*?)\nVOLTRA_TACHYON_PREFLIGHT/);
 if(!match||match[1]!==native)throw Error('Served scoped helper differs from tested canonical');
 for(const image of [s.profile.egg.scripts.installation.container,...Object.values(s.profile.egg.docker_images)])docker(['image','inspect',image]);
 const options=(await api('/api/client/game-library/templates/'+digest(recipe).slice(0,16))).attributes;
 s.profile_proof={at:new Date().toISOString(),backend:s.runtime.binary_sha256,pid:s.runtime.pid,scoped_helper_sha256:digest(match[1]),variables:options.variables.map(v=>({key:v.env_variable,default_value:v.default_value,rules:v.rules})),memory_mib:s.profile.defaults.memory,disk_mib:s.profile.defaults.disk,images_exist:true};save();console.log(JSON.stringify(s.profile_proof));
}else if(phase==='install'){
 owned();s.runtime=await verifyRuntime();if(s.fixture?.server)throw Error('Existingfixture');
 s.profile=profileFromRuntime(recipe,s.runtime);if(s.profile.egg.startup!=='exec python3 .voltra/tachyon_preflight.py')throw Error('Root must serve the scoped preflight snapshot first');
 s.slot=acquireInstaller(s.lease.lease_id,owner);save();
 s.fixture=await createNativeFixture({lease:s.lease,slot:s.slot,profile:s.profile,name:'Campaign Tachyon native',onStep:async f=>{s.fixture=f;save();}});
 const {container,proof}=await waitNativeInstaller(s.fixture);s.installer={...proof,cgroup:docker(['exec',container.Id,'sh','-c','cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max'])};
 const attempt=Date.now(),log=path.join(dir,'installer-'+attempt+'.log'),wait=path.join(dir,'installer-'+attempt+'.exit'),errors=path.join(dir,'installer-'+attempt+'.stderr');
 const lf=fs.openSync(log,'a'),wf=fs.openSync(wait,'a'),ef=fs.openSync(errors,'a');
 const logger=spawn('docker',['--context','desktop-linux','logs','--follow',container.Id],{windowsHide:true,detached:true,stdio:['ignore',lf,lf]}),watch=spawn('docker',['--context','desktop-linux','wait',container.Id],{windowsHide:true,detached:true,stdio:['ignore',wf,ef]});logger.unref();watch.unref();fs.closeSync(lf);fs.closeSync(wf);fs.closeSync(ef);
 s.installer_capture={log,wait,errors,logger_pid:logger.pid,wait_pid:watch.pid,attached_before_gate:true};save();
 for(let n=0;n<20&&!fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE');n++)await new Promise(r=>setTimeout(r,100));
 if(!fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE'))throw Error('Gate capture missing');
 releaseGate(container,s.lease,s.slot.token);s.gate_released=true;save();console.log(JSON.stringify({uuid:s.fixture.server.uuid,installer:s.installer}));
}else if(phase==='installed'){
 owned();s.install_outcome=await waitInstallOutcome(s.fixture,{timeoutMs:600000});save();
 for(let n=0;n<50&&!fs.readFileSync(s.installer_capture.wait,'utf8').trim();n++)await new Promise(r=>setTimeout(r,100));
 s.installer_exit=fs.readFileSync(s.installer_capture.wait,'utf8').trim();save();releaseInstaller(s.slot);s.slot_released=true;save();console.log(JSON.stringify({outcome:s.install_outcome,actual_exit:s.installer_exit}));if(s.install_outcome.success&&s.installer_exit!=='0')throw Error('Successful callback lacks actual exit0');
}else if(phase==='start'||phase==='stop'||phase==='restart'){
 owned();await verifyRuntime();if(phase==='start'&&!s.install_outcome?.success)throw Error('Actual successful install required');
 if(phase==='start'){
  s.helpers=[];
  for(const m of s.profile.egg.scripts.installation.script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)){
   if(!m[1].endsWith('.py'))continue;
   const r=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/contents?file='+encodeURIComponent('/'+m[1]));if(!r.ok)throw Error('Missing installed helper');
   const actual=Buffer.from(await r.arrayBuffer()),sha256=digest(m[3]+'\n');if(digest(actual)!==sha256)throw Error('Installed helper differs from served canonical profile');s.helpers.push({file:m[1],sha256});
  }save();
 }else{
  const c=JSON.parse(docker(['inspect',s.fixture.server.uuid]))[0];if(!c.State.Running)throw Error('Expected running owned container');
  const wait=path.join(dir,phase+'-'+Date.now()+'.exit'),fd=fs.openSync(wait,'a'),watch=spawn('docker',['--context','desktop-linux','wait',c.Id],{windowsHide:true,detached:true,stdio:['ignore',fd,fd]});watch.unref();fs.closeSync(fd);s.power_waits??=[];s.power_waits.push({signal:phase,container:c.Id,wait,wait_pid:watch.pid});save();
 }
 await api(endpoint()+'/power','POST',{signal:phase});s.actions??=[];s.actions.push({at:new Date().toISOString(),signal:phase});save();console.log(phase+' requested');
}else if(phase==='inspect'){
 owned();s.observed_runtime=await verifyRuntime();s.power=await observePower(s.fixture);
 let c;try{c=JSON.parse(docker(['inspect',s.fixture.server.uuid]))[0];}catch{}
 if(c){s.native={id:c.Id,state:c.State,limits:{memory:c.HostConfig.Memory,swap:c.HostConfig.MemorySwap,cpu:c.HostConfig.CpuQuota,oom_disabled:c.HostConfig.OomKillDisable}};fs.writeFileSync(path.join(dir,'native-'+Date.now()+'.log'),docker(['logs',c.Id],true));}
 s.lifecycle??=[];s.lifecycle.push({at:new Date().toISOString(),power:s.power.current_state,native:s.native});save();console.log(JSON.stringify({power:s.power,native:s.native}));
}else if(phase==='command'){
 owned();const command=process.argv[3];if(!command)throw Error('Explicitnativecommand');await api(endpoint()+'/command','POST',{command});console.log('Native command submitted');
}else if(phase==='typed-roundtrip'){
 owned();s.typed_runtime=await verifyRuntime();if((await observePower(s.fixture)).current_state!=='offline')throw Error('Stop before native settings patch');
 const route=endpoint()+'/game-settings?file=%2Ftachyon%2Fconfig.cfg',before=await api(route),attrs=before.attributes;
 const flag=attrs.fields.find(f=>f.key==='ALLOW_SERVER_RESET');if(flag?.type!=='boolean')throw Error('Expected served Tachyon boolean metadata');
 const get=async()=>{const r=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/contents?file=%2Ftachyon%2Fconfig.cfg');if(!r.ok)throw Error('Native config read failed');return r.text();};
 const old=await get(),target=!flag.value;
 const changed=(await api(route,'PUT',{revision:attrs.revision,settings:{AUTOSAVE_TIME:'600',ALLOW_SERVER_RESET:target}})).attributes;
 const current=await get();
 const expected=old.replace(/(^AUTOSAVE_TIME=)[+]?\d+/m,(_all,p)=>p+'600').replace(/(^ALLOW_SERVER_RESET=)[+]?\d+/m,(_all,p)=>p+(target?'1':'0'));
 if(current!==expected)throw Error('Typed patch changed unrelated bytes');
 const stale=await fetch('http://127.0.0.1:18099'+route,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:attrs.revision,settings:{AUTOSAVE_TIME:'601'}})});
 if(stale.status!==409)throw Error('Stale revision not refused');
 const managed=await fetch('http://127.0.0.1:18099'+route,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:changed.revision,settings:{SERVER_PORT:'30303'}})});
 if(managed.status!==422)throw Error('Allocationowned port was writable');
 s.typed_roundtrip={at:new Date().toISOString(),AUTOSAVE_TIME:'600',ALLOW_SERVER_RESET:target,fields:changed.fields.map(f=>({key:f.key,type:f.type,readonly:f.readonly})),before_sha256:digest(old),after_sha256:digest(current),byte_span_exact:true,stale_status:stale.status,managed_status:managed.status};save();console.log(JSON.stringify(s.typed_roundtrip));
}else if(phase==='publisher-parser-probe'){
 owned();await verifyRuntime();const uuid=s.fixture.server.uuid,c=JSON.parse(docker(['inspect',uuid]))[0];if(!c.State.Running)throw Error('Running owned container needed for diagnostic');
 const cfg='/home/container/tachyon/config.cfg',base='/home/container/.voltra/tachyon-parser-proof';
 const before=docker(['exec',uuid,'sha256sum',cfg]).split(/\s/)[0];
 docker(['exec',uuid,'mkdir','-p',base]);docker(['exec',uuid,'cp',cfg,base+'/config.cfg']);
 const cls=path.join(dir,'probe-classes/TachyonConfigProbe.class');if(!fs.existsSync(cls))throw Error('Compile standalone probe first');
 docker(['cp',cls,uuid+':'+base+'/TachyonConfigProbe.class']);
 const output=docker(['exec','-w',base,uuid,'/home/container/.voltra/java8/bin/java','-Xmx64M','-Djava.awt.headless=true','-cp',base+':/home/container/tachyon/TachyonsCEServer.jar','TachyonConfigProbe']);
 const values=Object.fromEntries(output.split(/\r?\n/).filter(x=>x.startsWith('PUBLISHER_CONFIG_READBACK\t')).map(x=>x.split('\t').slice(1)));
 if(values.SERVER_PORT!==String(s.lease.ports[0])||s.typed_roundtrip&&(values.AUTOSAVE_TIME!=='600'||values.ALLOW_SERVER_RESET!==(s.typed_roundtrip.ALLOW_SERVER_RESET?'1':'0')))throw Error('Actual publisher configparser disagrees with typed native file');
 const after=docker(['exec',uuid,'sha256sum',cfg]).split(/\s/)[0];if(before!==after)throw Error('Diagnostic changed actual native config');
 s.publisher_parser_probe={at:new Date().toISOString(),values,actual_cfg_sha256:after,config_unchanged:true,publisher_jar_unchanged:true,boundary:'Separate64MiBJava process invokes unchanged publisher e.bi/e.bj on independent config copy. Not live-server-memory introspection.'};save();console.log(JSON.stringify(s.publisher_parser_probe));
}else if(phase==='receipt-proof'){
 owned();await verifyRuntime();
 const read=async file=>{const r=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/contents?file='+encodeURIComponent(file));if(!r.ok)throw Error('Missing native publisher receipt');return r.json();};
 const release=await read('/.voltra/small-games-family/tachyon-release.json'),java=await read('/.voltra/java-game/java8.json');
 if(release.sha256!=='516cc90196e1bc4c27ae2bf8fed01ad25730d9fbc92b23fc49ead0935dfb85ac'||release.binary_sha256!=='37a9ba0349ec7f300449c18aa277e9747bd8c580c1567d79b50058a07fcacc70'||java.sha256!=='52dcd578baca1d3e449ea86768a9129c0ee04d7b22565695498353cc66940c61')throw Error('Publisher receipt identity mismatch');
 s.publisher_receipts={at:new Date().toISOString(),release:{version:release.version,url:release.url,sha256:release.sha256,bytes:release.bytes,binary_sha256:release.binary_sha256,publisher_files:Object.keys(release.files).length,original_config_sha256:release.files['config.cfg']},java};save();console.log(JSON.stringify(s.publisher_receipts));
}else if(phase==='recovery-evidence'){
 owned();if(!s.controlled_crash||(await observePower(s.fixture)).current_state!=='running')throw Error('Recovered owned running server required');
 const logs=docker(['logs',s.fixture.server.uuid]);if(!logs.includes('[Server] Universe loaded')||!logs.includes('[Server] SERVER STARTED.')||!logs.includes('Network server started on port: '+s.lease.ports[0]))throw Error('Native persisted-universe recovery markers missing');
 const checks=[];for(const relative of ['tachyon/config.cfg','tachyon/voltra-parity-preserve.txt','tachyon/DataBase/Universe/Universe.map']){
  const expected=s.preservation.files.find(f=>f.file===relative);if(!expected)throw Error('Missing recovery baseline');
  const r=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/contents?file='+encodeURIComponent('/'+relative));if(!r.ok)throw Error('Recovery file missing');const sha256=digest(Buffer.from(await r.arrayBuffer()));checks.push({file:relative,sha256,exact:sha256===expected.sha256});
 }
 s.crash_recovery={at:new Date().toISOString(),persisted_universe_loaded:true,readiness:true,allocated_port:s.lease.ports[0],checks};save();console.log(JSON.stringify(s.crash_recovery));if(checks.some(x=>!x.exact))throw Error('Recovery changed checkpoint config/custom/universe map');
}else if(phase==='tcp-greeting'){
 owned();const received=[];const result=await new Promise(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port:s.lease.ports[0]});socket.setTimeout(2500);socket.on('data',b=>{received.push(b);socket.end();});socket.on('error',e=>resolve({error:e.code}));socket.on('timeout',()=>socket.destroy());socket.on('close',()=>resolve({hex:Buffer.concat(received).toString('hex'),bytes:Buffer.concat(received).length}));});
 s.protocol={at:new Date().toISOString(),kind:'Actual Kryonet initial TCP registration greeting from publisher server',...result,player_authenticated:false,gameplay:false};save();console.log(JSON.stringify(s.protocol));if(result.error||result.bytes<6)throw Error('Native registration greeting missing');
}else if(phase==='preservation-baseline'||phase==='verify-preservation'){
 owned();if((await observePower(s.fixture)).current_state!=='offline')throw Error('Stop before exact persisted-file snapshot');
 const server=(await api('/api/application/servers/'+s.fixture.server.id)).attributes;if(server.uuid!==s.fixture.server.uuid||server.egg!==s.fixture.egg.id)throw Error('Foreign fixture');
 let source;try{source=JSON.parse(docker(['inspect',s.fixture.server.uuid]))[0].Mounts.find(m=>m.Destination==='/home/container')?.Source;}catch{source=s.preservation?.volume_source;}
 if(source!=='/var/lib/voltra-parity-20261029/volumes/'+s.fixture.server.uuid)throw Error('Foreign volume');
 if(phase==='preservation-baseline'){
  const r=await fetch('http://127.0.0.1:18099'+endpoint()+'/files/write?file=%2Ftachyon%2Fvoltra-parity-preserve.txt',{method:'POST',headers:{'Content-Type':'text/plain'},body:'Tachyon operator file preservation fixture.\n'});if(!r.ok)throw Error('Custom file write failed');
 }
 const code="import pathlib,hashlib,json;root=pathlib.Path('/game');paths=[root/'tachyon/config.cfg',root/'tachyon/voltra-parity-preserve.txt']+sorted((root/'tachyon/DataBase').rglob('*'));out=[]\nfor p in paths:\n if not p.is_file():continue\n assert not p.is_symlink();s=p.stat();out.append({'file':str(p.relative_to(root)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'mode':s.st_mode&511,'uid':s.st_uid,'gid':s.st_gid})\nassert len(out)>3;print(json.dumps(out))";
 const files=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','128m','--memory-swap','128m','--cpus','1','--mount',`type=bind,source=${source},target=/game,readonly`,'python:3.12-slim','python3','-B','-c',code]));
 if(phase==='preservation-baseline'){s.preservation={at:new Date().toISOString(),volume_source:source,files};save();console.log(JSON.stringify({files:files.length,baseline:true}));}
 else{s.preservation_checks??=[];const exact=JSON.stringify(files)===JSON.stringify(s.preservation.files);s.preservation_checks.push({at:new Date().toISOString(),files:files.length,exact});save();console.log(JSON.stringify({files:files.length,exact}));if(!exact)throw Error('Persisted config/world/custom bytes or metadata changed');}
}else if(phase==='reinstall'){
 owned();s.reinstall_runtime=await verifyRuntime();if((await observePower(s.fixture)).current_state!=='offline'||!s.preservation)throw Error('Stopped preservation baseline required');
 s.slot=acquireInstaller(s.lease.lease_id,owner);s.slot_released=false;s.reinstall={at:new Date().toISOString(),slot:s.slot};save();
 const canonical=profileFromRuntime(recipe,s.reinstall_runtime);
 await api('/api/admin/eggs/'+s.fixture.egg.id+'/scripts','PATCH',{script_install:installerGate(canonical.egg.scripts.installation.script,s.slot.token),script_container:canonical.egg.scripts.installation.container,script_entry:canonical.egg.scripts.installation.entrypoint});
 await api(endpoint()+'/settings/reinstall','POST',{});s.reinstall.requested=true;save();
 const {container,proof}=await waitNativeInstaller(s.fixture);s.reinstall.installer={...proof,cgroup:docker(['exec',container.Id,'sh','-c','cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max'])};
 const stamp=Date.now(),log=path.join(dir,'reinstall-'+stamp+'.log'),wait=path.join(dir,'reinstall-'+stamp+'.exit'),lf=fs.openSync(log,'a'),wf=fs.openSync(wait,'a');
 const logger=spawn('docker',['--context','desktop-linux','logs','--follow',container.Id],{windowsHide:true,detached:true,stdio:['ignore',lf,lf]}),watch=spawn('docker',['--context','desktop-linux','wait',container.Id],{windowsHide:true,detached:true,stdio:['ignore',wf,wf]});logger.unref();watch.unref();fs.closeSync(lf);fs.closeSync(wf);s.reinstall.capture={log,wait,attached_before_gate:true};save();
 for(let n=0;n<20&&!fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE');n++)await new Promise(r=>setTimeout(r,100));if(!fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE'))throw Error('Reinstall gate capture missing');
 releaseGate(container,s.lease,s.slot.token);s.reinstall.gate_released=true;save();console.log(JSON.stringify({reinstall_requested:true,actual_limits:s.reinstall.installer}));
}else if(phase==='reinstalled'){
 owned();s.reinstall.outcome=await waitInstallOutcome(s.fixture);for(let n=0;n<50&&!fs.readFileSync(s.reinstall.capture.wait,'utf8').trim();n++)await new Promise(r=>setTimeout(r,100));s.reinstall.exit=fs.readFileSync(s.reinstall.capture.wait,'utf8').trim();save();releaseInstaller(s.slot);s.slot_released=true;save();console.log(JSON.stringify(s.reinstall));if(!s.reinstall.outcome.success||s.reinstall.exit!=='0')throw Error('Reinstall failed');
}else if(phase==='crash'){
 owned();await verifyRuntime();if((await observePower(s.fixture)).current_state!=='running')throw Error('Actual native running server required');
 const c=JSON.parse(docker(['inspect',s.fixture.server.uuid]))[0],wait=path.join(dir,'controlled-crash.exit'),fd=fs.openSync(wait,'w');
 const watch=spawn('docker',['--context','desktop-linux','wait',c.Id],{windowsHide:true,detached:true,stdio:['ignore',fd,fd]});watch.unref();fs.closeSync(fd);
 s.controlled_crash={at:new Date().toISOString(),intent:'SIGKILL exact owned Tachyon Java child',container:c.Id,wait,wait_pid:watch.pid};save();
 const code="import pathlib,os,signal,json;matches=[]\nfor p in pathlib.Path('/proc').iterdir():\n if not p.name.isdigit():continue\n try:args=(p/'cmdline').read_bytes().split(bytes([0]))\n except OSError:continue\n if args[0]==b'/home/container/.voltra/java8/bin/java' and b'TachyonsCEServer.jar' in args:matches.append(int(p.name))\nassert len(matches)==1;print(json.dumps({'child_pid':matches[0],'signal':'SIGKILL'}),flush=True);os.kill(matches[0],signal.SIGKILL)";
 try{Object.assign(s.controlled_crash,JSON.parse(docker(['exec',s.fixture.server.uuid,'python3','-c',code])));}catch(e){s.controlled_crash.observation_error=String(e.message);}save();console.log(JSON.stringify(s.controlled_crash));
}else throw Error('Unsupported phase');
