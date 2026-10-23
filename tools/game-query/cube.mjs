// MIT. Native Cube server-info query, addressed to the allocated game port + 1.
import dgram from 'node:dgram';import dns from 'node:dns/promises';import crypto from 'node:crypto';
const [kind,host,portText,extension]=process.argv.slice(2),port=Number(portText);
if(!['assaultcube','sauerbraten'].includes(kind)||!host||!Number.isInteger(port)||port<1||port>65534)throw Error('Usage: cube.mjs assaultcube|sauerbraten HOST GAME_PORT');
if(extension&&!(kind==='assaultcube'&&extension==='info'))throw Error('Only AssaultCube info extension is supported');
const nonce=crypto.randomInt(1,0x3fffffff),request=Buffer.alloc(kind==='assaultcube'?(extension?8:6):5);request[0]=0x81;request.writeInt32LE(nonce,1);if(kind==='assaultcube')request[5]=extension?2:0;if(extension){request[6]=101;request[7]=110;}
const address=(await dns.lookup(host,{family:4})).address,socket=dgram.createSocket('udp4'),start=performance.now();
try{
 const packet=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Native Cube query timed out')),2500);socket.on('error',e=>{clearTimeout(timer);reject(e);});socket.on('message',(message,remote)=>{if(remote.address===address&&remote.port===port+1){clearTimeout(timer);resolve(message);}});socket.send(request,port+1,address,e=>{if(e){clearTimeout(timer);reject(e);}});});
 let offset=0;const integer=()=>{if(offset>=packet.length)throw Error('Truncated Cube integer');const first=packet[offset++];if(first===128||first===129){const size=first===128?2:4;if(offset+size>packet.length)throw Error('Truncated Cube integer');const value=size===2?packet.readInt16LE(offset):packet.readInt32LE(offset);offset+=size;return value;}return first<128?first:first-256;};
 const string=()=>{const bytes=[];for(let i=0;i<4096;i++){const value=integer();if(value===0)return Buffer.from(bytes).toString('utf8');if(value<-128||value>255)throw Error('Invalid Cube string');bytes.push(value&255);}throw Error('Oversized Cube string');};
 if(integer()!==nonce)throw Error('Native Cube nonce mismatch');let protocol,mode,players,remaining,maximum,flags,map,name,extra={};
 if(kind==='assaultcube'){if(integer()!==(extension?2:0))throw Error('Wrong Cube extension');if(extension){integer();integer();}protocol=integer();mode=integer();players=integer();remaining=integer();map=string();name=string();maximum=integer();flags=integer();if(extension){if(integer()!==2)throw Error('Wrong Cube info extension');extra.language=string();extra.additional_info=[];while(offset<packet.length){const line=string();if(!line)break;extra.additional_info.push(line);}}}
 else{players=integer();const count=integer();if(![5,7].includes(count))throw Error('Invalid Cube info attributes');const attrs=Array.from({length:count},integer);[protocol,mode,remaining,maximum,flags]=attrs;if(count===7)extra={paused:Boolean(attrs[5]),game_speed:attrs[6]};map=string();name=string();}
 if(protocol<1||maximum<1||maximum>256||players<0||players>256)throw Error('Invalid native Cube info');
 console.log(JSON.stringify({name,map,protocol,game_type:mode,players,maxplayers:maximum,password:kind==='assaultcube'?Boolean(flags&1):flags===4,native_flags:flags,time_remaining:remaining,...extra,latency_ms:Math.round((performance.now()-start)*100)/100}));
}finally{socket.close();}
