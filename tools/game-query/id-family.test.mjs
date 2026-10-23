import test from 'node:test';import assert from 'node:assert/strict';
import {parseZandronum,decode,query,parseVril} from './id-family.mjs';import dgram from 'node:dgram';
// Synthetic response independently encoded by the pinned Python upstream codec.
const packet=Buffer.from('055313f1523ed185d16acb644b971692a5517ad30d916476edda5663d1bedf918e34ddd06a44a4965fa4f0371df1bbf1fdd3f5dcf3fcacf82e5c5dea98a66d63a4481b478ddad0d532b5e946ed2202','hex');
test('Huffman launcher fields agree with independent Python encoding',()=>{
 const result=parseZandronum(packet,517077);assert.equal(result.name,'Name');assert.equal(result.map,'E1M1');assert.equal(result.maxplayers,8);assert.equal(result.password,true);assert.equal(result.iwad,'freedoom1.wad');
});
test('launcher rejects nonce mismatch and truncated fields',()=>{
 assert.throws(()=>parseZandronum(packet,1));assert.throws(()=>parseZandronum(Buffer.concat([Buffer.from([255]),decode(packet).subarray(0,-1)]),517077));
});
test('Huffman rejects invalid lengths and padding',()=>{
 assert.throws(()=>decode(Buffer.alloc(0)));assert.throws(()=>decode(Buffer.from([8,1])));assert.throws(()=>decode(Buffer.alloc(8193)));
});
test('synthetic FTE wire response omits challenge as publisher does',async()=>{
 const server=dgram.createSocket('udp4');await new Promise(resolve=>server.bind(0,'127.0.0.1',resolve));
 server.on('message',(_packet,remote)=>server.send(Buffer.from('\xff\xff\xff\xffinfoResponse\n\\hostname\\NZP fixture\\mapname\\ndu\\sv_maxclients\\8\\clients\\0\0','latin1'),remote.port,remote.address));
 try{const result=await query('nzportable','127.0.0.1',server.address().port);assert.equal(result.name,'NZP fixture');assert.equal(result.maxplayers,8);assert.equal(result.map,'ndu');}finally{server.close();}
});
const vrilPayload=Buffer.concat([Buffer.from([0x83]),Buffer.from('127.0.0.1:28010\0Vril fixture\0ndu\0'),Buffer.from([0,16,3])]);
test('header-only FTE info falls back once to bounded native QW status',async()=>{
 const server=dgram.createSocket('udp4');await new Promise(resolve=>server.bind(0,'127.0.0.1',resolve));let calls=0;
 server.on('message',(packet,remote)=>{++calls;const status=packet.equals(Buffer.from('\xff\xff\xff\xffstatus\n','latin1'));server.send(Buffer.from(status?'\xff\xff\xff\xffn\\hostname\\Legacy\\map\\ndu\\maxclients\\8\n\0\n':'\xff\xff\xff\xffinfoResponse\n','latin1'),remote.port,remote.address);});
 try{const result=await query('nzportable','127.0.0.1',server.address().port);assert.equal(result.name,'Legacy');assert.equal(result.map,'ndu');assert.equal(result.maxplayers,8);assert.equal(calls,2);}finally{server.close();}
});
const vrilPacket=Buffer.alloc(4+vrilPayload.length);vrilPacket.writeUInt32BE((0x80000000|vrilPacket.length)>>>0);vrilPayload.copy(vrilPacket,4);
test('NetQuake info validates length and full native16slots',()=>{
 assert.equal(parseVril(vrilPacket).maxplayers,16);assert.equal(parseVril(vrilPacket).map,'ndu');assert.throws(()=>parseVril(vrilPacket.subarray(0,-1)));
});
test('synthetic NetQuake wire request uses native control framing',async()=>{
 const server=dgram.createSocket('udp4');await new Promise(resolve=>server.bind(0,'127.0.0.1',resolve));
 server.on('message',(packet,remote)=>{assert.equal(packet.length,12);assert.equal(packet.readUInt32BE(0),0x8000000c);server.send(vrilPacket,remote.port,remote.address);});
 try{const result=await query('nzportable-vril','127.0.0.1',server.address().port);assert.equal(result.name,'Vril fixture');}finally{server.close();}
});
