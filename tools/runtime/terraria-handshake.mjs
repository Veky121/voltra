// Checks Terraria's protocol and password gate without spawning a player.
// Packet format: https://github.com/Pryaxis/TShock/wiki/Multiplayer-Packet-Structure
// Usage: node tools/runtime/terraria-handshake.mjs private-receipt.json host port protocol-release [--tshock|--tshock-legacy|--tmodloader] [--account]
// tModLoader takes its full version!network-version suffix and returns mod headers after authentication.
// TShock asks for a password after player identity/world request, then returns world info.
// Implementation reference: Pryaxis/TShock v6.2.1 TShockAPI/GetDataHandlers.cs.
// Read the release constant from the installed official assembly, not a guessed version mapping.
import fs from 'node:fs';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
const [receiptPath,host,rawPort,release,...options]=process.argv.slice(2);
const legacy=options.includes('--tshock-legacy');
const tmodloader=options.includes('--tmodloader');
const tshock=legacy||options.includes('--tshock'),account=options.includes('--account');
if(tshock&&tmodloader)throw Error('Choose one server protocol');
const receipt=JSON.parse(fs.readFileSync(receiptPath));
const credential=account?receipt.owner_password:receipt.password;
if(account&&!tshock)throw Error('Account checks require TShock');
const port=Number(rawPort);
const validVersion=tmodloader?/^\d+\.\d+\.\d+\.\d+!\d+\.\d+\.\d+(?:\.\d+)?$/.test(release):/^\d+$/.test(release);
if(!host||!Number.isInteger(port)||port<1||port>65535||!validVersion||!credential)throw Error('Specify receipt, host, port, protocol release and the required receipt credential');
function packet(type,text){
 const bytes=Buffer.from(text),length=[];let remaining=bytes.length;
 do{let next=remaining&127;remaining>>>=7;if(remaining)next|=128;length.push(next);}while(remaining);
 const frame=Buffer.concat([Buffer.alloc(3),Buffer.from(length),bytes]);frame.writeUInt16LE(frame.length);frame[2]=type;return frame;
}
function rawPacket(type,body=Buffer.alloc(0)){
 const frame=Buffer.concat([Buffer.alloc(3),body]);frame.writeUInt16LE(frame.length);frame[2]=type;return frame;
}
function modHeaders(body){
 let offset=0;
 const count=()=>{if(offset+4>body.length)throw Error('Truncated mod count');const value=body.readInt32LE(offset);offset+=4;if(value<0||value>1000)throw Error('Invalid mod/config count');return value;};
 const string=()=>{
  let length=0,shift=0,next;
  do{if(offset>=body.length||shift>28)throw Error('Invalid mod header string');next=body[offset++];length|=(next&127)<<shift;shift+=7;}while(next&128);
  if(length<0||offset+length>body.length)throw Error('Truncated mod header string');const value=body.toString('utf8',offset,offset+length);offset+=length;return value;
 };
 const mods=[];for(let i=0,total=count();i<total;i++){
  const name=string(),version=string();if(offset+20>body.length)throw Error('Truncated mod hash');offset+=20;
  for(let j=0,configs=count();j<configs;j++){string();string();} // Read past config names and JSON without exposing either.
  mods.push({name,version});
 }
 return mods;
}
async function check(password,expected){
 return await new Promise((resolve,reject)=>{
  const socket=net.createConnection({host,port});let buffered=Buffer.alloc(0),challenged=false,settled=false,introduced=false,mods=[];
  const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve({password_challenge:true,response_packet:expected,mods});};
  const timer=setTimeout(()=>finish(Error('Terraria handshake timed out')),7000);
  socket.on('error',error=>finish(Error('Terraria '+(challenged?'password response':'hello')+' failed: '+error.code)));
  socket.on('end',()=>finish(Error('Terraria closed before the expected response')));
  socket.on('connect',()=>socket.write(packet(1,(tmodloader?'tModLoader v':'Terraria')+release)));
  socket.on('data',chunk=>{
   buffered=Buffer.concat([buffered,chunk]);
   while(buffered.length>=3){
    const size=buffered.readUInt16LE(0);if(size<3||size>65535){finish(Error('Invalid Terraria response frame'));return;}
    if(buffered.length<size)return;
    const type=buffered[2],body=buffered.subarray(3,size);buffered=buffered.subarray(size);
    // TShock may send chat/information before the authentication response.
    // These frames never count as authentication or world-data success.
    if((tshock||tmodloader)&&(type===82||type===107))continue;
    if(tshock&&!challenged&&!introduced&&type===3){
     if(!body.length){finish(Error('Player slot response is empty'));return;}
     const identity=Buffer.alloc(legacy?3:8);identity[0]=body[0];
     socket.write(rawPacket(4,Buffer.concat([identity,packet(0,account?'acceptanceowner':'VoltraProbe').subarray(3),Buffer.alloc(legacy?27:28)])));
     socket.write(packet(68,randomUUID()));
     socket.write(rawPacket(6));introduced=true;continue;
    }
    if(!challenged){if(type!==37){finish(Error('Expected password challenge, received packet '+type));return;}challenged=true;socket.write(packet(38,password));}
    else if(type===expected){try{if(tmodloader&&type===251)mods=modHeaders(body);finish();}catch(error){finish(error);}return;}
    else if(type===2){finish(Error('Terraria rejected the accepted-password handshake'));return;}
   }
  });
 });
}
const rejected=await check('invalid-'+credential,2);
const successPacket=tshock?7:tmodloader?251:3;
const accepted=await check(credential,successPacket);
const result={lan_reachable:true,server_variant:tmodloader?'tmodloader':legacy?'tshock-legacy':tshock?'tshock':'vanilla',authentication:account?'account':'join-password',protocol_release:tmodloader?release:Number(release),password_challenge:true,wrong_password_rejected:rejected.response_packet===2,correct_password_accepted:accepted.response_packet===successPacket,world_data_received:tshock,synced_mods:accepted.mods,player_spawned:false,observed_at:new Date().toISOString()};
fs.writeFileSync(receiptPath+(account?'.account-handshake.json':'.handshake.json'),JSON.stringify(result,null,2)+'\n');console.log(result);
