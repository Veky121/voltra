// Native Luanti 5.17 MTP INIT/HELLO probe. Does not authenticate or join a world.
// Constants and wire fields follow the pinned engine's networkprotocol.h and mtp/internal.h.
import dgram from 'node:dgram';
const [host,portText]=process.argv.slice(2),port=Number(portText);
if(!host||!Number.isInteger(port)||port<1||port>65535)throw Error('Usage: luanti-handshake.mjs host port');
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b;};
let peer=0,done=false;
const socket=dgram.createSocket('udp4');
function send(body){const header=Buffer.alloc(7);header.writeUInt32BE(0x4f457403);header.writeUInt16BE(peer,4);socket.send(Buffer.concat([header,body]),port,host);}
const name=Buffer.from('VoltraProbe');
const init=Buffer.concat([Buffer.from([3]),u16(65500),Buffer.from([1]),u16(2),Buffer.from([29]),u16(0),u16(37),u16(53),u16(name.length),name]);
const finish=(error,result)=>{if(done)return;done=true;clearInterval(retry);clearTimeout(deadline);if(!error)send(Buffer.from([0,3]));socket.close();if(error){console.error(error);process.exitCode=1;}else console.log(JSON.stringify(result));};
socket.on('error',error=>finish(error.code??'UDP probe failed'));
socket.on('message',message=>{
 if(message.length<8||message.readUInt32BE(0)!==0x4f457403)return;
 let body=message.subarray(7);
 if(body[0]===3){if(body.length<4)return;const sequence=body.readUInt16BE(1);body=body.subarray(3);if(body[0]===0&&body[1]===1&&body.length>=4)peer=body.readUInt16BE(2);send(Buffer.concat([Buffer.from([0,0]),u16(sequence)]));}
 if(body[0]===0&&body[1]===1&&body.length>=4){peer=body.readUInt16BE(2);return;}
 if(body[0]!==1||body.length<12)return;
 const packet=body.subarray(1),command=packet.readUInt16BE(0);
 if(command===2){const protocol=packet.readUInt16BE(5);if(protocol!==53)return finish('Unexpected native protocol '+protocol);finish(null,{native_hello:true,protocol,serialization:packet[2],authentication_methods:packet.readUInt32BE(7),player_join_verified:false});}
});
const retry=setInterval(()=>send(init),1000),deadline=setTimeout(()=>finish('Native Luanti HELLO timed out'),10000);
socket.bind(0,()=>send(init));
