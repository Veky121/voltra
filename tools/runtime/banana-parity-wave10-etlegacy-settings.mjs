import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {runtime,api,digest,verifyRuntime,activeLease,observePower,createReaderFixture,readerRequest,removeReaderFixture} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'banana-wave10-etlegacy'),file=path.join(dir,'state.json'),s=JSON.parse(fs.readFileSync(file));
const save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');
await verifyRuntime();activeLease(s.lease.lease_id,'etlegacy_native_banana');if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Activation paused');
const base='/api/client/servers/'+s.fixture.server.uuid,route=base+'/game-settings?file=%2Fetlegacy%2Fuserdata%2Flegacy%2Fvoltra-native.cfg',phase=process.argv[2];
async function raw(url,method='GET',body,headers={}){const r=await fetch('http://127.0.0.1:18099'+url,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();return {status:r.status,text,data:text?JSON.parse(text):null};}
async function bytes(){const r=await fetch('http://127.0.0.1:18099'+base+'/files/contents?file=%2Fetlegacy%2Fuserdata%2Flegacy%2Fvoltra-native.cfg');if(!r.ok)throw Error('Native file unavailable');return Buffer.from(await r.arrayBuffer());}
async function view(){const v=(await api(route)).attributes;if(v.file!=='/etlegacy/userdata/legacy/voltra-native.cfg')throw Error('Unexpected native document');return v;}
function checkMask(v){for(const key of ['g_password','rconpassword','sv_privatepassword','refereepassword','shoutcastpassword']){const f=v.fields.find(f=>f.key===key);if(!f?.secret||f.value!=null)throw Error('Native credential is not masked: '+key);}}
if(phase==='inspect'){
 const v=await view();checkMask(v);s.settings={at:new Date().toISOString(),file:v.file,revision:v.revision,fields:v.fields.map(f=>({key:f.key,type:f.type,secret:f.secret,readonly:f.readonly})),switches:v.fields.filter(f=>f.type==='boolean').length};save();console.log(JSON.stringify(s.settings));
}else if(phase==='edit'){
 if((await observePower(s.fixture)).current_state!=='offline')throw Error('Stop before settings edit');if(s.config_edit)throw Error('Original edit checkpoint retained');
 const v=await view();checkMask(v);const secrets={password:crypto.randomBytes(16).toString('hex'),rcon:crypto.randomBytes(16).toString('hex')};const privateFile=path.join(dir,'fixture-native-secrets.json');if(fs.existsSync(privateFile))throw Error('Private fixture values already exist');fs.writeFileSync(privateFile,JSON.stringify(secrets),{mode:0o600});
 const settings={sv_hostname:'Voltra ET Native Parity',sv_maxclients:'12',g_friendlyfire:false,g_password:secrets.password,rconpassword:secrets.rcon};
 const r=await api(route,'PUT',{revision:v.revision,settings});const data=await bytes();fs.writeFileSync(path.join(dir,'native-config-checkpoint.cfg'),data,{mode:0o600});
 s.config_edit={at:new Date().toISOString(),previous_revision:v.revision,revision:r.attributes?.revision,sha256:digest(data),hostname:settings.sv_hostname,maxclients:12,friendly_fire:false,password_set:true,rcon_set:true};save();console.log(JSON.stringify(s.config_edit));
}else if(phase==='guards'){
 if((await observePower(s.fixture)).current_state!=='offline')throw Error('Stopped native fixture required');const v=await view(),before=digest(await bytes()),checks=[];
 for(const [key,value]of [['net_port','29199'],['dedicated','2'],['exec','other.cfg'],['g_friendlyfire','0'],['g_password','bad\nquit'],['sv_maxclients','999']]){
  const r=await raw(route,'PUT',{revision:v.revision,settings:{[key]:value}});checks.push({key,status:r.status});if(r.status!==422)throw Error('Unsafe native edit accepted: '+key);
 }
 const stale=await raw(route,'PUT',{revision:s.config_edit?.previous_revision||'0'.repeat(64),settings:{g_friendlyfire:true}});if(stale.status!==409)throw Error('Stale revision accepted');
 if(digest(await bytes())!==before)throw Error('Rejected settings mutated native bytes');s.guards={at:new Date().toISOString(),checks,stale:stale.status,exact_bytes:true};save();console.log(JSON.stringify(s.guards));
}else if(phase==='permissions'){
 const before=digest(await bytes());
 try{s.reader=await createReaderFixture(s.fixture,async reader=>{s.reader=reader;save();});save();const r=await readerRequest(s.reader,route),v=(await r.json()).attributes;if(r.status!==200||!v)throw Error('Real reader GET failed');checkMask(v);const write=await readerRequest(s.reader,route,'PUT',{revision:v.revision,settings:{g_friendlyfire:true}});if(write.status!==403||digest(await bytes())!==before)throw Error('Reader write changed native data');s.permissions={at:new Date().toISOString(),read:r.status,write:write.status,credentials_masked:true,exact_bytes:true,boundary:s.reader.identity_boundary};save();console.log(JSON.stringify(s.permissions));}
 finally{if(s.reader?.user)await removeReaderFixture(s.reader,async reader=>{s.reader=reader;save();});}
}else if(phase==='preserved'){
 const v=await view();checkMask(v);const actual=digest(await bytes());if(actual!==s.config_edit?.sha256)throw Error('Native settings checkpoint changed');s.config_preservation??=[];s.config_preservation.push({at:new Date().toISOString(),sha256:actual,exact:true});save();console.log(JSON.stringify(s.config_preservation.at(-1)));
}else throw Error('Use inspect|edit|guards|permissions|preserved');
