// MIT. Transport acceptance only: native connect, first sign-on datagram, disconnect.
import dgram from 'node:dgram';import {query} from './id-family.mjs';
const [host,portText,spanText='16']=process.argv.slice(2),port=Number(portText),span=Number(spanText);
if(host!=='127.0.0.1'||!Number.isInteger(port)||port<1||!Number.isInteger(span)||span<1||span>16||port+span>65535)throw Error('Usage: netquake-handshake.mjs 127.0.0.1 PRIMARY ALLOCATED_CLIENT_PORTS');
const socket=dgram.createSocket('udp4'),request=Buffer.from('8000000c015155414b450003','hex');let accepted,signon,primed=false,retry;
const observed=[];
try{
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('Native NetQuake sign-on timeout '+JSON.stringify({accepted,signon,observed}))),7000);
  socket.on('error',reject);
  socket.on('message',(packet,remote)=>{
   if(remote.address!==host||packet.length<5)return;
   const header=packet.readUInt32BE(0),length=header&0xffff;
   observed.push({port:remote.port,length:packet.length,header:header.toString(16),type:packet[4]});
   if(length!==packet.length)return;
   if(remote.port===port&&(header&0xffff0000)>>>0===0x80000000){
    if(packet[4]===0x82){clearTimeout(timeout);reject(Error('Native connection rejected: '+packet.subarray(5).toString().replaceAll('\0','')));return;}
    if(packet[4]===0x81&&packet.length===9){accepted=packet.readInt32LE(5);if(accepted<port+1||accepted>port+span){clearTimeout(timeout);reject(Error('Native client port escaped allocated span'));return;}}
   }else if(remote.port>port&&remote.port<=port+span&&(header&0x10000)&&packet.length>8){
    if(!signon)signon={port:remote.port,bytes:packet.length,sequence:packet.readUInt32BE(4)};
   }
   if(accepted&&!primed){
    primed=true;const nop=Buffer.alloc(9);nop.writeUInt32BE(0x00100009,0);nop.writeUInt32BE(0,4);nop[8]=1;
    socket.send(nop,accepted,host,error=>{if(error){clearTimeout(timeout);reject(error);}});
   }
   if(accepted&&signon&&signon.port===accepted){clearTimeout(timeout);resolve();}
  });
  socket.send(request,port,host);
  retry=setInterval(()=>{
   if(!accepted)socket.send(request,port,host);
   else if(!signon){const nop=Buffer.alloc(9);nop.writeUInt32BE(0x00100009,0);nop.writeUInt32BE(0,4);nop[8]=1;socket.send(nop,accepted,host);}
  },1000);
 });
 const ack=Buffer.alloc(8);ack.writeUInt32BE(0x00020008,0);ack.writeUInt32BE(signon.sequence,4);await new Promise((resolve,reject)=>socket.send(ack,accepted,host,e=>e?reject(e):resolve()));
 const disconnect=Buffer.alloc(9);disconnect.writeUInt32BE(0x00100009,0);disconnect.writeUInt32BE(1,4);disconnect[8]=2;await new Promise((resolve,reject)=>socket.send(disconnect,accepted,host,e=>e?reject(e):resolve()));
 await new Promise(resolve=>setTimeout(resolve,400));
 const after=await query('nzportable-vril',host,port);
 console.log(JSON.stringify({native_connect_accepted:true,allocated_client_port:accepted,first_signon_datagram:signon,disconnect_sent:true,after_disconnect_query:after,scope:'Transport handshake only; no player entered the game and no gameplay.'}));
}finally{clearInterval(retry);socket.close();}
