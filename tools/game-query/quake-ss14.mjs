import dgram from 'node:dgram';import {fileURLToPath} from 'node:url';
export function parseQuake(packet){
 if(packet.length>16384||packet.length<6||!packet.subarray(0,5).equals(Buffer.from('\xff\xff\xff\xffI','latin1')))throw Error('Invalid Quake A2S info');
 let offset=6;const fields=[];for(let i=0;i<4;i++){const end=packet.indexOf(0,offset);if(end<0)throw Error('Truncated A2S string');fields.push(packet.subarray(offset,end).toString('utf8'));offset=end+1;}
 if(packet.length<offset+9)throw Error('Truncated A2S fields');
 return {name:fields[0],map:fields[1],players:packet[offset+2],maxplayers:packet[offset+3],password:!!packet[offset+7],protocol:packet[5]};
}
export async function query(kind,host,port){
 if(host!=='127.0.0.1'||!Number.isInteger(port)||port<1||port>65535)throw Error('Use exact loopback allocation');
 if(kind==='ss14'){
  const response=await fetch(`http://${host}:${port}/status`,{redirect:'error',signal:AbortSignal.timeout(2500)});if(!response.ok)throw Error('Native status HTTP'+response.status);
  const reader=response.body.getReader();let size=0,parts=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw Error('Oversized native status');parts.push(Buffer.from(value));}}finally{await reader.cancel();}
  const value=JSON.parse(Buffer.concat(parts).toString('utf8'));if(typeof value?.name!=='string'||!Number.isInteger(value.players)||value.players<0)throw Error('Invalid native SS14 status');return value;
 }
 if(kind!=='quakelive')throw Error('Unknown native game');
 const socket=dgram.createSocket('udp4'),request=Buffer.from('\xff\xff\xff\xffTSource Engine Query\0','latin1');let challenged=false;
 try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Native query timeout')),2500);socket.on('error',e=>{clearTimeout(timer);reject(e);});socket.on('message',(data,peer)=>{if(peer.address!==host||peer.port!==port)return;if(data[4]===0x41&&!challenged&&data.length===9&&data.readInt32LE(0)===-1){challenged=true;socket.send(Buffer.concat([request,data.subarray(5)]),port,host);return;}clearTimeout(timer);try{resolve(parseQuake(data));}catch(e){reject(e);}});socket.send(request,port,host);});}finally{socket.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await query(process.argv[2],process.argv[3],Number(process.argv[4]))));
