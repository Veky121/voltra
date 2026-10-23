// Stateless native offline ping; this never opens a gameplay connection.
// Wire reference: facebookarchive/RakNet/Source/RakPeer.cpp, Ping and
// ProcessOfflineNetworkPacket. Time width is configurable in native builds.
import dgram from 'node:dgram';import {lookup} from 'node:dns/promises';import {randomBytes,createHash} from 'node:crypto';
const [host,text]=process.argv.slice(2),port=Number(text);
if(!host||!Number.isInteger(port)||port<1||port>65535)throw Error('Usage: raknet.mjs HOST PORT');
const {address}=await lookup(host,{family:4});
const magic=Buffer.from('00ffff00fefefefefdfdfdfd12345678','hex');
async function probe(width){
 const socket=dgram.createSocket('udp4'),timestamp=randomBytes(width),guid=randomBytes(8);
 const request=Buffer.concat([Buffer.from([1]),timestamp,magic,guid]);
 const started=performance.now();
 return await new Promise((resolve,reject)=>{
  let finished=false;
  const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);socket.close();error?reject(error):resolve(result);};
  const timer=setTimeout(()=>finish(Error('No matching native RakNet pong')),2000);
  socket.on('error',error=>finish(error));
  socket.on('message',(packet,peer)=>{
   const offset=1+width+8;
   if(peer.address!==address||peer.port!==port||packet.length<offset+magic.length||packet[0]!==0x1c||!packet.subarray(1,1+width).equals(timestamp)||!packet.subarray(offset,offset+magic.length).equals(magic))return;
   const metadata=packet.subarray(offset+magic.length);
   finish(null,{protocol:'RakNet offline ping',address,port,time_bytes:width,reply_bytes:packet.length,metadata_bytes:metadata.length,metadata_sha256:createHash('sha256').update(metadata).digest('hex'),latency_ms:Math.round(performance.now()-started),player_join_verified:false});
  });
  socket.send(request,port,address,error=>{if(error)finish(error);});
 });
}
let result;
for(const width of [8,4]){try{result=await probe(width);break;}catch(error){if(error.message!=='No matching native RakNet pong')throw error;}}
if(!result)throw Error('Native RakNet discovery did not reply to either supported timestamp width');
console.log(JSON.stringify(result));
