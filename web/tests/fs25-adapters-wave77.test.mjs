import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=new URL('../../',import.meta.url);
const adapter=new URL('internal/panel/game_library/fs25/lib/start-game.mjs',root);
const shell=readFileSync(new URL('internal/panel/game_library/fs25/start.sh',root),'utf8').replace(/\r\n/g,'\n');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
function child(command,args,env={}) {
 const dlc=mkdtempSync(join(tmpdir(),'fs25-empty-'));
 const p=spawn(command,args,{env:{...process.env,...env,DLC_DIR:dlc,FS25_LIB:'/mock'},stdio:['ignore','pipe','pipe']});
 let out='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>out+=b);
 const timer=setTimeout(()=>p.kill('SIGKILL'),7000);
 return new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',(code)=>{clearTimeout(timer);rmSync(dlc,{recursive:true,force:true});resolve({code,out});});});
}
test('mock portal preserves entity-bearing fields, cookie and exact single encoding',async t=>{
 let submitted;
 const server=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{
  if(req.method==='POST'&& !req.headers.cookie){assert.equal(new URLSearchParams(body).get('password'),'login&"');res.setHeader('Set-Cookie','SessionID=fixture; HttpOnly');res.end('ok');return;}
  assert.equal(req.headers.cookie,'SessionID=fixture');
  if(req.method==='GET')res.end('<input name="game_name" value="A&amp;B &quot;C&quot; &#65;&#x1F600; &amp;quot;"><input type="password" name="game_password" value="p&amp;&quot;&#39;&#x2B;"><input type="hidden" name="csrf" value="x&amp;y"><input type="hidden" name="permission" value="yes"><select name="map"><option value="wrong"></option><option value="a&amp;b&#x2B;" selected></option></select>');
  else {submitted=body;res.end('ok');}
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const result=await child(process.execPath,[adapter.pathname.replace(/^\/(\w:)/,'$1')],{WEB_HOST:'127.0.0.1',WEB_PORT:String(server.address().port),WEB_PASSWORD:'login&"',DLC_DIR:join(tmpdir(),'absent-wave77-dlc')});
 assert.equal(result.code,0,result.out);const values=new URLSearchParams(submitted);
 assert.equal(values.get('game_name'),'A&B "C" A😀 &quot;');assert.equal(values.get('game_password'),'p&"\'+');assert.equal(values.get('map'),'a&b+');assert.equal(values.get('csrf'),'x&y');assert.equal(values.get('permission'),'yes');assert.equal(values.get('start_server'),'Start');assert.match(submitted,/game_password=p%26%22'%2B/);assert.ok(!result.out.includes('login&'));
});
test('literal attribute ampersands survive portal resubmission',async t=>{
 let submitted;
 const server=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{
  if(req.method==='POST'&&!req.headers.cookie){res.setHeader('Set-Cookie','SessionID=literal-fixture');res.end('ok');return;}
  if(req.method==='GET')res.end('<input name="game_name" value="AT&T"><input type="password" name="game_password" value="p&token=1&amp=2">');
  else{submitted=body;res.end('ok');}
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const result=await child(process.execPath,[adapter.pathname.replace(/^\/(\w:)/,'$1')],{WEB_HOST:'127.0.0.1',WEB_PORT:String(server.address().port),WEB_PASSWORD:'fixture-login'});
 assert.equal(result.code,0,result.out);
 const values=new URLSearchParams(submitted);
 assert.equal(values.get('game_name'),'AT&T');assert.equal(values.get('game_password'),'p&token=1&amp=2');
 assert.ok(!result.out.includes('p&token'));
});

test('unsupported and invalid references refuse without leaking values',async t=>{
 for(const value of ['secret&unknown;','secret&#x110000;','secret&#xD800;','secret&#0;','secret&amp']) {
 const server=http.createServer((req,res)=>{req.resume();req.on('end',()=>{if(!req.headers.cookie){res.setHeader('Set-Cookie','SessionID=x');res.end('ok');}else if(req.method==='GET')res.end(`<input name="game_name" value="${value}">`);else {assert.fail('must not post corrupt form');}});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const r=await child(process.execPath,[adapter.pathname.replace(/^\/(\w:)/,'$1')],{WEB_HOST:'127.0.0.1',WEB_PORT:String(server.address().port),WEB_PASSWORD:'mock'});assert.equal(r.code,1);assert.ok(!r.out.includes('secret'));}finally{await new Promise(r=>server.close(r));}
 }
});
// Execute only the production shutdown/trap and final wait sections. No startup,
// filesystem setup, Wine, network tools, installer or licence code is executed.
const handler=shell.slice(shell.indexOf('shutdown() {'),shell.indexOf('# ---- 6.'));
assert.ok(handler.includes('cleanup_workers()'),'production shutdown handler must include worker cleanup');
const waitStart=shell.indexOf('while true; do\n    wait "$WINE_PID"');
assert.ok(waitStart>=0,'production wait loop must be present');
const waiter=shell.slice(waitStart);
for(const status of [7,0])test(`synthetic child exit ${status} is retained and workers reaped`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fs25-shell-'));
 try{const script=`set -uo pipefail\nlog(){ :; }; err(){ :; }; node(){ return 0; }; wineserver(){ :; }; sleep(){ :; }\n(sleep_unused=1; /usr/bin/sleep 0.1; exit ${status}) &\nWINE_PID=$!\n/usr/bin/sleep 5 &\nXVFB_PID=$!\nTAIL_PID=\n${handler}\n${waiter}`;
 const file=join(dir,'test.sh');writeFileSync(file,script);const r=await child(bash,[file]);assert.equal(r.code,status,r.out);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
for(const signal of ['TERM','INT'])test(`confirmed ${signal} shutdown returns normal status`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fs25-shell-'));
 try{const file=join(dir,'test.sh');writeFileSync(file,`set -uo pipefail\nlog(){ :; }; err(){ :; }; node(){ return 0; }; wineserver(){ :; }; sleep(){ :; }\n/usr/bin/sleep 5 &\nWINE_PID=$!\n/usr/bin/sleep 5 &\nXVFB_PID=$!\n${handler}\nkill -${signal} $$\nexit 99\n`);assert.equal((await child(bash,[file])).code,0);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('failed portal stop refuses termination and retains child ownership',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fs25-shell-'));
 try{const file=join(dir,'test.sh');writeFileSync(file,`set -uo pipefail\nlog(){ :; }; err(){ :; }; node(){ return 1; }; wineserver(){ exit 98; }; sleep(){ :; }\n/usr/bin/sleep 5 &\nWINE_PID=$!\nXVFB_PID=$WINE_PID\n${handler}\nshutdown && exit 97\nkill -0 "$WINE_PID" || exit 96\n# Refuse the explicit Stop request on the next attempt.\nnode(){ case "$*" in *--stop) return 1;; *) return 0;; esac; }\nshutdown && exit 95\nkill -0 "$WINE_PID" || exit 94\ntrap - INT TERM\nkill "$WINE_PID"; wait "$WINE_PID" 2>/dev/null || true\nexit 0\n`);const r=await child(bash,[file]);assert.equal(r.code,0,r.out);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('refused TERM keeps the wait loop alive and a later confirmed Stop succeeds',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fs25-retry-'));
 try {
  const file=join(dir,'retry.sh');
  writeFileSync(file,`set -uo pipefail\nlog(){ :; }; err(){ :; }; wineserver(){ :; }; sleep(){ :; }\nstop_calls=0\nnode(){ stop_calls=$((stop_calls+1)); [ "$stop_calls" -ge 2 ]; }\n/usr/bin/sleep 2 &\nWINE_PID=$!\n/usr/bin/sleep 2 &\nXVFB_PID=$!\n${handler}\nparent=$$\n(/usr/bin/sleep 0.1; kill -TERM "$parent"; /usr/bin/sleep 0.1; kill -0 "$WINE_PID" && printf 'child-retained\\n'; kill -TERM "$parent") &\n${waiter}`);
  const result=await child(bash,[file]);
  assert.equal(result.code,0,result.out);
  assert.match(result.out,/child-retained/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('portal Stop requires a stopped-state readback and reports request failures',async t=>{
 for(const [failStop,quote] of [[false,'"'],[false,"'"],[true,'"']]) {
  let stopRequested=false,readbacks=0;
  const server=http.createServer((req,res)=>{
   req.resume();req.on('end',()=>{
    if(!req.headers.cookie){res.setHeader('Set-Cookie','SessionID=stop-fixture');res.end('ok');return;}
    if(req.method==='POST'){stopRequested=true;res.statusCode=failStop?500:200;res.end('ok');return;}
    if(stopRequested)readbacks++;
    res.end(`<input name=${quote}${stopRequested?"start_server":"stop_server"}${quote}>`);
   });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
   const result=await child(process.execPath,[adapter.pathname.replace(/^\/(\w:)/,'$1'),'--stop'],{WEB_HOST:'127.0.0.1',WEB_PORT:String(server.address().port),WEB_PASSWORD:'fixture-login'});
   assert.ok(stopRequested);
   assert.equal(result.code,failStop?1:0,result.out);
   assert.equal(readbacks,failStop?0:1);
  } finally {await new Promise(resolve=>server.close(resolve));}
 }
});


