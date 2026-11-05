import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {runtime,verifyRuntime,api,activeLease,profileFromRuntime,installerGate,acquireInstaller,containers,digest} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'cubicodyssey-wave5'),statePath=path.join(dir,'state.json'),read=p=>JSON.parse(fs.readFileSync(p)),write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const s=read(statePath),receipt=await verifyRuntime();activeLease(s.lease.lease_id,'cubicodyssey_native');const a=(await api('/api/application/servers/'+s.server.id)).attributes;if(a.uuid!==s.server.uuid||a.egg!==s.egg.id||a.node!==1)throw Error('Owned Cubic repair identity required');if(containers().some(c=>c.Name.includes(s.server.uuid)&&c.State.Running))throw Error('Owned game and installer must be stopped');
const command=process.argv[2];
if(command==='prepare'){
 const profile=profileFromRuntime(s.recipe,receipt),original=profileFromRuntime(s.recipe,s.original_runtime||s.runtime),egg=(await api('/api/admin/eggs/'+s.egg.id)).attributes;
 if(JSON.stringify(profile.egg.variables)!==JSON.stringify(original.egg.variables)||profile.egg.startup!==egg.startup||JSON.stringify(profile.egg.docker_images)!==JSON.stringify(original.egg.docker_images))throw Error('Original setup/startup/image metadata changed');
 const body=profile.egg.scripts.installation.script,blockedToken=crypto.randomUUID();
 const proof={at:new Date().toISOString(),runtime:receipt,installer_body_sha256:digest(body),blocked_preparation_token:blockedToken,original_controls_preserved:profile.egg.variables.length};write(path.join(dir,'repair-prepare.json'),proof);
 await api('/api/admin/eggs/'+s.egg.id+'/scripts','PATCH',{script_install:installerGate(body,blockedToken)});s.original_runtime??=s.runtime;s.original_installer_body_sha256??=s.installer_body_sha256;s.runtime=receipt;s.installer_body_sha256=digest(body);write(statePath,s);console.log(JSON.stringify({prepared:true,backend_pid:receipt.pid,original_controls:profile.egg.variables.length,installer_body_sha256:digest(body),acquisition:false}));
}else if(command==='reinstall'){
 const prepared=read(path.join(dir,'repair-prepare.json')),profile=profileFromRuntime(s.recipe,receipt),body=profile.egg.scripts.installation.script;if(digest(body)!==prepared.installer_body_sha256)throw Error('Current reviewed repair profile changed; prepare again');
 const slot=acquireInstaller(s.lease.lease_id,s.lease.owner);write(path.join(dir,'repair-slot-'+Date.now()+'.json'),slot);s.slot=slot;write(statePath,s);
 await api('/api/admin/eggs/'+s.egg.id+'/scripts','PATCH',{script_install:installerGate(body,slot.token)});if(fs.existsSync(path.join(dir,'installer-released.json')))fs.unlinkSync(path.join(dir,'installer-released.json'));
 write(path.join(dir,'repair-reinstall-request.json'),{at:new Date().toISOString(),runtime:receipt,installer_body_sha256:digest(body)});await api('/api/application/servers/'+s.server.id+'/reinstall','POST',{});console.log('Owned reviewed Cubic repair reinstalled behind fresh serialized resource gate');
}else if(command==='snapshot'){
 const tag=process.argv[3];if(!/^[a-z0-9_-]+$/.test(tag||''))throw Error('Explicit snapshot tag required');
 const code="from pathlib import Path;import json,hashlib,stat,os\nr=Path('/v');out={}\nfor name in ('config','save_server','server/save_server','saves','.wine','mods'):\n p=r/name\n for f in ([p,*p.rglob('*')] if p.is_dir() else [p]):\n  if f.is_symlink():out[f.relative_to(r).as_posix()]={'link':os.readlink(f)};continue\n  if not f.is_file():continue\n  st=f.stat()\n  with f.open('rb') as source:sha=hashlib.file_digest(source,'sha256').hexdigest()\n  out[f.relative_to(r).as_posix()]={'bytes':st.st_size,'sha256':sha,'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid,'mtime_ns':st.st_mtime_ns}\nprint(json.dumps(out))";
 const result=spawnSync('docker',['--context','desktop-linux','run','--rm','--pull','never','--network','none','--read-only','--user','0:0','--memory','256m','--memory-swap','256m','--cpus','1','--mount',`type=bind,source=/var/lib/voltra-parity-20261029/volumes/${s.server.uuid},target=/v,readonly`,'python:3.12-slim','python','-B','-c',code],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024**2});if(result.status)throw Error('Read-only Cubic snapshot failed: '+result.stderr.slice(0,400));const files=JSON.parse(result.stdout);write(path.join(dir,'snapshot-'+tag+'.json'),{at:new Date().toISOString(),uuid:s.server.uuid,files});console.log(JSON.stringify({tag,files:Object.keys(files).length}));
}else throw Error('Use prepare|reinstall only after GO|snapshot tag');
