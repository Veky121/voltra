import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {root,runtime,verifyRuntime,activeLease,api,observePower,containers,docker,digest,acquireInstaller,installerGate} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'tshock-wave7'),statePath=path.join(dir,'state.json'),read=p=>JSON.parse(fs.readFileSync(p)),write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n'),s=read(statePath);
const receipt=await verifyRuntime();activeLease(s.lease.lease_id,'tshock_native');const a=(await api('/api/application/servers/'+s.server.id)).attributes;if(a.uuid!==s.server.uuid||a.egg!==s.egg.id||a.node!==1)throw Error('Owned TShock required');
if((await observePower(s)).current_state!=='offline'||containers().some(c=>c.Name.includes(s.server.uuid)&&c.State.Running))throw Error('Stopped game required');
const command=process.argv[2];
if(command==='snapshot'){
 const tag=process.argv[3];if(!/^[a-z0-9_-]+$/.test(tag||''))throw Error('Exact snapshot tag required');
 const code="from pathlib import Path;import json,hashlib,stat,os\nr=Path('/v');out={}\nfor name in ('serverconfig.txt','saves','tshock'):\n p=r/name\n for f in ([p,*p.rglob('*')] if p.is_dir() else [p]):\n  if f.is_symlink():out[f.relative_to(r).as_posix()]={'link':os.readlink(f)};continue\n  if not f.is_file():continue\n  st=f.stat()\n  with f.open('rb') as source:sha=hashlib.file_digest(source,'sha256').hexdigest()\n  out[f.relative_to(r).as_posix()]={'bytes':st.st_size,'sha256':sha,'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid,'mtime_ns':st.st_mtime_ns}\nprint(json.dumps(out))";
 const files=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--mount',`type=bind,source=/var/lib/voltra-parity-20261029/volumes/${s.server.uuid},target=/v,readonly`,'python:3.12-slim','python','-B','-c',code]));write(path.join(dir,'snapshot-'+tag+'.json'),{at:new Date().toISOString(),uuid:s.server.uuid,files});console.log(JSON.stringify({tag,files:Object.keys(files).length,worlds:Object.keys(files).filter(p=>p.endsWith('.wld')).length,sqlite:Object.keys(files).filter(p=>p.endsWith('.sqlite')).length}));
}else if(command==='reinstall'){
 const profile=read(path.join(root,'artifacts/game-parity-20261029/tshock-wave7-profile.json'))[s.recipe],reviewed=read(path.join(dir,'repair-applied.json'));
 assert.equal(digest(JSON.stringify(profile)),reviewed.profile_sha256);assert.equal(profile.egg.startup,a.container.startup_command);assert.equal(profile.egg.variables.length,9);
 const before=read(path.join(dir,'snapshot-preservation-before.json'));assert.equal(before.uuid,s.server.uuid);assert(Object.keys(before.files).some(p=>p.endsWith('.wld')));assert(Object.keys(before.files).some(p=>p.endsWith('.sqlite')));
 const slot=acquireInstaller(s.lease.lease_id,s.lease.owner);write(path.join(dir,'preservation-slot.json'),slot);s.slot=slot;s.original_installer_body_sha256??=s.installer_body_sha256;s.installer_body_sha256=digest(profile.egg.scripts.installation.script);s.runtime=receipt;write(statePath,s);
 await api('/api/admin/eggs/'+s.egg.id+'/scripts','PATCH',{script_install:installerGate(profile.egg.scripts.installation.script,slot.token)});
 if(fs.existsSync(path.join(dir,'installer-released.json')))fs.unlinkSync(path.join(dir,'installer-released.json'));
 await api('/api/application/servers/'+s.server.id+'/reinstall','POST',{});console.log(JSON.stringify({reinstall_queued:true,controls:9,profile_sha256:reviewed.profile_sha256}));
}else if(command==='compare'){
 const before=read(path.join(dir,'snapshot-preservation-before.json')),after=read(path.join(dir,'snapshot-preservation-after.json'));
 const keys=new Set([...Object.keys(before.files),...Object.keys(after.files)]),changes=[...keys].filter(k=>JSON.stringify(before.files[k])!==JSON.stringify(after.files[k]));
 const proof={at:new Date().toISOString(),files:keys.size,strict_sha_bytes_mode_uid_gid_mtime_equal:changes.length===0,changed_paths:changes};write(path.join(dir,'preservation.json'),proof);console.log(JSON.stringify(proof));assert.equal(changes.length,0);
}else throw Error('Use snapshot tag|reinstall after coordinator GO|compare');
