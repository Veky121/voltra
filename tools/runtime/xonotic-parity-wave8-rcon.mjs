// Run with node --openssl-legacy-provider. Native protocol: pinned DarkPlaces
// netconn.c 0.8.6, srcon HMAC-MD4 CHALLENGE. Credential remains in memory.
import fs from 'node:fs';import path from 'node:path';import dgram from 'node:dgram';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {runtime,verifyRuntime,activeLease} from './campaign-native-20261029.mjs';
assert.equal(crypto.createHash('md4').update('').digest('hex'),'31d6cfe0d16ae931b73c59d7e0c089c0');
const s=JSON.parse(fs.readFileSync(path.join(runtime,'xonotic-native/state.json'))),receipt=await verifyRuntime();activeLease(s.lease.lease_id,'xonotic_native');assert(s.fixture?.server);
const secret=await fetch('http://127.0.0.1:18099/api/client/servers/'+s.fixture.server.uuid+'/files/contents?file=%2F.voltra%2Fxonotic%2Frcon-password');assert.equal(secret.status,200);const password=await secret.text();assert(password&&Buffer.byteLength(password)<=127&&!/\s/.test(password));
const wire=Buffer.from('ffffffff','hex'),port=s.lease.ports[0];
async function command(key,text){
 const socket=dgram.createSocket('udp4');let stage='challenge';const received=[];
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.close();resolve({response:received.join(''),challenge_used:stage==='response',timeout:true});},1600);
  socket.on('error',e=>{clearTimeout(timer);socket.close();reject(e);});
  socket.on('message',(packet,peer)=>{
   if(peer.address!=='127.0.0.1'||peer.port!==port||!packet.subarray(0,4).equals(wire))return;
   if(stage==='challenge'){
    const prefix=Buffer.concat([wire,Buffer.from('challenge ')]);if(!packet.subarray(0,prefix.length).equals(prefix))return;
    let value=packet.subarray(prefix.length),nul=value.indexOf(0);if(nul>=0)value=value.subarray(0,nul);if(!value.length||value.length>128||value.some(x=>x<=32||x>126))return;
    const message=Buffer.concat([value,Buffer.from(' '+text)]),digest=crypto.createHmac('md4',key).update(message).digest();stage='response';socket.send(Buffer.concat([wire,Buffer.from('srcon HMAC-MD4 CHALLENGE '),digest,Buffer.from(' '),message]),port,'127.0.0.1');
   }else{
    const body=packet.subarray(packet[4]===110?5:4).toString('utf8').replaceAll(password,'[redacted]');received.push(body);
   }
  });
  socket.send(Buffer.concat([wire,Buffer.from('getchallenge')]),port,'127.0.0.1');
 });
}
const marker='voltra_rcon_'+crypto.randomBytes(6).toString('hex'),bad=await command('invalid-native-acceptance-password','echo '+marker+'_denied');
assert(bad.challenge_used,'Negative probe did not reach actual native challenge');assert(!bad.response.includes(marker+'_denied'),'Wrong RCON credential executed its command');
await new Promise(r=>setTimeout(r,1100));
const good=await command(password,'echo '+marker+'_allowed');assert(good.challenge_used&&good.response.includes(marker+'_allowed'),'Correct secure RCON command was not observed');
await new Promise(r=>setTimeout(r,1100));const secure=await command(password,'rcon_secure');assert(/rcon_secure[^\r\n]*[" ]2[" ]/.test(secure.response),'Actual secure RCON mode2 not confirmed');
const report={at:new Date().toISOString(),backend:receipt.binary_sha256,server_uuid:s.fixture.server.uuid,protocol:'Publisher srcon HMAC-MD4 CHALLENGE; binary16-byte HMAC, exact challenge+command',publisher_source:'https://gitlab.com/xonotic/darkplaces/-/raw/xonotic-v0.8.6/netconn.c',native_md4_rfc1320_vector:true,wrong_password_command_not_executed:true,correct_password_marker_received:true,native_secure_mode:2,credential_logged:false,negative_response:bad.response,secure_response:secure.response};
const target=path.join(runtime,'xonotic-native','rcon-'+Date.now()+'.json');fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,evidence:target}));
