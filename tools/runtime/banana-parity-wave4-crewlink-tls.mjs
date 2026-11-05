// Optional HTTPS control test with a disposable local CA/leaf in the owned volume.
// No browser, system trust changes, private-key output or disabled TLS validation.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {runtime,api,docker,digest,verifyRuntime,activeLease,observePower} from './campaign-native-20261029.mjs';
const file=path.join(runtime,'banana-wave4-crewlink/state.json'),state=JSON.parse(fs.readFileSync(file));
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');
activeLease(state.lease.lease_id,'crewlink_native_banana');await verifyRuntime();
const uuid=state.fixture.server.uuid,base='/api/client/servers/'+uuid,phase=process.argv[2];
async function certificate(){const response=await fetch('http://127.0.0.1:18099'+base+'/files/contents?file=%2Fcrewlink%2Ffullchain.pem');if(!response.ok)throw Error('Owned public certificate unavailable');return response.text();}
if(phase==='create'){
 if(state.tls?.created)throw Error('Keep existing fixture certificate; do not replace it');
 if((await observePower(state.fixture)).current_state!=='running')throw Error('Running owned container required for local certificate generation');
 const variables=(await api(base+'/startup')).data.map(entry=>entry.attributes);
 state.tls={original_environment:Object.fromEntries(['HTTPS','SSLPATH'].map(key=>{const row=variables.find(v=>v.env_variable===key);if(typeof row?.server_value!=='string')throw Error('Original startup value unavailable');return [key,row.server_value];}))};save();
 docker(['exec',uuid,'sh','-c','test ! -e /home/container/crewlink/privkey.pem && test ! -e /home/container/crewlink/fullchain.pem']);
 docker(['exec',uuid,'openssl','req','-x509','-newkey','rsa:2048','-sha256','-days','1','-nodes','-keyout','/home/container/crewlink/privkey.pem','-out','/home/container/crewlink/fullchain.pem','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost']);
 state.tls.created=true;state.tls.created_at=new Date().toISOString();state.tls.certificate_sha256=digest(await certificate());state.tls.key_mode=docker(['exec',uuid,'stat','-c','%a %u:%g','/home/container/crewlink/privkey.pem']).trim();save();if(!state.tls.key_mode.startsWith('600 '))throw Error('Fixture private key is not mode0600');console.log(JSON.stringify({created:true,certificate_sha256:state.tls.certificate_sha256,key_mode:state.tls.key_mode}));
}else if(phase==='enable'||phase==='restore'){
 if(!state.tls?.created)throw Error('Owned certificate fixture required');if((await observePower(state.fixture)).current_state!=='offline')throw Error('Stop before changing HTTPS startup controls');
 const environment=phase==='enable'?{HTTPS:'false',SSLPATH:'crewlink'}:state.tls.original_environment;
 await api('/api/application/servers/'+state.fixture.server.id+'/startup','PATCH',{environment});state.tls.configured=phase==='enable';state.tls.changed_at=new Date().toISOString();save();console.log(JSON.stringify({phase,environment}));
}else if(phase==='probe'){
 if(!state.tls?.configured)throw Error('Expected the native HTTPS control to be active');const ca=await certificate();if(digest(ca)!==state.tls.certificate_sha256)throw Error('Fixture public certificate changed');
 const proof=await new Promise((resolve,reject)=>{const request=https.get('https://127.0.0.1:'+state.lease.ports[0]+'/health',{ca,timeout:5000},response=>{const tls={authorized:response.socket.authorized,protocol:response.socket.getProtocol()};let body='';response.on('data',chunk=>{body+=chunk;if(body.length>65536)request.destroy(Error('Unexpected health response size'));});response.on('end',()=>{try{resolve({status:response.statusCode,...tls,body:JSON.parse(body)});}catch(error){reject(error);}});});request.on('error',reject);request.on('timeout',()=>request.destroy(Error('TLS health timeout')));});
 state.tls.proof={at:new Date().toISOString(),...proof,fixture_ca_only:true,system_trust_changed:false,certificate_validation_disabled:false,original_nonempty_false_semantics:true};save();if(proof.status!==200||!proof.authorized||proof.body.name!=='My BetterCrewLink'||!proof.body.address.startsWith('https:'))throw Error('Native HTTPS behavior did not match source controls');console.log(JSON.stringify(state.tls.proof));
}else throw Error('Use create|enable|probe|restore.');
