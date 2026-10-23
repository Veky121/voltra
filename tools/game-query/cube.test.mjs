// Synthetic wire fixtures only. These do not count as native game acceptance.
import test from 'node:test';import assert from 'node:assert/strict';import dgram from 'node:dgram';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile);
function integer(value){if(value>=-126&&value<=127)return Buffer.from([value&255]);if(value>=-32768&&value<=32767){const b=Buffer.alloc(3);b[0]=128;b.writeInt16LE(value,1);return b;}const b=Buffer.alloc(5);b[0]=129;b.writeInt32LE(value,1);return b;}
const ints=(...values)=>Buffer.concat(values.map(integer));
const string=value=>Buffer.concat([...Buffer.from(value)].map(integer).concat([integer(0)]));
async function fixture(kind,tail,extension,corrupt=false){
 const server=dgram.createSocket('udp4');await new Promise(resolve=>server.bind(0,'127.0.0.1',resolve));
 const queryPort=server.address().port;
 server.on('message',(request,remote)=>{const echo=Buffer.from(request);if(corrupt)echo.writeInt32LE(echo.readInt32LE(1)+1,1);server.send(Buffer.concat([echo,tail]),remote.port,remote.address);});
 try{return await exec(process.execPath,['tools/game-query/cube.mjs',kind,'127.0.0.1',String(queryPort-1),...(extension?[extension]:[])],{timeout:6000,windowsHide:true});}
 finally{server.close();}
}
test('AssaultCube variable integers, literal name and password flag',async()=>{
 const tail=Buffer.concat([ints(1300,2,0,10),string('ac_desert'),string('Literal "quoted" $safe'),ints(8,1)]);
 const result=JSON.parse((await fixture('assaultcube',tail)).stdout);
 assert.equal(result.protocol,1300);assert.equal(result.name,'Literal "quoted" $safe');assert.equal(result.maxplayers,8);assert.equal(result.password,true);
});
test('AssaultCube native additional-info extension',async()=>{
 const tail=Buffer.concat([ints(1300,2,0,10),string('ac_desert'),string('Server'),ints(8,0,2),string('en'),string('VOLTRA_OPERATOR_MARKER_517077'),string('')]);
 const result=JSON.parse((await fixture('assaultcube',tail,'info')).stdout);
 assert.equal(result.language,'en');assert.deepEqual(result.additional_info,['VOLTRA_OPERATOR_MARKER_517077']);
});
test('Sauerbraten password info with expected empty initial map',async()=>{
 const tail=Buffer.concat([ints(0,5,260,1,0,4,4),string(''),string('Sauer server')]);
 const result=JSON.parse((await fixture('sauerbraten',tail)).stdout);
 assert.equal(result.map,'');assert.equal(result.maxplayers,4);assert.equal(result.password,true);
});
test('Sauerbraten extended attributes and native master-policy flag',async()=>{
 const tail=Buffer.concat([ints(0,7,260,1,0,8,-1,0,75),string(''),string('Sauer server')]);
 const result=JSON.parse((await fixture('sauerbraten',tail)).stdout);
 assert.equal(result.native_flags,-1);assert.equal(result.game_speed,75);assert.equal(result.paused,false);assert.equal(result.password,false);
});
test('Incorrect echoed nonce fails explicitly',async()=>{
 const tail=Buffer.concat([ints(1300,2,0,10),string('ac_desert'),string('Server'),ints(8,0)]);
 await assert.rejects(fixture('assaultcube',tail,undefined,true),error=>/nonce mismatch/.test(error.stderr));
});
test('Truncated native response fails explicitly',async()=>{
 await assert.rejects(fixture('sauerbraten',Buffer.from([0,5,128])),error=>/Truncated/.test(error.stderr));
});
