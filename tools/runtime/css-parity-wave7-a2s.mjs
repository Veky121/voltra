import fs from 'node:fs';import path from 'node:path';import dgram from 'node:dgram';
import {runtime,verifyRuntime,activeLease} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'css-native'),s=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));await verifyRuntime();activeLease(s.lease.lease_id,'css_native');if(!s.fixture?.server)throw Error('Owned CSS fixture required');
const socket=dgram.createSocket('udp4'),base=Buffer.concat([Buffer.from('ffffffff54','hex'),Buffer.from('Source Engine Query\0')]);
const packets=[],wrong=process.argv[2]==='wrong-challenge';let challengeUsed=false;
const reply=await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{socket.close();reject(Error('Native CSS A2S timed out'));},5000);
 socket.on('error',error=>{clearTimeout(timer);socket.close();reject(error);});
 socket.on('message',(data,peer)=>{
  if(peer.address!=='127.0.0.1'||peer.port!==s.lease.ports[0])return;
  packets.push({bytes:data.length,type:data[4],prefix:data.subarray(0,9).toString('hex')});
  if(data.length>=9&&data.subarray(0,5).equals(Buffer.from('ffffffff41','hex'))&&!challengeUsed){challengeUsed=true;socket.send(Buffer.concat([base,data.subarray(5,9)]),peer.port,peer.address);return;}
  clearTimeout(timer);socket.close();resolve(data);
 });
 socket.send(wrong?Buffer.concat([base,Buffer.from('78563412','hex')]):base,s.lease.ports[0],'127.0.0.1');
});
if(reply.length<6||!reply.subarray(0,5).equals(Buffer.from('ffffffff49','hex')))throw Error('Unsupported native A2S reply');
let cursor=6;const cstring=()=>{const end=reply.indexOf(0,cursor);if(end<cursor||end-cursor>512)throw Error('Malformed bounded A2S string');const value=reply.toString('utf8',cursor,end);cursor=end+1;return value;};
const info={protocol:reply[5],name:cstring(),map:cstring(),folder:cstring(),game:cstring()};if(reply.length<cursor+9)throw Error('Truncated A2S fields');
Object.assign(info,{app_id:reply.readUInt16LE(cursor),players:reply[cursor+2],maximum:reply[cursor+3],bots:reply[cursor+4],server_type:String.fromCharCode(reply[cursor+5]),environment:String.fromCharCode(reply[cursor+6]),password:!!reply[cursor+7],vac:!!reply[cursor+8]});cursor+=9;info.version=cstring();
const result={at:new Date().toISOString(),server_uuid:s.fixture.server.uuid,host:'127.0.0.1',port:s.lease.ports[0],wrong_challenge_test:wrong,challenge_used:challengeUsed,packets,info,player_authenticated:false,gameplay:false};
fs.writeFileSync(path.join(dir,'a2s-'+Date.now()+'.json'),JSON.stringify(result,null,2)+'\n');fs.writeFileSync('artifacts/game-parity-20261029/css-wave7-a2s'+(wrong?'-challenge':'')+'.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
if(info.app_id!==240||info.folder!=='cstrike'||info.map!=='de_dust2'||info.maximum!==24||info.password)throw Error('A2S differs from original default CSS setup');
