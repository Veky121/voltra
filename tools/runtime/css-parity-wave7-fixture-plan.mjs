// Read-only preparation. Root reviews this exact delta before any fixture write.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {runtime,verifyRuntime,activeLease,api,digest,observePower,docker} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'css-native'),s=JSON.parse(fs.readFileSync(path.join(dir,'state.json'))),recipe=s.lease.game;
const receipt=await verifyRuntime();activeLease(s.lease.lease_id,'css_native');
const server=(await api('/api/application/servers/'+s.fixture.server.id)).attributes,egg=(await api('/api/admin/eggs/'+s.fixture.egg.id)).attributes;
if(server.uuid!==s.fixture.server.uuid||server.egg!==s.fixture.egg.id||server.node!==1||egg.uuid!==s.fixture.egg.uuid)throw Error('Foreign fixture');
const future=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
assert.deepEqual(future.egg.variables,s.profile.egg.variables,'Original seventeen controls must remain identical');
const blocks=script=>new Map([...script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].filter(m=>m[1].endsWith('.py')).map(m=>[m[1],m[3]+'\n']));
const oldHelpers=blocks(s.profile.egg.scripts.installation.script),newHelpers=blocks(future.egg.scripts.installation.script),helperDelta=[];
for(const [file,body]of newHelpers)if(oldHelpers.get(file)!==body)helperDelta.push({file,old_sha256:oldHelpers.has(file)?digest(oldHelpers.get(file)):null,new_sha256:digest(body),bytes:Buffer.byteLength(body)});
assert.deepEqual(helperDelta.map(x=>x.file),['.voltra/css_native_settings.py'],'Only the new CSS-only helper may differ');
const endpoint='/api/client/servers/'+server.uuid;
const read=async file=>{const r=await fetch('http://127.0.0.1:18099'+endpoint+'/files/contents?file='+encodeURIComponent(file));return {status:r.status,body:r.ok?Buffer.from(await r.arrayBuffer()):null};};
const cfg=await read('/cstrike/cfg/server.cfg'),newHelper=await read('/.voltra/css_native_settings.py');
const paths=['cstrike/cfg/server.cfg','.voltra/css_native_settings.py'];
const fsProof=JSON.parse(docker(['exec',server.uuid,'env','PYTHONHOME=/home/container/.voltra/python','LD_LIBRARY_PATH=/home/container/.voltra/python/lib','/home/container/.voltra/python/bin/python3','-B','-c',"import pathlib,json;root=pathlib.Path('/home/container');print(json.dumps({p:{'exists':(root/p).exists(),'symlink':(root/p).is_symlink(),'file':(root/p).is_file()} for p in "+JSON.stringify(paths)+"}))"]));
if(fsProof[paths[1]].exists||fsProof[paths[1]].symlink||fsProof[paths[0]].symlink||cfg.status!==200&&fsProof[paths[0]].exists)throw Error('Unexpected native CFG/helper filesystem state');
const configs=(await api(endpoint+'/files/list?directory=%2Fcstrike%2Fcfg')).data.map(x=>x.attributes).filter(x=>x.is_file&&/\.(cfg|txt)$/i.test(x.name));
const hashes=[];for(const entry of configs){const file='/cstrike/cfg/'+entry.name,result=await read(file);if(result.status!==200)throw Error('Native config inventory read failed');hashes.push({file,sha256:digest(result.body),bytes:result.body.length});}
const plan={at:new Date().toISOString(),status:'read-only-proposed-awaiting-root-approval-and-fresh-backend',recipe,observed_backend:{pid:receipt.pid,binary_sha256:receipt.binary_sha256},fixture:{server_id:server.id,uuid:server.uuid,node:1,egg_id:egg.id,egg_uuid:egg.uuid,nest_id:s.fixture.nest.id,lease_id:s.lease.lease_id,ports:s.lease.ports},current_power:(await observePower(s.fixture)).current_state,
 provenance:{current_captured_profile_sha256:digest(JSON.stringify(s.profile)),proposed_workspace_profile_sha256:digest(JSON.stringify(future)),new_helper:helperDelta[0],original_controls:17,original_controls_unchanged:true,existing_helpers_unchanged:true,other_game_profiles_unchanged:true},
 current_native_cfg:{file:'/cstrike/cfg/server.cfg',http_status:cfg.status,filesystem:fsProof[paths[0]],sha256:cfg.body?digest(cfg.body):null,operator_authority:'Never overwrite an existing server.cfg. If it is absent at the reviewed new startup, the CSS-only wrapper seeds seven measured default gameplay cvars.'},new_helper_filesystem:fsProof[paths[1]],
 config_inventory:hashes,original_control_values_sha256:digest(JSON.stringify(Object.fromEntries(s.profile.egg.variables.map(v=>[v.env_variable,server.container.environment[v.env_variable]])))),derived_environment_change:'STARTUP intentionally changes with the approved startup string; all seventeen actual control values must remain identical.',
 proposed_steps:[
  'Wait for root approval and a fresh activated backend whose exact served CSS profile matches the proposed profile hash.',
  'Authenticate owned console, request normal stop, retain actual exit/status and verify offline. Capture the stopped cfg inventory and original-control values hash as the actual mutation baseline.',
  'Write ONLY the new public helper /.voltra/css_native_settings.py from the exact fresh served heredoc. Verify old file absence and new bytes; do not change other helpers, credentials, payloads, maps, saves or native cfg files.',
  'PATCH only the owned egg startup to the new unique CSS wrapper. Keep its random UUID, all seventeen variable rows/defaults/permissions, node, allocations, images and limits.',
  'PATCH only the owned server startup; omit environment and egg_id so all existing values and integration secrets remain intact. Verify original-control values hash, port/limits/image/identity and original control definitions unchanged; only derived STARTUP changes.',
  'Retain the existing readiness expression Server is hibernating; it already produced real starting→running events and matching A2S. No readiness change is needed.',
  'Start through the new wrapper. Existing server.cfg stays byte-identical; if absent, verify the generated seven defaults against measured engine values before typed API/native/permission tests.',
  'At the later coordinator-approved preservation reinstall, patch ONLY this owned egg installer with the exact fresh served installation body behind a NEW shared slot token, prove actual limits and attach logs/wait before release. Never reuse the original released gate.'
 ],
 exact_patches:{egg:{route:'/api/admin/eggs/'+egg.id,method:'PATCH',body:{startup:future.egg.startup}},server:{route:'/api/application/servers/'+server.id+'/startup',method:'PATCH',body:{startup:future.egg.startup}}},
 installer_update:'Deferred until a fresh serialized reinstall slot; exact body hash '+digest(future.egg.scripts.installation.script),
 rollback:{egg_startup:egg.startup,server_startup:server.container.startup_command,procedure:'While stopped, restore these two startup strings and remove only the newly staged helper if its hash still matches the owned staged bytes. Keep any generated/edited native server.cfg as operator data; never delete or reset it.'},
 mutations_performed:false};
fs.writeFileSync('artifacts/game-parity-20261029/css-wave7-fixture-delta-plan.json',JSON.stringify(plan,null,2)+'\n');console.log(JSON.stringify({status:plan.status,fixture:plan.fixture,new_helper:plan.provenance.new_helper,native_cfg_status:cfg.status,config_files:hashes.length,mutations:false}));
