// Native unauthenticated GAMEINFO query, not a player connection or login.
// Wire layout: OpenRCT2 v0.5.6 NetworkPacket.h / NetworkConnection.cpp.
import net from 'node:net';
const [host,portText]=process.argv.slice(2),port=Number(portText);
if(!host||!Number.isInteger(port)||port<1||port>65535)throw Error('Usage: openrct2.mjs HOST PORT');
const request=Buffer.alloc(6);request.writeUInt16BE(4,0);request.writeUInt32BE(9,2);
const start=Date.now();
const info=await new Promise((resolve,reject)=>{
 const socket=net.createConnection({host,port});let buffer=Buffer.alloc(0),finished=false;
 function finish(error,value){if(finished)return;finished=true;socket.destroy();error?reject(error):resolve(value);}
 socket.setTimeout(5000,()=>finish(Error('Native OpenRCT2 query timed out')));
 socket.on('error',error=>finish(error));socket.on('connect',()=>socket.write(request));
 socket.on('close',()=>{if(!finished)finish(Error('Native query closed without GAMEINFO'));});
 socket.on('data',chunk=>{
  buffer=Buffer.concat([buffer,chunk]);
  try{while(buffer.length>=6){
   let header,size,command;
   if(buffer.readUInt32BE(0)===0x3254524f){if(buffer.length<14)return;header=14;size=buffer.readUInt32BE(6);command=buffer.readUInt32BE(10);if(buffer.readUInt16BE(4)!==2)throw Error('Unsupported native packet version');}
   else{header=6;size=buffer.readUInt16BE(0)-4;command=buffer.readUInt32BE(2);}
   if(size<0||size>1024**2)throw Error('Native packet exceeds query bounds');
   if(buffer.length<header+size)return;
   const body=buffer.subarray(header,header+size);buffer=buffer.subarray(header+size);
   if(command===9){const end=body.indexOf(0);if(end<0)throw Error('Native GAMEINFO has no terminator');finish(null,JSON.parse(body.subarray(0,end).toString('utf8')));return;}
  }}catch(error){finish(error);}
 });
});
console.log(JSON.stringify({name:info.name,version:info.version,maxplayers:info.maxPlayers,players:info.players,password:info.requiresPassword===true,dedicated:info.dedicated===true,ping:Date.now()-start,player_join_verified:false}));
