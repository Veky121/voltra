// Native Java server-list handshake, status and nonce-checked ping. No login.
import net from 'node:net';
import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
const [host,portText,outputPath]=process.argv.slice(2),port=Number(portText);
if(!host||!Number.isInteger(port)||port<1||port>65535)throw Error('HOST PORT required');
function varint(value){const bytes=[];do{let byte=value&127;value>>>=7;if(value)byte|=128;bytes.push(byte);}while(value);return Buffer.from(bytes);}
function readVarint(bytes,offset=0){let value=0;for(let i=0;i<5;i++){if(offset+i>=bytes.length)return null;const b=bytes[offset+i];value|=(b&127)<<(i*7);if(!(b&128))return{value:value>>>0,size:i+1};}throw Error('Malformed protocol VarInt');}
function packet(id,data=Buffer.alloc(0)){const payload=Buffer.concat([varint(id),data]);return Buffer.concat([varint(payload.length),payload]);}
const address=Buffer.from(host),portBytes=Buffer.alloc(2);portBytes.writeUInt16BE(port);
const nonce=randomBytes(8),started=Date.now();
const result=await new Promise((resolve,reject)=>{
 const socket=net.createConnection({host,port});let buffer=Buffer.alloc(0),status;
 const fail=error=>{socket.destroy();reject(error);};
 socket.setTimeout(5000,()=>fail(Error('Native Minecraft query timed out')));
 socket.once('error',fail);socket.once('end',()=>{if(!socket.destroyed)fail(Error('Server closed before ping reply'));});
 socket.once('connect',()=>socket.write(Buffer.concat([packet(0,Buffer.concat([varint(47),varint(address.length),address,portBytes,varint(1)])),packet(0)])));
 socket.on('data',chunk=>{try{
  buffer=Buffer.concat([buffer,chunk]);if(buffer.length>1024**2)throw Error('Oversized Minecraft response');
  while(buffer.length){
   const length=readVarint(buffer);if(!length)return;if(length.value>1024**2)throw Error('Oversized Minecraft packet');if(buffer.length<length.size+length.value)return;
   const body=buffer.subarray(length.size,length.size+length.value);buffer=buffer.subarray(length.size+length.value);const id=readVarint(body);if(!id)throw Error('Empty Minecraft packet');
   if(!status){
    if(id.value!==0)throw Error('Expected native status packet');const text=readVarint(body,id.size);if(!text||text.value!==body.length-id.size-text.size)throw Error('Invalid native status JSON length');
    status=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body.subarray(id.size+text.size)));socket.write(packet(1,nonce));
   }else{
    if(id.value!==1||!body.subarray(id.size).equals(nonce))throw Error('Native ping nonce mismatch');
    socket.destroy();resolve({description:status.description,version:status.version,maxplayers:Number(status.players?.max),players:Number(status.players?.online),native_ping_nonce_matched:true,elapsed_ms:Date.now()-started});
   }
  }
 }catch(error){fail(error);}});
});
const serialized=JSON.stringify(result)+'\n';
if(outputPath)fs.writeFileSync(outputPath,serialized,'utf8');
process.stdout.write(serialized);
