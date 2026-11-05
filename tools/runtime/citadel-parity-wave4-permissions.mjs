import fs from 'node:fs';
import path from 'node:path';
import {runtime,verifyRuntime,api,activeLease,observePower,createReaderFixture,readerRequest,removeReaderFixture} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'citadel-wave4'),s=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));
await verifyRuntime();activeLease(s.lease.lease_id,'citadel_native');const a=(await api('/api/application/servers/'+s.server.id)).attributes;if(a.uuid!==s.server.uuid||a.egg!==s.egg.id||(await observePower(s)).current_state!=='offline')throw Error('Stopped owned Citadel fixture required');
const endpoint='/api/client/servers/'+s.server.uuid+'/game-settings?file=%2FConfig%2FGame.ini',statePath=path.join(dir,'reader.json');let fixture;
if(fs.existsSync(statePath)&&!JSON.parse(fs.readFileSync(statePath)).user_removed)throw Error('Existing reader requires scoped cleanup');
const save=f=>{fixture=f;fs.writeFileSync(statePath,JSON.stringify(f,null,2)+'\n');};
const proof={at:new Date().toISOString(),backend_pid:(await verifyRuntime()).pid,checks:[]};
try{
 fixture=await createReaderFixture(s,save);proof.identity_boundary=fixture.identity_boundary;
 const initial=await api(endpoint),field=initial.attributes.fields.find(f=>f.key==='/Script/Citadel.CitadelGameInstance/WorldCreationSettings/ServerName');if(!field||field.secret)throw Error('Safe scalar field not found');
 async function check(name,method,settings,expect){const response=await readerRequest(fixture,endpoint,method,settings===undefined?undefined:{revision:initial.attributes.revision,settings});const body=await response.json();proof.checks.push({name,status:response.status,expect,pass:response.status===expect});if(response.status!==expect)throw Error(name+' unexpected status '+response.status);return body;}
 await check('read-only member GET','GET',undefined,200);
 await check('read-only member PUT','PUT',{[field.key]:field.value},403);
 await api('/api/client/servers/'+s.server.uuid+'/users/'+fixture.user.uuid,'POST',{permissions:[]});fixture.permissions=[];save(fixture);
 await check('member without read permission GET','GET',undefined,403);
 await api('/api/client/servers/'+s.server.uuid+'/users/'+fixture.user.uuid,'POST',{permissions:['file.read','file.read-content','file.update']});fixture.permissions=['file.read','file.read-content','file.update'];save(fixture);
 await check('granted file.update idempotent PUT','PUT',{[field.key]:field.value},200);
 const after=await api(endpoint);proof.native_revision_unchanged=initial.attributes.revision===after.attributes.revision;if(!proof.native_revision_unchanged)throw Error('Idempotent write changed native bytes');
}finally{
 if(fixture?.user&&!fixture.user_removed)await removeReaderFixture(fixture,save);
 if(fixture?.user){const response=await fetch('http://127.0.0.1:18099/api/application/users/'+fixture.user.id);await response.text();proof.account_removed=response.status===404;proof.subuser_removed=fixture.subuser_removed===true;}
 fs.writeFileSync(path.join(dir,'permissions.json'),JSON.stringify(proof,null,2)+'\n');
}
if(!proof.account_removed||!proof.subuser_removed)throw Error('Owned reader cleanup incomplete');console.log(JSON.stringify(proof));
