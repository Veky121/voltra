// Root-authorized temporary nonadmin bearer fixture. Never changes first-run
// setup or a real account. Token stays in memory; SQL stores only its SHA-256.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {runtime,verifyRuntime,activeLease,observePower} from './campaign-native-20261029.mjs';

const dir=path.join(runtime,'tachyon-native'),state=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));
const active=await verifyRuntime();activeLease(state.lease.lease_id,'tachyon_native');
if((await observePower(state.fixture)).current_state!=='offline')throw Error('Stopped Tachyon fixture required');
const sid=Number(state.fixture.server.id),serverUUID=state.fixture.server.uuid;
if(!Number.isSafeInteger(sid)||sid<1||!/^[a-f0-9-]{36}$/.test(serverUUID))throw Error('Unsafe fixture identity');
const endpoint='http://127.0.0.1:18099/api/client/servers/'+serverUUID+'/game-settings?file=%2Ftachyon%2Fconfig.cfg';
const baseline=await fetch(endpoint);if(baseline.status!==200)throw Error('Typed Tachyon route not active; no permission fixture created');
const baselineData=await baseline.json();if(!baselineData.attributes.fields.some(field=>field.key==='AUTOSAVE_TIME'))throw Error('Expected typed Tachyon controls');
const uid=crypto.randomUUID(),name='tachyon_accept_'+Date.now(),token=crypto.randomBytes(32).toString('hex'),hash=crypto.createHash('sha256').update(token).digest('hex');
const sql=text=>execFileSync('docker',['--context','desktop-linux','exec','-i','voltra-parity-20261029-postgres','psql','-U','campaign','-d','campaign','-v','ON_ERROR_STOP=1','-tA'],{input:text,encoding:'utf8',windowsHide:true});
if(Number(sql(`SELECT count(*) FROM servers WHERE id=${sid} AND uuid='${serverUUID}' AND node_id=1;`).trim())!==1)throw Error('Owned fixture identity mismatch');
const request=async(method='GET',body)=>{
 const response=await fetch(endpoint,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 let data;try{data=await response.json();}catch{}
 return {status:response.status,data};
};
const report={at:new Date().toISOString(),server_uuid:serverUUID,runtime:{pid:active.pid,binary_sha256:active.binary_sha256},fixture_user_uuid:uid,credential_kind:'temporary canonical client bearer fixture; no browser-login or first-run setup claim',checks:[]};
try{
 sql(`INSERT INTO users(uuid,username,email,root_admin) VALUES('${uid}','${name}','${name}@example.invalid',false); INSERT INTO subusers(user_id,server_id,permissions) SELECT id,${sid},'["file.read-content"]'::jsonb FROM users WHERE uuid='${uid}'; INSERT INTO api_keys(user_id,identifier,token_hash,type,memo) SELECT id,'${name}','${hash}','client','Tachyon bounded native permission fixture' FROM users WHERE uuid='${uid}';`);
 const read=await request();assert.equal(read.status,200);report.checks.push({name:'nonadmin read-only typed GET',status:read.status});
 const view=read.data.attributes;
 const denied=await request('PUT',{revision:view.revision,settings:{AUTOSAVE_TIME:'4'}});assert.equal(denied.status,403);report.checks.push({name:'read-only nonadmin typed PUT denied',status:denied.status});
 sql(`UPDATE subusers SET permissions='[]'::jsonb WHERE server_id=${sid} AND user_id=(SELECT id FROM users WHERE uuid='${uid}');`);
 const noRead=await request();assert.equal(noRead.status,403);report.checks.push({name:'no file permission typed GET denied',status:noRead.status});
 sql(`UPDATE subusers SET permissions='["file.read-content","file.update"]'::jsonb WHERE server_id=${sid} AND user_id=(SELECT id FROM users WHERE uuid='${uid}');`);
 const current=await request();assert.equal(current.status,200);const value=current.data.attributes.fields.find(field=>field.key==='AUTOSAVE_TIME').value;
 const allowed=await request('PUT',{revision:current.data.attributes.revision,settings:{AUTOSAVE_TIME:value}});assert.equal(allowed.status,200);report.checks.push({name:'write-enabled nonadmin idempotent typed patch',status:allowed.status});
 report.success=true;
}catch(error){report.success=false;report.error=String(error.stack||error);throw error;}
finally{
 sql(`DELETE FROM users WHERE uuid='${uid}';`);
 report.cleanup_user_count=Number(sql(`SELECT count(*) FROM users WHERE uuid='${uid}';`).trim());assert.equal(report.cleanup_user_count,0);
 fs.writeFileSync('artifacts/game-parity-20261029/tachyon-wave6-native-permissions.json',JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report));

