import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {runtime,verifyRuntime,api,activeLease,digest} from './campaign-native-20261029.mjs';
const dir=path.resolve('.local/game-parity-20261029/openarena-native'),s=JSON.parse(fs.readFileSync(path.join(dir,'state.json'))),base='/api/client/servers/'+s.fixture.server.uuid;
if(s.paused||JSON.parse(fs.readFileSync(runtime+'/queue.json')).activation_pause)throw Error('Campaign pause');const receipt=await verifyRuntime();assert.equal(receipt.binary_sha256,s.runtime.binary_sha256);activeLease(s.lease.lease_id,'openarena_native');assert.equal((await api(base+'/resources')).attributes.current_state,'offline');
const vars=(await api(base+'/startup')).data.map(x=>x.attributes);assert.equal(vars.filter(v=>v.env_variable==='GAME_MOD').length,1);assert.equal(vars.find(v=>v.env_variable==='GAME_MOD').server_value,'baseoa');
const basePath='/openarena/userdata/baseoa/server.cfg',missionPath='/openarena/userdata/missionpack/server.cfg',endpoint=file=>base+'/game-settings?file='+encodeURIComponent(file);
async function contents(file){const r=await fetch('http://127.0.0.1:18099'+base+'/files/contents?file='+encodeURIComponent(file));assert.equal(r.status,200);return Buffer.from(await r.arrayBuffer());}
const original=await contents(basePath),initial=(await api(endpoint(basePath))).attributes;assert.equal(initial.file,basePath);
const folders=(await api(base+'/files/list?directory=%2Fopenarena%2Fuserdata')).data.map(x=>x.attributes);const folder=folders.find(x=>x.name==='missionpack');if(folder)assert.equal(folder.is_file,false);else await api(base+'/files/create-folder','POST',{root:'/openarena/userdata',name:'missionpack'});
const entries=(await api(base+'/files/list?directory=%2Fopenarena%2Fuserdata%2Fmissionpack')).data.map(x=>x.attributes);let created=false;
if(!entries.some(x=>x.name==='server.cfg')){const data=Buffer.concat([original,Buffer.from('// Owned inactive-module fixture\r\n')]),r=await fetch('http://127.0.0.1:18099'+base+'/files/write?file='+encodeURIComponent(missionPath),{method:'POST',body:data});assert.equal(r.status,204);created=true;}
const missionBefore=await contents(missionPath),proof={at:new Date().toISOString(),backend_pid:receipt.pid,created_inactive_fixture:created,base_before_sha256:digest(original),mission_before_sha256:digest(missionBefore),native_missionpack_boot:false,checks:[]};
let missionAfter=missionBefore;
try{
 await api(base+'/startup/variable','PUT',{key:'GAME_MOD',value:'missionpack'});
 const inventory=(await api(base+'/game-settings?inventory=all')).attributes;assert.ok(inventory.documents.some(d=>d.path===missionPath));assert.ok(!inventory.documents.some(d=>d.path===basePath));
 const selected=(await api(base+'/game-settings')).attributes;assert.equal(selected.file,missionPath);proof.mission_selected_default=selected.file;
 const inactive=await fetch('http://127.0.0.1:18099'+endpoint(basePath));await inactive.text();assert.equal(inactive.status,404);proof.checks.push({name:'inactive baseoa GET',status:inactive.status});
 const rejected=await fetch('http://127.0.0.1:18099'+endpoint(basePath),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:initial.revision,settings:{fraglimit:'99'}})});await rejected.text();assert.equal(rejected.status,404);proof.checks.push({name:'inactive baseoa PUT',status:rejected.status});
 assert.ok((await contents(basePath)).equals(original));
 if(created){await api(endpoint(missionPath),'PUT',{revision:selected.revision,settings:{timelimit:'7.5'}});missionAfter=await contents(missionPath);const readback=(await api(endpoint(missionPath))).attributes;assert.equal(String(readback.fields.find(f=>f.key==='timelimit')?.value),'7.5');proof.active_mission_scalar_edit=true;}
}finally{await api(base+'/startup/variable','PUT',{key:'GAME_MOD',value:'baseoa'});}
const final=(await api(base+'/game-settings')).attributes;assert.equal(final.file,basePath);assert.ok((await contents(basePath)).equals(original));assert.ok((await contents(missionPath)).equals(missionAfter));proof.base_selected_after_restore=final.file;proof.inactive_files_preserved=true;proof.mission_after_sha256=digest(missionAfter);proof.scope='Live API selection/typed-file authority only; no missionpack engine or gameplay claim.';fs.writeFileSync(path.join(dir,'module-selection.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
