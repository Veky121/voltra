// Offline TCP fixtures only. No Terraria process, game assets or external network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
const probe=path.resolve('tools/runtime/terraria-handshake.mjs');
const packet=(type,body=Buffer.alloc(0))=>{const b=Buffer.concat([Buffer.alloc(3),body]);b.writeUInt16LE(b.length);b[2]=type;return b;};
const text=value=>{const b=Buffer.from(value);assert.ok(b.length<128);return Buffer.concat([Buffer.from([b.length]),b]);};
async function fixture(options={},args=[]){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'terraria-probe-tcp-'));const receipt=path.join(dir,'private.json');
 const secret='synthetic-fixture-password',owner='synthetic-owner-password';await fs.writeFile(receipt,JSON.stringify({password:secret,owner_password:owner}),{mode:0o600});
 const output=receipt+(options.account?'.account-handshake.json':'.handshake.json');
 if(options.existingOutput)await fs.writeFile(output,options.existingOutput);
 const sockets=new Set(),seen={connections:0,hello:[],identity:0,world:0,peerEnds:0,passwordChecks:0};let serverError;
 const server=net.createServer({allowHalfOpen:true},socket=>{
  seen.connections++;sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
  socket.on('end',()=>{seen.peerEnds++;if(options.close!=='stall')socket.end();});
  if(options.behavior==='early-close'){socket.end();return;}
  if(options.behavior==='timeout')return;
  let buffer=Buffer.alloc(0),worldRequested=false;
  socket.on('data',chunk=>{
   try{
    buffer=Buffer.concat([buffer,chunk]);
    while(buffer.length>=3){const size=buffer.readUInt16LE();if(buffer.length<size)return;assert.ok(size>=3);const type=buffer[2],body=buffer.subarray(3,size);buffer=buffer.subarray(size);
     if(type===1){seen.hello.push(body.subarray(1).toString());
      if(options.behavior==='malformed'){socket.write(Buffer.from([2,0,37]));continue;}
      if(options.behavior==='unexpected'){socket.write(packet(7));continue;}
      if(options.variant==='tshock'||options.variant==='legacy'){socket.write(packet(3,Buffer.from([0,0])));continue;}
      if(options.variant==='tmodloader')socket.write(packet(82));
      socket.write(packet(37));
     }else if(type===4){seen.identity++;assert.ok(body.length>20);}
     else if(type===68){assert.ok(body.length>10);}
     else if(type===6){seen.world++;worldRequested=true;socket.write(packet(37));}
     else if(type===38){
      seen.passwordChecks++;const value=body.subarray(1).toString();const credential=options.account?owner:secret;
      assert.ok(value===credential||value==='invalid-'+credential,'only expected synthetic password sent');
      const accepted=value===credential;
      if(options.variant==='tshock'||options.variant==='legacy')assert.ok(worldRequested);
      const type=accepted?(options.variant==='tmodloader'?251:options.variant==='tshock'||options.variant==='legacy'?7:3):2;
      const reply=packet(type,type===251?Buffer.alloc(4):type===3?Buffer.from([0,0]):Buffer.alloc(0));
      if(options.close==='server-end')socket.end(reply);else socket.write(reply);
     }else throw Error('Unexpected fixture packet');
    }
   }catch(error){serverError=error;socket.destroy();}
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const variant=options.variant==='legacy'?['--tshock-legacy']:options.variant==='tshock'?['--tshock']:options.variant==='tmodloader'?['--tmodloader']:[];
 const release=options.variant==='tmodloader'?'2026.8.3.0!2026.8.3':'326';
 try{
  const child=spawn(process.execPath,[probe,receipt,'127.0.0.1',String(server.address().port),release,...variant,...(options.account?['--account']:[]),...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  const exit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();},12000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve(code);});});
  assert.ok(!stdout.includes(secret)&&!stdout.includes(owner)&&!stderr.includes(secret)&&!stderr.includes(owner),'credentials never printed');
  if(serverError)throw serverError;
  let result;try{result=JSON.parse(await fs.readFile(receipt+(options.account?'.account-handshake.json':'.handshake.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const outputBytes=await fs.readFile(output).catch(error=>{if(error.code!=='ENOENT')throw error;});
  return {exit,result,seen,stderr,outputBytes};
 }finally{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
}
test('default FIN drains both password rejection and packet3 without player spawn',async()=>{
 const {exit,result,seen}=await fixture();assert.equal(exit,0);assert.equal(result.teardown_mode,'fin');assert.equal(result.player_spawned,false);assert.equal(result.world_data_received,false);
 assert.equal(result.wrong_password_rejected,true);assert.equal(result.correct_password_accepted,true);assert.equal(seen.connections,2);assert.equal(seen.identity,0);assert.equal(seen.world,0);
 for(const t of Object.values(result.teardown)){assert.equal(t.mode,'fin');assert.equal(t.forced_cleanup,false);assert.equal(t.drain_timed_out,false);assert.equal(t.peer_ended,true);assert.equal(t.write_finished,true);}
});
test('explicit destroy retains immediate teardown, without RST claim',async()=>{const {exit,result}=await fixture({},['--teardown=destroy']);assert.equal(exit,0);assert.equal(result.teardown_mode,'destroy');for(const t of Object.values(result.teardown)){assert.equal(t.mode,'destroy');assert.equal(t.forced_cleanup,false);assert.equal(t.drain_timed_out,false);}});
test('FIN drain deadline forcibly reaps peers that never end',async()=>{const start=Date.now();const {exit,result}=await fixture({close:'stall'},['--teardown=fin']);assert.equal(exit,0);assert.ok(Date.now()-start<8000);for(const t of Object.values(result.teardown)){assert.equal(t.forced_cleanup,true);assert.equal(t.drain_timed_out,true);assert.equal(t.peer_ended,false);assert.equal(t.write_finished,true);}});
test('server-initiated EOF after expected packet is handled',async()=>{const {exit,result}=await fixture({close:'server-end'});assert.equal(exit,0);for(const t of Object.values(result.teardown)){assert.equal(t.peer_ended,true);assert.equal(t.forced_cleanup,false);}});
test('server EOF before authentication fails without successful receipt',async()=>{const {exit,result}=await fixture({behavior:'early-close'});assert.notEqual(exit,0);assert.equal(result,undefined);});
test('malformed and unexpected frames fail and reap connections',async()=>{for(const behavior of ['malformed','unexpected']){const {exit,result}=await fixture({behavior});assert.notEqual(exit,0);assert.equal(result,undefined);}});
test('handshake timeout is bounded and reaps the socket',async()=>{const start=Date.now();const {exit,result}=await fixture({behavior:'timeout'});assert.notEqual(exit,0);assert.equal(result,undefined);assert.ok(Date.now()-start<11000);});
test('invalid and duplicate teardown options fail before connecting',async()=>{for(const args of [['--teardown=rst'],['--teardown'],['--teardown=fin','--teardown=destroy']]){const {exit,result,seen}=await fixture({},args);assert.notEqual(exit,0);assert.equal(result,undefined);assert.equal(seen.connections,0);}});
test('TShock modern, legacy and account identity/world/password flow retained',async()=>{for(const options of [{variant:'tshock'},{variant:'legacy'},{variant:'tshock',account:true}]){const {exit,result,seen}=await fixture(options);assert.equal(exit,0);assert.equal(result.world_data_received,true);assert.equal(result.player_spawned,false);assert.equal(seen.identity,2);assert.equal(seen.world,2);assert.equal(result.authentication,options.account?'account':'join-password');}});
test('tModLoader version, ignored info packet and mod header flow retained',async()=>{const {exit,result,seen}=await fixture({variant:'tmodloader'});assert.equal(exit,0);assert.equal(result.protocol_release,'2026.8.3.0!2026.8.3');assert.deepEqual(result.synced_mods,[]);assert.ok(seen.hello.every(v=>v==='tModLoader v2026.8.3.0!2026.8.3'));assert.equal(result.player_spawned,false);});

test('existing historical result is unchanged and rejected before any connection',async()=>{
 const historical=Buffer.from('{"historical_destroy_evidence":true}\n');
 for(const account of [false,true]){
  const {exit,seen,outputBytes}=await fixture({existingOutput:historical,...(account?{variant:'tshock',account:true}:{})});
  assert.notEqual(exit,0);assert.equal(seen.connections,0);assert.deepEqual(outputBytes,historical);
 }
});
