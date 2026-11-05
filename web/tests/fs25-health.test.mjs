import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {checkHealth,sessionState,logGameState,reconcileGameState} from '../../internal/panel/game_library/fs25/lib/health.mjs';

test('lifecycle logs require ready marker and match the current process, independent of host timezone',()=>{
 const started=Date.UTC(2026,10,4,18,35,34);
 const ready=logGameState('[04/Nov/2026:18:35:35] Game server started');
 assert.equal(ready.at,started+1000);
 assert.equal(reconcileGameState(ready,started),'online');
 assert.equal(reconcileGameState(ready,null),'offline');
 assert.equal(reconcileGameState(ready,started+60000),'unknown');
 assert.equal(logGameState('[04/Nov/2026:18:35:35] Game server process started').state,'unknown');
 assert.equal(logGameState('[04/Nov/2026:18:35:35] Game server started\n[04/Nov/2026:18:40:00] Game server process stopped').state,'offline');
});

test('session controls distinguish stopped, running and ambiguous pages',()=>{
 assert.equal(sessionState('<input name="start_server">'),'offline');
 assert.equal(sessionState("<input name = 'stop_server'>"),'online');
 for(const html of ['', '<input name="start_server"><input name="stop_server">','<div name="stop_server">'])assert.equal(sessionState(html),'unknown');
});
test('portal login and current session are checked over HTTP without power requests',async t=>{
 let session='<input name="stop_server">',posts=0;
 const server=http.createServer((req,res)=>{
  if(req.method==='POST'){
   posts++;let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    assert.equal(new URLSearchParams(body).get('login'),'Login');
    assert.equal(new URLSearchParams(body).has('start_server'),false);
    assert.equal(new URLSearchParams(body).has('stop_server'),false);
    res.setHeader('Set-Cookie','SessionID=test; Path=/');res.end('');
   });return;
  }
  res.end(req.headers.cookie==='SessionID=test'?session:'<input name="username">');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const env={WEB_HOST:'127.0.0.1',WEB_PORT:server.address().port,WEB_PASSWORD:'test'};
 assert.deepEqual(await checkHealth(env),{portal:'online',game:'online'});
 session='<input name="start_server">';assert.deepEqual(await checkHealth(env),{portal:'online',game:'offline'});
 session='unrecognised';assert.deepEqual(await checkHealth(env),{portal:'online',game:'unknown'});
 assert.equal(posts,3);
});
test('failed transport, login and unexpected HTTP pages do not claim game offline',async()=>{
 assert.deepEqual(await checkHealth({},async()=>{throw Error('timeout')}),{portal:'unknown',game:'unknown'});
 assert.deepEqual(await checkHealth({},async()=>({status:200,body:'unrelated page',headers:{}})),{portal:'unknown',game:'unknown'});
 assert.deepEqual(await checkHealth({},async()=>({status:200,body:'<input name="username">',headers:{}})),{portal:'online',game:'unknown'});
});
