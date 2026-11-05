// Xonotic owned native acceptance only. Acquisition phases require coordinator GO.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {runtime,verifyRuntime,activeLease,api,docker,digest,observePower,profileFromRuntime,acquireInstaller,installerGate,waitNativeInstaller,releaseGate,waitInstallOutcome,releaseInstaller} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'xonotic-native'),file=path.join(dir,'state.json'),s=JSON.parse(fs.readFileSync(file));
const save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');
activeLease(s.lease.lease_id,'xonotic_native');const receipt=await verifyRuntime(),base='/api/client/servers/'+s.fixture.server.uuid;
const phase=process.argv[2],cfg='/.xonotic/data/server.cfg';
const read=async p=>{const r=await fetch('http://127.0.0.1:18099'+base+'/files/contents?file='+encodeURIComponent(p));assert.equal(r.status,200);return r.text();};
const write=async(p,body)=>{const r=await fetch('http://127.0.0.1:18099'+base+'/files/write?file='+encodeURIComponent(p),{method:'POST',headers:{'Content-Type':'text/plain'},body});assert.equal(r.status,204);};
const stopped=async()=>assert.equal((await observePower(s.fixture)).current_state,'offline');
if(phase==='typed'){
 await stopped();const route=base+'/game-settings?file='+encodeURIComponent(cfg),view=(await api(route)).attributes;
 assert.equal(view.fields.length,8);assert.equal(view.fields.find(f=>f.key==='sv_taunt').type,'boolean');assert.equal(view.fields.find(f=>f.key==='g_friendlyfire').type,'number');
 const old=await read(cfg),changes={sv_taunt:false,g_friendlyfire:'0.25',g_warmup_limit:'60',g_maplist_shuffle:false};
 const next=(await api(route,'PUT',{revision:view.revision,settings:changes})).attributes,current=await read(cfg);
 let expected=old;for(const [k,v] of Object.entries(changes))expected=expected.replace(new RegExp('(^'+k+' ")[^"\\r\\n]*(")','m'),(_m,a,b)=>a+(typeof v==='boolean'?(v?'1':'0'):v)+b);assert.equal(current,expected,'Unrelated native bytes changed');
 const invalid=async(settings,revision=next.revision)=>{const r=await fetch('http://127.0.0.1:18099'+route,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,settings})});return r.status;};
 assert.equal(await invalid({g_friendlyfire:'0.5'},view.revision),409);assert.equal(await invalid({port:'29999'}),422);assert.equal(await invalid({g_friendlyfire:'1.1'}),422);assert.equal(await read(cfg),current);
 s.typed_roundtrip={at:new Date().toISOString(),backend:receipt.binary_sha256,fields:next.fields.map(f=>({key:f.key,type:f.type})),changes,before_sha256:digest(old),after_sha256:digest(current),after_bytes:Buffer.byteLength(current),byte_span_exact:true,stale_status:409,managed_status:422,bounds_status:422};save();console.log(JSON.stringify(s.typed_roundtrip));
}else if(['baseline','preserved','typed-preserved'].includes(phase)){
 await stopped();const server=(await api('/api/application/servers/'+s.fixture.server.id)).attributes;assert.equal(server.uuid,s.fixture.server.uuid);assert.equal(server.egg,s.fixture.egg.id);
 const c=JSON.parse(docker(['inspect',s.fixture.server.uuid]))[0],source=c.Mounts.find(m=>m.Destination==='/home/container')?.Source;assert.equal(source,'/var/lib/voltra-parity-20261029/volumes/'+s.fixture.server.uuid);
 if(phase==='baseline')await write('/.xonotic/data/voltra-parity-preserve.cfg','// Xonotic operator-owned preservation fixture.\n// Unknown bytes and comments must survive reinstall.\n');
 const code="import pathlib,hashlib,json;root=pathlib.Path('/game');out=[];paths=sorted((root/'xonotic').rglob('*'))+sorted((root/'.xonotic').rglob('*'))+[root/'.voltra/xonotic/rcon-password']\nfor p in paths:\n if not p.is_file() or p.suffix=='.log':continue\n assert not p.is_symlink();s=p.stat();out.append({'file':str(p.relative_to(root)),'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest(),'bytes':s.st_size,'mode':s.st_mode&511,'uid':s.st_uid,'gid':s.st_gid})\nassert any(x['file']=='.xonotic/data/server.cfg' for x in out);print(json.dumps(out))";
 const files=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','128m','--memory-swap','128m','--cpus','1','--mount',`type=bind,source=${source},target=/game,readonly`,'python:3.12-slim','python3','-B','-c',code]));
 if(phase==='baseline'){assert(!s.preservation,'Never replace an existing baseline');s.preservation={at:new Date().toISOString(),volume_source:source,files};}
 else{
  const expected=structuredClone(s.preservation.files);
  if(phase==='typed-preserved'){assert(s.typed_roundtrip);expected.find(f=>f.file==='.xonotic/data/server.cfg').sha256=s.typed_roundtrip.after_sha256;expected.find(f=>f.file==='.xonotic/data/server.cfg').bytes=s.typed_roundtrip.after_bytes;}
  assert.deepEqual(files,expected);(s.preservation_checks??=[]).push({at:new Date().toISOString(),phase,files:files.length,exact:true,typed_delta_only:phase==='typed-preserved'});
 }
 save();console.log(JSON.stringify({phase,files:files.length,exact:true}));
}else if(phase==='reinstall'){
 assert.equal(process.env.XONOTIC_INSTALL_GO,'1','Coordinator preservation GO required');
 await stopped();assert(s.preservation);s.reinstall_runtime=receipt;s.slot=acquireInstaller(s.lease.lease_id,'xonotic_native');s.slot_released=false;s.reinstall={at:new Date().toISOString(),slot:s.slot};save();
 const profile=profileFromRuntime(s.lease.game,receipt);assert.equal(digest(JSON.stringify(profile)),digest(JSON.stringify(s.profile)),'Re-review unexpected profile drift');
 await api('/api/admin/eggs/'+s.fixture.egg.id+'/scripts','PATCH',{script_install:installerGate(profile.egg.scripts.installation.script,s.slot.token),script_container:profile.egg.scripts.installation.container,script_entry:profile.egg.scripts.installation.entrypoint});
 await api(base+'/settings/reinstall','POST',{});s.reinstall.requested=true;save();
 const {container,proof}=await waitNativeInstaller(s.fixture);s.reinstall.installer={...proof,cgroups:docker(['exec',container.Id,'cat','/sys/fs/cgroup/memory.max','/sys/fs/cgroup/memory.swap.max','/sys/fs/cgroup/cpu.max'])};
 const stamp=Date.now(),log=path.join(dir,'reinstall-'+stamp+'.log'),wait=path.join(dir,'reinstall-'+stamp+'.exit'),lf=fs.openSync(log,'a'),wf=fs.openSync(wait,'a');
 for(const [args,fd] of [[['logs','--follow',container.Id],lf],[['wait',container.Id],wf]]){const child=spawn('docker',['--context','desktop-linux',...args],{windowsHide:true,detached:true,stdio:['ignore',fd,fd]});child.unref();}fs.closeSync(lf);fs.closeSync(wf);
 s.reinstall.capture={log,wait,attached_before_gate:true};save();for(let n=0;n<30&&!fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE');n++)await new Promise(r=>setTimeout(r,100));assert(fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE'));releaseGate(container,s.lease,s.slot.token);s.reinstall.gate_released=true;save();console.log(JSON.stringify(s.reinstall));
}else if(phase==='reinstalled'){
 s.reinstall.outcome=await waitInstallOutcome(s.fixture,{timeoutMs:900000});for(let n=0;n<50&&!fs.readFileSync(s.reinstall.capture.wait,'utf8').trim();n++)await new Promise(r=>setTimeout(r,100));s.reinstall.exit=fs.readFileSync(s.reinstall.capture.wait,'utf8').trim();save();releaseInstaller(s.slot);s.slot_released=true;save();console.log(JSON.stringify(s.reinstall));assert(s.reinstall.outcome.success);assert.equal(s.reinstall.exit,'0');
}else if(phase==='crash'){
 assert.equal((await observePower(s.fixture)).current_state,'running');
 const c=JSON.parse(docker(['inspect',s.fixture.server.uuid]))[0],wait=path.join(dir,'controlled-crash-'+Date.now()+'.exit'),fd=fs.openSync(wait,'w');
 const child=spawn('docker',['--context','desktop-linux','wait',c.Id],{windowsHide:true,detached:true,stdio:['ignore',fd,fd]});child.unref();fs.closeSync(fd);
 s.controlled_crash={at:new Date().toISOString(),container:c.Id,wait,intent:'SIGKILL exact owned native Xonotic engine, not supervisor'};save();
 const code="import pathlib,os,signal,json;matches=[]\nfor p in pathlib.Path('/proc').iterdir():\n if not p.name.isdigit():continue\n try:args=(p/'cmdline').read_bytes().split(bytes([0]))\n except OSError:continue\n if args[0].rsplit(b'/',1)[-1]==b'xonotic-linux64-dedicated':matches.append(int(p.name))\nassert len(matches)==1;print(json.dumps({'child_pid':matches[0],'signal':'SIGKILL'}),flush=True);os.kill(matches[0],signal.SIGKILL)";
 Object.assign(s.controlled_crash,JSON.parse(docker(['exec',s.fixture.server.uuid,'python3','-c',code])));save();console.log(JSON.stringify(s.controlled_crash));
}else if(phase==='crashed'){
 const c=JSON.parse(docker(['inspect',s.controlled_crash.container]))[0];assert.equal(c.State.Running,false);s.controlled_crash.actual_wait_exit=fs.readFileSync(s.controlled_crash.wait,'utf8').trim();s.controlled_crash.actual_state=c.State;s.controlled_crash.api_state=(await observePower(s.fixture)).current_state;save();console.log(JSON.stringify(s.controlled_crash));
}else throw Error('Expected typed/baseline/preserved/reinstall/reinstalled/crash/crashed');
