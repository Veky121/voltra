import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import {runtime,verifyRuntime,activeLease,observePower,digest} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'banana-wave10-etlegacy'),file=path.join(dir,'state.json'),s=JSON.parse(fs.readFileSync(file));
await verifyRuntime();const lease=activeLease(s.lease.lease_id,'etlegacy_native_banana');if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Activation paused');if((await observePower(s.fixture)).current_state!=='running')throw Error('Owned native server must run');
const privateValues=JSON.parse(fs.readFileSync(path.join(dir,'fixture-native-secrets.json')));
async function command(password){const socket=dgram.createSocket('udp4');return await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{socket.close();reject(Error('Native RCON timeout'));},6000);socket.on('error',()=>{clearTimeout(timeout);socket.close();reject(Error('Native RCON socket failure'));});socket.on('message',(packet,remote)=>{if(remote.address!=='127.0.0.1'||remote.port!==lease.ports[0]||packet.length>16384||!packet.subarray(0,10).equals(Buffer.concat([Buffer.from([255,255,255,255]),Buffer.from('print\n')])))return;clearTimeout(timeout);socket.close();resolve(packet.subarray(10).toString('utf8'));});socket.send(Buffer.concat([Buffer.from([255,255,255,255]),Buffer.from('rcon '+password+' status\n')]),lease.ports[0],'127.0.0.1');});}
const bad=await command('fixture-definitely-wrong-rcon');await new Promise(r=>setTimeout(r,1500));const good=await command(privateValues.rcon);
const capture=path.join(dir,'rcon-response-'+Date.now()+'.json');fs.writeFileSync(capture,JSON.stringify({bad,good},null,2)+'\n',{mode:0o600});
if(!/bad rconpassword|invalid password|incorrect password/i.test(bad)||!/map\s*:\s*(oasis|goldrush)/i.test(good))throw Error('Native RCON authorization result unproven');
if(Object.values(privateValues).some(value=>bad.includes(value)||good.includes(value)))throw Error('RCON response exposed fixture credential');
s.rcon={at:new Date().toISOString(),port:lease.ports[0],wrong_password_rejected:true,valid_password_status:true,bad_response_sha256:digest(bad),good_response_sha256:digest(good),credentials_absent:true};fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');console.log(JSON.stringify(s.rcon));
