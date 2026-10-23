import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
function integer(n){const result=[];do{let b=n&127;n>>>=7;if(n)b|=128;result.push(b);}while(n);return Buffer.from(result);}
function frame(id,body){const payload=Buffer.concat([integer(id),body]);return Buffer.concat([integer(payload.length),payload]);}
async function fixture(corrupt){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'voltra-mc-query-')),output=path.join(temporary,'status.json');
 const server=net.createServer(socket=>{
  let phase=0;
  socket.on('data',data=>{
   if(phase++===0){
    const json=Buffer.from(JSON.stringify({version:{name:'§9Fixture only',protocol:47},description:{text:'A'.repeat(180)+'§ 😀'},players:{max:6,online:0}}));
    if(corrupt==='utf8')json[json.indexOf(Buffer.from([0xc2,0xa7]))]=0xff;
    const response=frame(0,Buffer.concat([integer(json.length),json]));
    socket.write(response.subarray(0,1));setTimeout(()=>socket.write(response.subarray(1,4)),5);setTimeout(()=>socket.write(response.subarray(4)),10);
   }else{
    const nonce=Buffer.from(data.subarray(-8));if(corrupt)nonce[0]^=255;
    socket.write(frame(1,nonce));
   }
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{return await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('./minecraft-status.mjs',import.meta.url)),'127.0.0.1',String(server.address().port),output]);let stdout='',stderr='';
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.once('error',reject);child.once('exit',code=>resolve({code,stdout,stderr,file:fs.existsSync(output)?fs.readFileSync(output):null}));
 });}finally{await new Promise(resolve=>server.close(resolve));if(fs.existsSync(output))fs.unlinkSync(output);fs.rmdirSync(temporary);}
}
test('native query handles fragmented multi-byte lengths and validates ping nonce',async()=>{
 const result=await fixture(false);assert.equal(result.code,0,result.stderr);const value=JSON.parse(result.stdout);assert.equal(value.maxplayers,6);assert.equal(value.players,0);assert.equal(value.description.text,'A'.repeat(180)+'§ 😀');assert.equal(value.version.name,'§9Fixture only');assert.equal(value.native_ping_nonce_matched,true);assert.equal(result.file.toString('utf8'),result.stdout);assert(result.file.includes(Buffer.from([0xc2,0xa7])));assert(!result.file.includes(Buffer.from([0xef,0xbf,0xbd])));
});
test('native query rejects a mismatched pong instead of reporting success',async()=>{
 const result=await fixture(true);assert.notEqual(result.code,0);assert.match(result.stderr,/nonce mismatch/);assert.equal(result.stdout,'');assert.equal(result.file,null);
});
test('native query rejects invalid wire UTF8 instead of replacing characters',async()=>{
 const result=await fixture('utf8');assert.notEqual(result.code,0);assert.match(result.stderr,/encoding utf-8/i);assert.equal(result.stdout,'');assert.equal(result.file,null);
});
