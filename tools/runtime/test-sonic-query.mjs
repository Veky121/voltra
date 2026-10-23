import assert from 'node:assert/strict';import {askInfo,checksum,parseInfo} from './sonic-query.mjs';
assert.equal(askInfo(0x01020304).toString('hex'),'c349230100000c00ca04030201');
const packet=Buffer.alloc(414),body=packet.subarray(8);packet[6]=13;body[0]=255;body[1]=5;body.write('SRB2',2);body[18]=202;body[19]=15;body[21]=8;body.write('Cooperative',23);body[49]=64;body.writeUInt32LE(0x01020304,51);body.write('Literal $ server',59);body.write('MAP01',91);body.write('GREENFLOWER',99);packet.writeUInt32LE(checksum(packet));
const info=parseInfo(packet,0x01020304);assert.equal(info.version,'2.2.15');assert.equal(info.name,'Literal $ server');assert.equal(info.maxplayers,8);assert.equal(info.dedicated,true);assert.equal(info.map,'MAP01');assert.equal(info.player_join_verified,false);
assert.throws(()=>parseInfo(packet,1));const corrupt=Buffer.from(packet);corrupt[67]^=1;assert.throws(()=>parseInfo(corrupt,0x01020304));assert.throws(()=>parseInfo(packet.subarray(0,413),0x01020304));
console.log('Native SRB2 discovery golden request, layout, checksum and challenge fixtures passed; no live server queried.');
