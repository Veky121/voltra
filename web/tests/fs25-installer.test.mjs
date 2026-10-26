import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'../../internal/panel/game_library/fs25');
const {allowed,download,run}=await import(pathToFileURL(root+'/lib/download-game.mjs'));

test('GIANTS host allowlist rejects other hosts and credentials',()=>{
 for(const url of ['http://cdn1.giants-software.com/a','https://cdn1.giants-software.com.evil.test/a','https://user:pass@cdn1.giants-software.com/a','https://cdn1.giants-software.com:444/a','https://127.0.0.1/a']) assert.equal(allowed(url),false);
 assert.equal(allowed('https://cdn12.giants-software.com/a'),true);
});
test('download rejects off-host redirects and leaves no executable partial',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fs25-'));const original=global.fetch;
 try{
  global.fetch=async()=>new Response(null,{status:302,headers:{location:'https://example.com/evil.exe'}});
  await assert.rejects(download('https://cdn1.giants-software.com/FarmingSimulator25_test.exe',dir,1024),/redirect host/);
  global.fetch=async()=>new Response('<html>Login required</html>',{headers:{'content-type':'text/html'}});
  await assert.rejects(download('https://cdn1.giants-software.com/FarmingSimulator25_test.exe',dir,1024),/ticket/);
  global.fetch=async()=>new Response('short',{status:200,headers:{'content-length':'100','content-type':'application/octet-stream'}});
  await assert.rejects(download('https://cdn1.giants-software.com/FarmingSimulator25_test.exe',dir,1024),/Incomplete/);
  assert.equal(existsSync(join(dir,'FarmingSimulator25_test.exe')),false);
  assert.equal(existsSync(join(dir,'FarmingSimulator25_test.exe.partial')),false);
  global.fetch=async()=>new Response('complete',{status:200,headers:{'content-type':'application/octet-stream'}});
  await download('https://cdn1.giants-software.com/FarmingSimulator25_test.exe',dir,1024);
  assert.equal(readFileSync(join(dir,'FarmingSimulator25_test.exe'),'utf8'),'complete');
 }finally{global.fetch=original;rmSync(dir,{recursive:true,force:true});}
});
test('uploaded installer prevents a portal request',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fs25-'));const original=global.fetch;
 const old={...process.env};
 try{process.env.AUTO_DOWNLOAD='true';process.env.INSTALLER_DIR=dir;process.env.DLC_DIR=join(dir,'dlc');writeFileSync(join(dir,'Setup.exe'),'uploaded');global.fetch=async()=>{throw Error('must not fetch');};await run();}
 finally{global.fetch=original;process.env=old;rmSync(dir,{recursive:true,force:true});}
});
test('XML renderer escapes passwords and names without interpreting substitutions',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fs25-'));
 try{
  const game=join(dir,'game'),dedi=join(dir,'dedi');mkdirSync(game);mkdirSync(dedi);
  writeFileSync(join(dedi,'dedicatedServerConfig.xml'),'<gameserver><mods><mod filename="macDonPack" isDlc="true" /></mods></gameserver>');
  const result=spawnSync(process.execPath,[join(root,'lib/configure.mjs')],{env:{...process.env,GAME_DIR:game,DEDI_DIR:dedi,FS25_CONFIG:join(root,'config'),WEB_PORT:'7999',WEB_USERNAME:'admin',WEB_PASSWORD:'<pass&"word>',SERVER_NAME:'Farm & <friends> | $HOME'}});
  assert.equal(result.status,0,result.stderr.toString());
  assert.match(readFileSync(join(game,'dedicatedServer.xml'),'utf8'),/&lt;pass&amp;&quot;word&gt;/);
  assert.match(readFileSync(join(dedi,'dedicatedServerConfig.xml'),'utf8'),/Farm &amp; &lt;friends&gt; \| \$HOME/);
  assert.match(readFileSync(join(dedi,'dedicatedServerConfig.xml'),'utf8'),/<mod filename="macDonPack" isDlc="true"/);
  assert.doesNotMatch(result.stdout.toString(),/pass|friends/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
