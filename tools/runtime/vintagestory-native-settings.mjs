import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {runtime,verifyRuntime,api,activeLease,createReaderFixture,readerRequest,removeReaderFixture,digest} from './campaign-native-20261029.mjs';
const dir=path.resolve('.local/game-parity-20261029/vintagestory-native'),state=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));
if(state.paused||JSON.parse(fs.readFileSync(runtime+'/queue.json')).activation_pause)throw Error('Campaign activation pause');
const receipt=await verifyRuntime();assert.equal(receipt.binary_sha256,state.runtime.binary_sha256);activeLease(state.lease.lease_id,'vintagestory_native');
const base='/api/client/servers/'+state.fixture.server.uuid,p='/data/serverconfig.json',route=base+'/game-settings?file='+encodeURIComponent(p);
const raw=async(method,body)=>fetch('http://127.0.0.1:18099'+route,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
const read=async()=>Buffer.from(await(await fetch('http://127.0.0.1:18099'+base+'/files/contents?file='+encodeURIComponent(p))).arrayBuffer());
const view=async()=>(await api(route)).attributes;
const before=await read(),initial=await view(),proof={at:new Date().toISOString(),backend_pid:receipt.pid,before_sha256:digest(before),checks:[]};
const offline=(await api(base+'/resources')).attributes.current_state==='offline';
const phase=process.argv[2];
if(phase==='roundtrip'){
 assert.ok(offline,'Stopped typed settings required');fs.writeFileSync(path.join(dir,'settings-original.json'),before);
 for(const key of ['/ServerDescription','/ServerUrl'])assert.equal(initial.fields.find(f=>f.key===key)?.value,'');
 for(const key of ['/Port','/MaxClients'])assert.equal(initial.fields.find(f=>f.key===key)?.readonly,true);
 const pass='native-fixture-'+crypto.randomBytes(12).toString('hex');
 const changes={'/ServerName':'Vintage typed native $safe','/ServerDescription':'Owned native description','/ServerUrl':'https://example.invalid/vintage','/Password':pass};
 for(const [key,value]of Object.entries(changes)){const field=initial.fields.find(f=>f.key===key);assert.ok(field&&!field.readonly,'Editable native field '+key);assert.equal(typeof value,'string');}
 let r=await raw('PUT',{revision:initial.revision,settings:changes});assert.equal(r.status,200,'Typed scalar write');
 const after=await read(),document=JSON.parse(after);for(const [key,value]of Object.entries(changes))assert.equal(document[key.slice(1)],value);
 const masked=await view(),password=masked.fields.find(f=>f.key==='/Password');assert.equal(password.secret,true);assert.equal(password.value,null);assert.equal(password.configured,true);assert.ok(!JSON.stringify(masked).includes(pass));
 const unknown=JSON.parse(before),actual=JSON.parse(after);for(const key of Object.keys(changes)){delete unknown[key.slice(1)];delete actual[key.slice(1)];}assert.deepEqual(actual,unknown,'Unrelated native JSON semantic values');
 r=await raw('PUT',{revision:initial.revision,settings:{'/ServerName':'stale refusal'}});assert.equal(r.status,409);proof.checks.push({name:'stale revision',status:r.status});
 for(const key of ['/Port','/MaxClients']){r=await raw('PUT',{revision:masked.revision,settings:{[key]:'42'}});assert.equal(r.status,422);proof.checks.push({name:'managed '+key,status:r.status});}
 assert.ok((await read()).equals(after),'Rejected writes preserve bytes');
 r=await raw('PUT',{revision:masked.revision,settings:{'/Password':''}});assert.equal(r.status,200);const cleared=await view();assert.equal(cleared.fields.find(f=>f.key==='/Password').configured,false);assert.equal(JSON.parse(await read()).Password,'');
 proof.after_sha256=digest(await read());proof.password_set_mask_clear=true;proof.unrelated_semantic_values_preserved=true;proof.formatting_boundary='Shared JSON patch serialization is not claimed byte-preserving.';proof.public_values=Object.fromEntries(Object.entries(changes).filter(([k])=>k!=='/Password'));
 fs.writeFileSync(path.join(dir,'settings-roundtrip.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}else if(phase==='running-refusal'){
 assert.ok(!offline,'Running server required');const r=await raw('PUT',{revision:initial.revision,settings:{'/ServerName':'must refuse while running'}});assert.equal(r.status,409);assert.ok((await read()).equals(before));proof.checks.push({name:'running typed write refused',status:r.status});fs.writeFileSync(path.join(dir,'settings-running-refusal.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}else if(phase==='permissions'){
 assert.ok(offline);let fixture;const save=f=>{fixture=f;fs.writeFileSync(path.join(dir,'reader.json'),JSON.stringify(f,null,2));};
 try{fixture=await createReaderFixture({server:state.fixture.server,lease:state.lease},save);proof.identity_boundary=fixture.identity_boundary;
  for(const [name,endpoint,method,body,expected]of[
   ['reader settings',route,'GET',undefined,200],['reader settings write',route,'PUT',{revision:initial.revision,settings:{'/ServerName':'forbidden'}},403],
   ['reader power',base+'/power','POST',{signal:'start'},403],['reader console',base+'/command','POST',{command:'/help'},403]]){
   const r=await readerRequest(fixture,endpoint,method,body);await r.text();assert.equal(r.status,expected,name);proof.checks.push({name,status:r.status});
  }
  const r=await fetch('http://127.0.0.1:18100/api/servers/'+state.fixture.server.uuid);await r.text();assert.equal(r.status,401);proof.checks.push({name:'unauthenticated Wings',status:r.status});assert.ok((await read()).equals(before));
 }finally{if(fixture?.user&&!fixture.user_removed)await removeReaderFixture(fixture,save);proof.reader_removed=fixture?.user_removed===true;fs.writeFileSync(path.join(dir,'permissions.json'),JSON.stringify(proof,null,2));}
 console.log(JSON.stringify(proof));
}else throw Error('Use roundtrip|running-refusal|permissions');
