import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,appendFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {saveGame} from '../../internal/panel/game_library/fs25/lib/save-game.mjs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import http from 'node:http';

async function fixture(t) {
 const dir=await mkdtemp(join(tmpdir(),'voltra-fs25-save-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const control=join(dir,'modSettings','VoltraSave');await mkdir(control,{recursive:true});
 const log=join(dir,'log.txt');await writeFile(log,'Game saved successfully (savegame1).\n');return {dir,control,log};
}
async function requestId(control) {
 for(let n=0;n<100;n++) {try{return /id="([a-f0-9]+)"/.exec(await readFile(join(control,'request.xml'),'utf8'))[1];}catch{}await new Promise(r=>setTimeout(r,10));}
 throw Error('No request');
}
test('requires a fresh engine confirmation after its own request marker',async t=>{
 const f=await fixture(t);const result=saveGame({docsDir:f.dir,timeoutMs:1500});const id=await requestId(f.control);
 await appendFile(f.log,'Game saved successfully (savegame1).\n');
 await appendFile(f.log,`2026-10-30 [VoltraSave] requested ${id}\n`);
 await appendFile(f.log,'2026-10-30 Game saved successfully (savegame1).\n');
 assert.equal((await result).id,id);
 await assert.rejects(stat(join(f.control,'save.lock')),e=>e.code==='ENOENT');
});
test('old saves and accepted requests alone time out',async t=>{
 const f=await fixture(t);const result=assert.rejects(saveGame({docsDir:f.dir,timeoutMs:350}),/timed out/);const id=await requestId(f.control);
 await appendFile(f.log,`[VoltraSave] requested ${id}\n`);await result;
 await assert.rejects(stat(join(f.control,'request.xml')),e=>e.code==='ENOENT');
});
test('rejected save fails and releases lock',async t=>{
 const f=await fixture(t);const result=assert.rejects(saveGame({docsDir:f.dir,timeoutMs:1500}),/save API unavailable/);const id=await requestId(f.control);
 await appendFile(f.log,`[VoltraSave] rejected ${id} save API unavailable\n`);await result;
 await assert.rejects(stat(join(f.control,'save.lock')),e=>e.code==='ENOENT');
});
test('concurrent requests cannot overwrite each other',async t=>{
 const f=await fixture(t);const result=assert.rejects(saveGame({docsDir:f.dir,timeoutMs:350}),/timed out/);await requestId(f.control);
 await assert.rejects(saveGame({docsDir:f.dir}),/Another save/);await result;
});
test('truncated log cannot confirm a save',async t=>{
 const f=await fixture(t);await appendFile(f.log,'x'.repeat(500));const result=assert.rejects(saveGame({docsDir:f.dir,timeoutMs:1500}),/session changed/);await requestId(f.control);
 await writeFile(f.log,'Game saved successfully (savegame1).\n');await result;
});
test('worker connects a session-scoped panel request to a fresh engine confirmation',async t=>{
 const f=await fixture(t);
 const child=spawn(process.execPath,[fileURLToPath(new URL('../../internal/panel/game_library/fs25/lib/save-worker.mjs',import.meta.url))],{env:{...process.env,DOCS_DIR:f.dir},stdio:'ignore'});
 const closed=new Promise(resolve=>child.once('close',resolve));
 const waitJSON=async(name,predicate)=>{for(let i=0;i<100;i++){try{const value=JSON.parse(await readFile(join(f.control,name),'utf8'));if(predicate(value))return value;}catch{}await new Promise(r=>setTimeout(r,30));}throw Error('Worker response missing: '+name);};
 try {
  const state=await waitJSON('state.json',s=>s.protocol===1);
  const id='b'.repeat(32);
  await writeFile(join(f.control,'control.json'),JSON.stringify({id,session:state.session,action:'save',expires_at:Date.now()+5000}));
  const nativeId=await requestId(f.control);
  await appendFile(f.log,`[VoltraSave] requested ${nativeId}\nGame saved successfully (savegame1).\n`);
  const result=await waitJSON('result.json',r=>r.id===id);
  assert.equal(result.session,state.session);assert.equal(result.success,true);assert.match(result.confirmation,/Game saved successfully/);
 } finally {child.kill();await closed;}
});

for(const stopStatus of [200,500])test(`save-and-stop waits for native save and checks portal stop, HTTP ${stopStatus}`,async t=>{
 const f=await fixture(t);let stops=0,polls=0;
 const portal=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  const params=new URLSearchParams(body);
  if(params.has('login')) {res.setHeader('Set-Cookie','SessionID=test; Path=/');res.end('ok');return;}
  if(params.has('stop_server')) {stops++;res.statusCode=stopStatus;res.end('stop response');return;}
  if(stops)polls++;
  res.end(`<input type="submit" name="${stops&&polls>=3?'start_server':'stop_server'}">`);
 });});
 await new Promise(r=>portal.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,[fileURLToPath(new URL('../../internal/panel/game_library/fs25/lib/save-worker.mjs',import.meta.url))],{env:{...process.env,DOCS_DIR:f.dir,WEB_HOST:'127.0.0.1',WEB_PORT:String(portal.address().port),WEB_PASSWORD:'fixture'},stdio:'ignore'});
 const closed=new Promise(resolve=>child.once('close',resolve));
 const waitJSON=async(name,predicate)=>{for(let i=0;i<150;i++){try{const value=JSON.parse(await readFile(join(f.control,name),'utf8'));if(predicate(value))return value;}catch{}await new Promise(r=>setTimeout(r,30));}throw Error('Worker response missing: '+name);};
 try {
  const state=await waitJSON('state.json',s=>s.protocol===1);const id='c'.repeat(32);
  await writeFile(join(f.control,'control.json'),JSON.stringify({id,session:state.session,action:'save-and-stop',expires_at:Date.now()+5000}));
  const nativeId=await requestId(f.control);
  await new Promise(r=>setTimeout(r,300));assert.equal(stops,0,'must not stop before save confirmation');
  await appendFile(f.log,`[VoltraSave] requested ${nativeId}\nGame saved successfully (savegame1).\n`);
  const result=await waitJSON('result.json',r=>r.id===id);
  assert.equal(stops,1);assert.equal(result.success,stopStatus===200);
  if(stopStatus===200){assert.equal(result.stopped,true);assert.ok(polls>=3,'must wait for offline state');}
 } finally {child.kill();await closed;await new Promise(r=>portal.close(r));}
});
