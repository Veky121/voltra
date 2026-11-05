// Execute only the root-reviewed fixture delta after exact fresh-source proof.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {runtime,verifyRuntime,activeLease,api,digest,observePower,profileFromRuntime} from './campaign-native-20261029.mjs';
const plan=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/css-wave7-fixture-delta-plan.json')),dir=path.join(runtime,'css-native'),file=path.join(dir,'state.json');let s=JSON.parse(fs.readFileSync(file));
const save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n'),receipt=await verifyRuntime();activeLease(s.lease.lease_id,'css_native');
const profile=profileFromRuntime(s.lease.game,receipt);if(digest(JSON.stringify(profile))!==plan.provenance.proposed_workspace_profile_sha256)throw Error('Wait for the reviewed CSS profile in the activated backend');
const fixture=s.fixture,endpoint='/api/client/servers/'+fixture.server.uuid;
const load=async()=>({server:(await api('/api/application/servers/'+fixture.server.id)).attributes,egg:(await api('/api/admin/eggs/'+fixture.egg.id)).attributes});
const controlHash=server=>digest(JSON.stringify(Object.fromEntries(profile.egg.variables.map(v=>[v.env_variable,server.container.environment[v.env_variable]]))));
const read=async name=>{const r=await fetch('http://127.0.0.1:18099'+endpoint+'/files/contents?file='+encodeURIComponent(name));if(!r.ok)throw Error('Existing owned file read failed');return Buffer.from(await r.arrayBuffer());};
const inventory=async()=>{const entries=(await api(endpoint+'/files/list?directory=%2Fcstrike%2Fcfg')).data.map(x=>x.attributes).filter(x=>x.is_file&&/\.(cfg|txt)$/i.test(x.name));const out=[];for(const e of entries){const file='/cstrike/cfg/'+e.name,body=await read(file);out.push({file,sha256:digest(body),bytes:body.length});}return out;};
let current=await load();if(current.server.uuid!==plan.fixture.uuid||current.egg.uuid!==plan.fixture.egg_uuid||current.server.egg!==plan.fixture.egg_id||controlHash(current.server)!==plan.original_control_values_sha256)throw Error('Owned identity/control values changed since review');
if(!s.fixture_update){
 const state=(await observePower(fixture)).current_state;if(state==='running'){
  const stopped=spawnSync(process.execPath,['tools/runtime/css-parity-wave7-console.mjs','stop'],{windowsHide:true,encoding:'utf8',timeout:60000});if(stopped.status!==0)throw Error('Reviewed normal stop failed');s=JSON.parse(fs.readFileSync(file));
 }
 if((await observePower(fixture)).current_state!=='offline')throw Error('Native fixture must be offline before update');current=await load();
 s.fixture_update={at:new Date().toISOString(),reviewed_plan:'artifacts/game-parity-20261029/css-wave7-fixture-delta-plan.json',backend:{pid:receipt.pid,binary_sha256:receipt.binary_sha256},before:{controls_sha256:controlHash(current.server),config_files:await inventory(),limits:current.server.limits,image:current.server.container.image,egg_uuid:current.egg.uuid,egg_startup:current.egg.startup,server_startup:current.server.container.startup_command,readiness:current.egg.config_startup}};save();
}
if((await observePower(fixture)).current_state!=='offline')throw Error('Keep reviewed fixture stopped');
const expected=plan.provenance.new_helper;
const m=profile.egg.scripts.installation.script.match(/cat > \.voltra\/css_native_settings\.py <<'VOLTRA_CSS_NATIVE_SETTINGS_WAVE7'\n([\s\S]*?)\nVOLTRA_CSS_NATIVE_SETTINGS_WAVE7/);if(!m)throw Error('Fresh served helper absent');const body=m[1]+'\n';if(digest(body)!==expected.new_sha256)throw Error('Reviewed CSS helper hash changed');
if(!s.fixture_update.helper_written){
 const names=(await api(endpoint+'/files/list?directory=%2F.voltra')).data.map(x=>x.attributes.name);
 if(names.includes('css_native_settings.py')){if(digest(await read('/.voltra/css_native_settings.py'))!==expected.new_sha256)throw Error('Refuse overwriting an unexpected helper');}
 else{const r=await fetch('http://127.0.0.1:18099'+endpoint+'/files/write?file=%2F.voltra%2Fcss_native_settings.py',{method:'POST',headers:{'Content-Type':'text/plain'},body});if(!r.ok)throw Error('CSS helper write failed');}
 if(digest(await read('/.voltra/css_native_settings.py'))!==expected.new_sha256)throw Error('CSS helper bytes differ after write');s.fixture_update.helper_written=true;save();
}
if(!s.fixture_update.egg_startup_updated){await api('/api/admin/eggs/'+fixture.egg.id,'PATCH',{startup:profile.egg.startup});s.fixture_update.egg_startup_updated=true;save();}
if(!s.fixture_update.server_startup_updated){await api('/api/application/servers/'+fixture.server.id+'/startup','PATCH',{startup:profile.egg.startup});s.fixture_update.server_startup_updated=true;save();}
current=await load();assert.equal(current.egg.uuid,s.fixture_update.before.egg_uuid);assert.equal(current.egg.startup,profile.egg.startup);assert.equal(current.server.container.startup_command,profile.egg.startup);assert.equal(controlHash(current.server),s.fixture_update.before.controls_sha256);assert.deepEqual(current.server.limits,s.fixture_update.before.limits);assert.equal(current.server.container.image,s.fixture_update.before.image);assert.deepEqual(current.egg.config_startup,s.fixture_update.before.readiness);assert.deepEqual(await inventory(),s.fixture_update.before.config_files,'Native configuration changed during helper/startup-only delta');
s.fixture_update.after={at:new Date().toISOString(),controls_unchanged:true,config_inventory_exact:true,identity_unchanged:true,ports_limits_image_readiness_unchanged:true,new_helper_sha256:expected.new_sha256,installer_body_deferred_until_guarded_reinstall:true};s.profile=profile;s.runtime=receipt;save();
fs.writeFileSync('artifacts/game-parity-20261029/css-wave7-fixture-delta.json',JSON.stringify(s.fixture_update,null,2)+'\n');console.log(JSON.stringify(s.fixture_update.after));
