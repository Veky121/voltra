import fs from 'node:fs';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const d='.local/plains-native-approved',{receipt:s,node,image}=await ownedStoppedServer(d+'/private.json');assert.equal(s.path,'plains_of_pain/egg-plains-of-pain.json');
const inspect=name=>{const r=spawnSync('docker',['inspect',name],{windowsHide:true,encoding:'utf8'});if(r.status){assert(r.stderr.includes('No such'));return null;}return JSON.parse(r.stdout)[0];};
const before=inspect(s.uuid);assert(before&&!before.State.Running&&before.State.Pid===0);const terminal=JSON.parse(fs.readFileSync(d+'/first-stop.json'));assert.deepEqual(before.State,terminal.state);assert.equal(inspect(s.uuid+'_installer'),null);
const manifest=JSON.parse(fs.readFileSync(d+'/canonical-source-retention-current/manifest.json'));assert.equal(manifest.modules.length,10);const names=manifest.modules.map(m=>'.voltra/'+m.name);
const code=`from pathlib import Path
import json,stat,hashlib
r=Path('/v');names=json.loads(${JSON.stringify(JSON.stringify(names))});names+=['EULA.txt'];cfg=r/'configs'
if cfg.exists():
 assert cfg.is_dir() and not cfg.is_symlink()
 names += [str(p.relative_to(r)) for p in cfg.rglob('*') if p.is_file()]
files={}
for name in names:
 p=r/name;assert not p.is_symlink() and p.resolve().is_relative_to(r.resolve());st=p.stat();assert stat.S_ISREG(st.st_mode);b=p.read_bytes();files[name]={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'mode':oct(st.st_mode&0o777),'uid':st.st_uid,'gid':st.st_gid}
for p in (r/'.config').rglob('*'):
 if p.is_file():
  assert not p.is_symlink() and p.resolve().is_relative_to(r.resolve());st=p.stat();b=p.read_bytes();files[str(p.relative_to(r))]={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'mode':oct(st.st_mode&0o777),'uid':st.st_uid,'gid':st.st_gid}
print(json.dumps({'files':files,'generated_config_present':(cfg/'server.json').is_file()}))`;
const out=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--read-only','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/v,readonly`,image,'python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8'});assert.equal(out.status,0,out.stderr);const files=JSON.parse(out.stdout);for(const m of manifest.modules){assert.equal(files.files['.voltra/'+m.name].sha256,m.sha256);assert.equal(files.files['.voltra/'+m.name].bytes,m.bytes);}
const after=inspect(s.uuid);assert.deepEqual(before.State,after.State);assert.equal(inspect(s.uuid+'_installer'),null);const canonical=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[s.path];assert.deepEqual(canonical,JSON.parse(fs.readFileSync(d+'/canonical-source-retention-current/profile.json')));
const proof={at:new Date().toISOString(),server_id:s.internal_id,uuid:s.uuid,node:s.node,node_uuid:s.node_uuid,lease_id:s.lease_id,logical_memory_mib:4096,disk_mib:16384,ports:s.ports,state_before:before.State,state_after:after.State,installer_absent:true,no_native_start:false,first_generation_terminal:true,no_live_game_or_installer_job:true,source_profile_unchanged:true,actual_helpers_exact:10,...files};fs.writeFileSync('artifacts/plains-approved-after-retention-identities.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});console.log({state:after.State,files:Object.keys(files.files).length,configs:Object.keys(files.files).filter(n=>n.startsWith('configs/')),helpers_exact:10,source_unchanged:true,report:'artifacts/plains-approved-after-retention-identities.json'});
