// Native SRB2 packet-version5 server discovery, no client join or game assets.
// Wire layout: official STJr/SRB2 commit8701ef41, src/netcode/protocol.h,
// server_connection.c and d_net.c. Pure parser fixtures are not runtime proof.
import dgram from 'node:dgram';import path from 'node:path';import {fileURLToPath} from 'node:url';
export function checksum(packet){let value=0x01234567;for(let i=4;i<packet.length;i++)value=(value+packet[i]*(i-3))>>>0;return value;}
export function askInfo(time){const packet=Buffer.alloc(13);packet[6]=12;packet[8]=202;packet.writeUInt32LE(time>>>0,9);packet.writeUInt32LE(checksum(packet));return packet;}
export function parseInfo(packet,time){
 if(packet.length<414||packet[6]!==13||packet.readUInt32LE(0)!==checksum(packet))throw Error('Invalid SRB2 server-info packet');
 const body=packet.subarray(8),text=(offset,size)=>body.subarray(offset,offset+size).toString('utf8').split('\0')[0];
 if(body[0]!==255||body[1]!==5||text(2,16)!=='SRB2'||body.readUInt32LE(51)!==(time>>>0))throw Error('SRB2 discovery identity or echoed challenge mismatch');
 return {protocol:5,application:'SRB2',version:`${Math.floor(body[18]/100)}.${body[18]%100}.${body[19]}`,players:body[20],maxplayers:body[21],refuse_reason:body[22],gametype:text(23,24),modified:body[47]!==0,cheats:body[48]!==0,dedicated:(body[49]&64)!==0,name:text(59,32),map:text(91,8),map_title:text(99,33),level_ticks:body.readUInt32LE(55),player_join_verified:false,join_password_verified:false};
}
export async function query(host,port){
 if(!host||!Number.isInteger(port)||port<1||port>65535)throw Error('Specify host and valid UDP port');
 const socket=dgram.createSocket('udp4'),time=Date.now()>>>0,start=Date.now();
 return new Promise((resolve,reject)=>{let done=false;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);socket.close();error?reject(error):resolve(value);};const timer=setTimeout(()=>finish(Error('Native SRB2 discovery timed out')),3000);
 socket.on('error',error=>finish(error));socket.on('message',packet=>{if(packet[6]!==13)return;try{finish(null,{...parseInfo(packet,time),ping:Date.now()-start,observed_at:new Date().toISOString()});}catch(error){finish(error);}});socket.connect(port,host,()=>socket.send(askInfo(time),error=>{if(error)finish(error);}));});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await query(process.argv[2],Number(process.argv[3]))));
