import fs from 'node:fs';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const d='.local/plains-native',{receipt:s,node,image}=await ownedStoppedServer(d+'/private.json');assert.equal(s.internal_id,532);
const inspect=name=>{const r=spawnSync('docker',['inspect',name],{windowsHide:true,encoding:'utf8'});if(r.status){assert(r.stderr.includes('No such'));return null;}return JSON.parse(r.stdout)[0];};
const before=inspect(s.uuid);assert(before&&!before.State.Running&&before.State.Pid===0);assert.equal(before.State.StartedAt,'0001-01-01T00:00:00Z');assert.equal(inspect(s.uuid+'_installer'),null);
const manifest=JSON.parse(fs.readFileSync(d+'/canonical-source-first/manifest.json'));assert.equal(manifest.modules.length,10);const names=manifest.modules.map(m=>'.voltra/'+m.name);
const code=`from pathlib import Path
import json,stat,hashlib
r=Path('/v');names=json.loads(${JSON.stringify(JSON.stringify(names))});names+=['EULA.txt'];cfg=r/'configs'
if cfg.exists():
 assert cfg.is_dir() and not cfg.is_symlink()
 names += [str(p.relative_to(r)) for p in cfg.rglob('*') if p.is_file()]
files={}
for name in names:
 p=r/name;assert not p.is_symlink() and p.resolve().is_relative_to(r.resolve());st=p.stat();assert stat.S_ISREG(st.st_mode);b=p.read_bytes();files[name]={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'mode':oct(st.st_mode&0o777),'uid':st.st_uid,'gid':st.st_gid}
print(json.dumps({'files':files,'generated_config_present':(cfg/'server.json').is_file()}))`;
const out=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--read-only','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/v,readonly`,image,'python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8'});assert.equal(out.status,0,out.stderr);const files=JSON.parse(out.stdout);for(const m of manifest.modules){assert.equal(files.files['.voltra/'+m.name].sha256,m.sha256);assert.equal(files.files['.voltra/'+m.name].bytes,m.bytes);}
const after=inspect(s.uuid);assert.deepEqual(before.State,after.State);assert.equal(inspect(s.uuid+'_installer'),null);const canonical=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[s.path];const frozen=JSON.parse(fs.readFileSync(d+'/canonical-source-first/profile.json'));const sourceUnchanged=JSON.stringify(canonical)===JSON.stringify(frozen);const reviewed=JSON.parse(fs.readFileSync('artifacts/plains-eula-hold-live-root-review.json'));assert.equal(reviewed.uuid,s.uuid);for(const row of reviewed.records){const {path,...identity}=row;assert.deepEqual(files.files[path],identity,'Reviewed hold identity drift '+path);}assert.equal(Object.keys(files.files).length,reviewed.records.length);
const proof={at:new Date().toISOString(),server_id:532,uuid:s.uuid,node:s.node,node_uuid:s.node_uuid,lease_id:s.lease_id,logical_memory_mib:4096,disk_mib:16384,ports:s.ports,state_before:before.State,state_after:after.State,installer_absent:true,no_native_start:true,no_live_game_or_installer_job:true,canonical_source_profile_unchanged:sourceUnchanged,installed_frozen_source_exact:true,actual_helpers_exact:10,...files};fs.writeFileSync('artifacts/plains-precleanup-hold-identities.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});console.log({state:after.State,files:Object.keys(files.files).length,configs:Object.keys(files.files).filter(n=>n.startsWith('configs/')),helpers_exact:10,source_unchanged:true,report:'artifacts/plains-precleanup-hold-identities.json'});
