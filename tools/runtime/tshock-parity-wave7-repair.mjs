import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {root,runtime,verifyRuntime,api,activeLease,containers,observePower,installerGate,docker,digest} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'tshock-wave7'),statePath=path.join(dir,'state.json'),s=JSON.parse(fs.readFileSync(statePath));
const receipt=await verifyRuntime();activeLease(s.lease.lease_id,'tshock_native');
const a=(await api('/api/application/servers/'+s.server.id)).attributes;
if(a.uuid!=='cdb1471c-4d55-4c80-8fe2-694612d5230d'||a.uuid!==s.server.uuid||a.egg!==s.egg.id||a.node!==1)throw Error('Exact owned TShock identity required');
if((await observePower(s)).current_state!=='offline'||containers().some(c=>c.Name.includes(s.server.uuid)&&c.State.Running))throw Error('Stopped fixture required');
const profile=JSON.parse(fs.readFileSync(path.join(root,'artifacts/game-parity-20261029/tshock-wave7-profile.json')))[s.recipe];
const original=(await api('/api/admin/eggs/'+s.egg.id)).attributes;
const helper=fs.readFileSync(path.join(root,'tools/runtime/tshock-parity-wave7.py'),'utf8').replaceAll('\r\n','\n');
const publication=fs.readFileSync(path.join(root,'internal/panel/game_library/scripts/steam-template.py'),'utf8').replaceAll('\r\n','\n');
if(!profile.egg.scripts.installation.script.includes(helper)||!profile.egg.scripts.installation.script.includes(publication))throw Error('Staged helper mismatch');
const plan={at:new Date().toISOString(),uuid:s.server.uuid,runtime:receipt,helper_sha256:digest(helper),publication_sha256:digest(publication),profile_sha256:digest(JSON.stringify(profile)),startup:profile.egg.startup,original_startup:a.container.startup_command,config_files:JSON.parse(profile.egg.config.files),controls:profile.egg.variables.length,acquisition:false};
if(plan.controls!==9)throw Error('Original nine controls required');
if(!['apply-reviewed','finalize-applied'].includes(process.argv[2])){fs.writeFileSync(path.join(dir,'repair-plan.json'),JSON.stringify(plan,null,2)+'\n');console.log(JSON.stringify(plan));process.exit(0);}
const approved=JSON.parse(fs.readFileSync(path.join(dir,'repair-plan.json')));for(const key of ['uuid','helper_sha256','publication_sha256','profile_sha256'])if(plan[key]!==approved[key])throw Error('Reviewed repair changed');
// The only writable mount is this admitted, stopped fixture. No publisher work or game process runs.
const code=`from pathlib import Path
import json,hashlib,os,stat
r=Path('/v');source=Path('/work');targets={'.voltra/tshock_parity_native.py':('tools/runtime/tshock-parity-wave7.py','${plan.helper_sha256}'),'.voltra/steam_template.py':('internal/panel/game_library/scripts/steam-template.py','${plan.publication_sha256}')}
def snapshot():
 out={}
 for p in r.rglob('*'):
  rel=p.relative_to(r).as_posix()
  if rel in targets:continue
  if p.is_symlink():out[rel]={'link':os.readlink(p)};continue
  if not p.is_file():continue
  st=p.stat()
  with p.open('rb') as f:h=hashlib.file_digest(f,'sha256').hexdigest()
  out[rel]={'sha256':h,'bytes':st.st_size,'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid,'mtime_ns':st.st_mtime_ns}
 return out
before=snapshot();owner=(r/'.voltra/tshock_runtime.py').stat()
if (r/'.voltra').is_symlink():raise ValueError('Linked helper directory')
for relative,(name,expected) in targets.items():
 target=r/relative
 if target.exists() or target.is_symlink():raise ValueError('New helper already exists; inspect before retry')
 data=(source/name).read_bytes().replace(b'\\r\\n',b'\\n')
 if hashlib.sha256(data).hexdigest()!=expected:raise ValueError('Reviewed source changed')
 with target.open('xb') as f:f.write(data)
 target.chmod(0o644);os.chown(target,owner.st_uid,owner.st_gid)
after=snapshot()
if before!=after:raise ValueError('Protected fixture bytes/metadata changed')
print(json.dumps({'files_unchanged':len(before),'files':before,'helpers':{name:hashlib.sha256((r/name).read_bytes()).hexdigest() for name in targets}}))`;
let proof;
if(process.argv[2]==='apply-reviewed'){
proof=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--user','0:0','--memory','256m','--memory-swap','256m','--cpus','1','--mount',`type=bind,source=/var/lib/voltra-parity-20261029/volumes/${s.server.uuid},target=/v`,'--mount',`type=bind,source=${root},target=/work,readonly`,'python:3.12-slim','python','-B','-c',code]));
fs.writeFileSync(path.join(dir,'repair-files.json'),JSON.stringify(proof,null,2)+'\n');
fs.writeFileSync(path.join(dir,'original-egg-before-repair.json'),JSON.stringify(original,null,2)+'\n');
await api('/api/admin/eggs/'+s.egg.id,'PATCH',{startup:profile.egg.startup,config_files:JSON.parse(profile.egg.config.files)});
await api('/api/admin/eggs/'+s.egg.id+'/scripts','PATCH',{script_install:installerGate(profile.egg.scripts.installation.script,crypto.randomUUID())});
await api('/api/application/servers/'+s.server.id+'/startup','PATCH',{startup:profile.egg.startup});
}else proof=JSON.parse(fs.readFileSync(path.join(dir,'repair-files.json')));
const after=(await api('/api/application/servers/'+s.server.id)).attributes;
for(const key of ['limits','allocation','egg','node','user','name'])if(JSON.stringify(after[key])!==JSON.stringify(a[key]))throw Error('Protected server metadata changed: '+key);
const expected={...s.server.container.environment,STARTUP:profile.egg.startup};
for(const key of Object.keys({...expected,...after.container.environment})){
 const actual=after.container.environment[key];
 if(actual!==expected[key]&&!(key==='SERVER_PASSWORD'&&actual==='[global integration]'))throw Error('Original environment changed: '+key);
}
if(after.container.startup_command!==profile.egg.startup)throw Error('Reviewed startup was not applied');
s.original_runtime??=s.runtime;s.fixture_repair={...plan,applied_at:new Date().toISOString(),protected_files:proof.files_unchanged};
fs.writeFileSync(statePath,JSON.stringify(s,null,2)+'\n');fs.writeFileSync(path.join(dir,'repair-applied.json'),JSON.stringify(s.fixture_repair,null,2)+'\n');console.log(JSON.stringify({applied:true,protected_files:proof.files_unchanged,helpers:proof.helpers,acquisition:false}));
