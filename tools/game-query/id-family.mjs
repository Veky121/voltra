// MIT. Launcher Huffman frequencies and tree ordering from thehatkid/pyzandronum;
// full license and pinned upstream source in zandronum-huffman.py.
import fs from 'node:fs';import dgram from 'node:dgram';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const source=fs.readFileSync(new URL('../../internal/panel/game_library/scripts/zandronum-huffman.py',import.meta.url),'utf8');
const frequencies=JSON.parse(source.match(/HUFFMAN_FREQS = (\[[\s\S]*?\n\])/)[1]);
const nodes=frequencies.map((frequency,byte)=>({frequency,byte}));
for(let iteration=0;iteration<255;iteration++){
 let first=-1,second=-1;
 for(let index=0;index<256;index++)if(nodes[index]){
  if(first<0||nodes[index].frequency<nodes[first].frequency){second=first;first=index;}
  else if(second<0||nodes[index].frequency<nodes[second].frequency)second=index;
 }
 nodes[first]={frequency:nodes[first].frequency+nodes[second].frequency,zero:nodes[second],one:nodes[first]};nodes[second]=null;
}
const tree=nodes.find(Boolean);
export function decode(data){
 if(!data.length||data.length>8192)throw Error('Invalid launcher packet size');
 if(data[0]===255)return data.subarray(1);
 if(data[0]>7)throw Error('Invalid Huffman padding');
 let node=tree;const output=[];
 for(let bit=0;bit<(data.length-1)*8-data[0];bit++){
  node=(data[1+(bit>>3)]>>(bit%8))&1?node.one:node.zero;
  if(!node)throw Error('Invalid Huffman branch');
  if(node.byte!==undefined){output.push(node.byte);node=tree;}
 }
 if(node!==tree)throw Error('Truncated Huffman symbol');return Buffer.from(output);
}
export function parseZandronum(packet,nonce){
 const data=decode(packet);let offset=0;
 const num=(bytes=4)=>{if(offset+bytes>data.length)throw Error('Truncated launcher field');const v=data.readUIntLE(offset,bytes);offset+=bytes;return v;};
 const text=()=>{const end=data.indexOf(0,offset);if(end<0||end-offset>2048)throw Error('Invalid launcher string');const v=data.subarray(offset,end).toString('utf8');offset=end+1;return v;};
 if(num()!==5660023||num()!==nonce)throw Error('Launcher denied query or nonce mismatch');
 const version=text();if(num()!==FLAGS)throw Error('Unexpected launcher flags');
 const result={version,name:text(),website:text(),map:text(),maxclients:num(1),maxplayers:num(1),iwad:text(),password:Boolean(num(1)),join_password:Boolean(num(1)),skill:num(1),players:num(1)};
 if(offset!==data.length)throw Error('Unexpected launcher trailing data');return result;
}
export const FLAGS=1|2|8|16|32|512|1024|2048|4096|0x80000;
export function parseVril(data){
 if(data.length<8||data.length>8192||data.readUInt32BE(0)!==(0x80000000|data.length)>>>0||data[4]!==0x83)throw Error('Invalid NetQuake info packet');
 let offset=5;const text=()=>{const end=data.indexOf(0,offset);if(end<0||end-offset>2048)throw Error('Invalid NetQuake string');const v=data.subarray(offset,end).toString('utf8');offset=end+1;return v;};
 const address=text(),name=text(),map=text();if(offset+3!==data.length)throw Error('Malformed NetQuake fields');
 return {address,name,map,players:data[offset],maxplayers:data[offset+1],protocol:data[offset+2]};
}
export async function query(kind,host,port){
 const nonce=crypto.randomInt(1,0x3fffffff),socket=dgram.createSocket('udp4');let request;
 if(kind==='zandronum'){request=Buffer.alloc(13);request[0]=255;request.writeUInt32LE(199,1);request.writeUInt32LE(FLAGS,5);request.writeUInt32LE(nonce,9);}
 else if(kind==='nzportable-vril')request=Buffer.from('8000000c025155414b450003','hex');
 else request=Buffer.from('\xff\xff\xff\xffgetinfo '+nonce+'\n','latin1');
 const start=performance.now();let fallback=false;
 try{return await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('Native query timeout')),2500);
  socket.on('error',e=>{clearTimeout(timeout);reject(e);});
  socket.on('message',(packet,remote)=>{if(remote.port!==port||remote.address!==host)return;
   if(kind==='nzportable'&&!fallback&&packet.equals(Buffer.from('\xff\xff\xff\xffinfoResponse\n','latin1'))){fallback=true;socket.send(Buffer.from('\xff\xff\xff\xffstatus\n','latin1'),port,host);return;}
   clearTimeout(timeout);try{
   let result;
   if(kind==='zandronum')result=parseZandronum(packet,nonce);
   else if(kind==='nzportable-vril')result=parseVril(packet);
   else{
    const text=packet.toString('latin1'),qw=fallback&&text.startsWith('\xff\xff\xff\xffn\\');if(!qw&&!text.startsWith('\xff\xff\xff\xffinfoResponse\n'))throw Error('Invalid FTE reply');
    const body=qw?text.slice(5).split('\n')[0]:text.slice(text.indexOf('\n')+1);
    const fields=body.replace(/[\0\n]+$/,'').split('\\').slice(1);if(fields.length%2)throw Error('Malformed FTE fields');
    const raw={};for(let i=0;i<fields.length;i+=2)raw[fields[i]]=fields[i+1];
    if(raw.challenge!==undefined&&raw.challenge!==String(nonce))throw Error('FTE nonce mismatch');
    const qwplayers=qw?text.slice(5).split('\n').slice(1).filter(line=>line.replace(/[\0\r ]/g,'').length).length:0;
    result={name:raw.hostname,map:raw.mapname||raw.map,maxplayers:Number(raw.sv_maxclients||raw.maxclients||0),players:Number(raw.clients??qwplayers),protocol:raw.protocol,raw};
   }resolve({...result,latency_ms:Math.round((performance.now()-start)*100)/100});
  }catch(e){reject(e);}});
  socket.send(request,port,host);
 });}finally{socket.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const[kind,host,portText]=process.argv.slice(2),port=Number(portText);
 if(!['zandronum','nzportable','nzportable-vril'].includes(kind)||!/^127\.0\.0\.1$/.test(host)||!Number.isInteger(port)||port<1||port>65535)throw Error('Usage: id-family.mjs KIND 127.0.0.1 PORT');
 console.log(JSON.stringify(await query(kind,host,port)));
}
