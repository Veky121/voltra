import dgram from 'node:dgram';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const MAGIC=Buffer.from('00ffff00fefefefefdfdfdfd12345678','hex');
export function ping(challenge=BigInt(Date.now())){const b=Buffer.alloc(33);b[0]=1;b.writeBigInt64BE(challenge,1);MAGIC.copy(b,9);crypto.randomBytes(8).copy(b,25);return b;}
export function parsePong(b,challenge){
 if(b.length<35||b[0]!==0x1c||b.readBigInt64BE(1)!==challenge||!b.subarray(17,33).equals(MAGIC))throw Error('Invalid RakNet pong header/challenge');
 const length=b.readUInt16BE(33);if(length>4096||b.length!==35+length)throw Error('Invalid RakNet advertisement size');
 const f=b.subarray(35).toString('utf8').split(';');if(f[0]!=='MCPE'||f.length<6||![f[2],f[4],f[5]].every(x=>/^\d+$/.test(x)))throw Error('Invalid Bedrock advertisement');
 return {edition:f[0],name:f[1],protocol:Number(f[2]),version:f[3],players:Number(f[4]),max_players:Number(f[5]),server_id:f[6]||null,sub_motd:f[7]||null,gamemode:f[8]||null,ipv4_port:f[10]?Number(f[10]):null,ipv6_port:f[11]?Number(f[11]):null,authenticated_player_join:false,gameplay_tested:false};
}
export async function query(port,host='127.0.0.1'){
 if(host!=='127.0.0.1'||!Number.isInteger(port)||port<1||port>65535)throw Error('Acceptance query requires owned loopback port');
 const socket=dgram.createSocket('udp4'),challenge=BigInt(Date.now());
 return await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{socket.close();reject(Error('Bedrock query timed out'));},4000);socket.on('error',error=>{clearTimeout(timeout);socket.close();reject(error)});socket.on('message',(bytes,remote)=>{if(remote.port!==port||remote.address!==host)return;try{const result=parsePong(bytes,challenge);clearTimeout(timeout);socket.close();resolve(result)}catch(error){clearTimeout(timeout);socket.close();reject(error)}});socket.send(ping(challenge),port,host);});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await query(Number(process.argv[2])),null,2));
