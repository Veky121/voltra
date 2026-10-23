// Native BN* packet field definitions referenced from niv/neverwinter.nim,
// private/packets.nim at 0972fc1ffa73d1a038b9abb00dc40d5a07e28dbe.
import fs from 'node:fs';import dgram from 'node:dgram';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const directory='.local/virtual-worlds/nwn',s=JSON.parse(fs.readFileSync(directory+'/private.json'));
const phase=process.argv[2]||'first';if(!/^[a-z0-9-]+$/.test(phase))throw Error('Expected evidence phase');
async function query(header,responseHeader,extra=Buffer.alloc(0)){
 const socket=dgram.createSocket('udp4');await new Promise(resolve=>socket.bind(0,'127.0.0.1',resolve));
 const packet=Buffer.alloc(6+extra.length);packet.write(header);packet.writeUInt16LE(socket.address().port,4);extra.copy(packet,6);
 try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(header+' timed out')),4000);socket.once('error',error=>{clearTimeout(timer);reject(error)});socket.on('message',(message,remote)=>{if(remote.port!==s.ports[0]||remote.address!=='127.0.0.1'||message.subarray(0,4).toString()!==responseHeader)return;clearTimeout(timer);resolve(message)});socket.send(packet,s.ports[0],'127.0.0.1')})}finally{socket.close()}
}
const ping=Buffer.alloc(5);ping.writeUInt8(3,0);crypto.randomBytes(4).copy(ping,1);
const echo=await query('BNLM','BNLR',ping);assert(echo.length>=11);assert(echo.subarray(6,11).equals(ping),'Native unique echo mismatch');
const enumeration=await query('BNES','BNER',Buffer.from([0]));assert(enumeration.length>=9);const nameLength=enumeration[8];assert(enumeration.length>=9+nameLength);
const information=await query('BNXI','BNXR');assert(information.length>=20);const moduleLength=information[19];assert(information.length>=20+moduleLength);
const description=await query('BNDS','BNDR');let offset=6;const string=()=>{assert(offset+4<=description.length);let size=description.readUInt32LE(offset);offset+=4;assert(size<=65536&&offset+size<=description.length);const result=description.subarray(offset,offset+size).toString();offset+=size;return result};
const serverDescription=string(),moduleDescription=string(),version=string();assert(offset+2<=description.length);
const proof={uuid:s.uuid,at:new Date().toISOString(),host:'127.0.0.1',port:s.ports[0],nonce_echo_verified:true,server_name:enumeration.subarray(9,9+nameLength).toString(),password_required:!!information[7],min_level:information[8],max_level:information[9],players:information[10],max_players:information[11],raw_vault_byte:information[12],pvp:information[13],pause:information[14],one_party:information[15],elc:information[16],ilr:information[17],module:information.subarray(20,20+moduleLength).toString(),serverDescription,moduleDescription,version,game_type:description.readUInt16LE(offset),packets:{echo:echo.toString('hex'),enumeration:enumeration.toString('hex'),information:information.toString('hex'),description:description.toString('hex')},gameplay_proven:false};
fs.writeFileSync(directory+'/'+phase+'-native-query.json',JSON.stringify(proof,null,2));console.log({...proof,packets:undefined});
