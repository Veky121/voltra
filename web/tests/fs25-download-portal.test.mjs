import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {portalDownloads,portalSession,run,safeDownloadError} from '../../internal/panel/game_library/fs25/lib/download-game.mjs';

const portal='https://eshop.giants-software.com';
const fixture=(action='/download.php')=>`<form class="download-primary-form" method="post" action="${action}" data-default-downloads="{&quot;windows&quot;:{&quot;id&quot;:739,&quot;caption&quot;:&quot;Windows · IMG · 21.76 GB&quot;},&quot;macos&quot;:{&quot;id&quot;:740,&quot;caption&quot;:&quot;macOS · DMG&quot;}}"><input type="hidden" name="activationKey" value="TEST-SECRET"><input type="hidden" name="downloadId" value=""></form>`;

test('current GIANTS forms choose the explicit Windows download even with an empty default',()=>{
 const [game]=portalDownloads(fixture());
 assert.equal(game.kind,'game');
 assert.equal(game.fields.get('downloadId'),'739');
 assert.equal(game.fields.get('activationKey'),'TEST-SECRET');
 assert.deepEqual(portalDownloads(fixture('https://evil.test/download.php')),[]);
 assert.deepEqual(portalDownloads(fixture('https://[')),[]);
 assert.deepEqual(portalDownloads(fixture().replace('Windows · IMG','macOS · IMG')),[]);
});

test('a portal session retains cookies, returns only allowlisted CDN tickets, and never fetches the ticket',async()=>{
 const calls=[];
 const session=portalSession(async(url,options)=>{
  calls.push({url,options});
  return calls.length===1?new Response('page',{headers:{'set-cookie':'session=test; Secure; HttpOnly'}}):new Response(null,{status:302,headers:{location:'https://cdn1.giants-software.com/FarmingSimulator25_test_ESD.img?token=private'}});
 });
 await session(portal+'/downloads.php',{method:'POST',body:new URLSearchParams({activationKey:'TEST-SECRET'})});
 const url=await session(portal+'/download.php',{method:'POST'},true);
 assert.equal(calls.length,2);
 assert.equal(calls[1].options.headers.Cookie,'session=test');
 assert.equal(calls[1].options.headers.Referer,portal+'/downloads.php');
 assert.match(url,/^https:\/\/cdn1\./);
 const blocked=portalSession(async()=>new Response(null,{status:302,headers:{location:'https://evil.test/download.php'}}));
 await assert.rejects(blocked(portal+'/download.php',{},true));
});

test('the full current portal flow posts the Windows id and delivers the authorised URL to the downloader',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fs25-portal-'));const calls=[],downloads=[];
 try {
  await run({environment:{AUTO_DOWNLOAD:'true',DOWNLOAD_DLC:'false',GAME_SERIAL:'TEST-SECRET',INSTALLER_DIR:dir,DLC_DIR:join(dir,'dlc')},fetchImpl:async(url,options)=>{
   calls.push(url);
   assert.equal(options.body.get('activationKey'),'TEST-SECRET');
   if(calls.length===1) return new Response(fixture());
   assert.equal(options.body.get('downloadId'),'739');
   return new Response(null,{status:302,headers:{location:'https://cdn1.giants-software.com/FarmingSimulator25_test_ESD.img?token=private'}});
  },downloadFile:async(...args)=>downloads.push(args)});
  assert.deepEqual(calls,[portal+'/downloads.php',portal+'/download.php']);
  assert.equal(downloads.length,1);
  assert.equal(downloads[0][1],dir);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('download errors cannot print a credential, signed URL, or raw provider response',()=>{
 const error=Object.assign(new Error('TEST-SECRET https://cdn1.giants-software.com/?token=private'),{downloadCode:'not-a-safe-code'});
 assert.doesNotMatch(safeDownloadError(error),/SECRET|private|https/);
 assert.match(safeDownloadError({code:'ENOSPC'}),/disk space/);
 assert.match(safeDownloadError({downloadCode:'ticket'}),/authorise/);
});

test('DLC-only mode requests the Windows DLC without issuing a base-game ticket',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fs25-dlc-'));const ids=[],downloads=[];
 const dlc=fixture().replace('739','695').replace('Windows · IMG · 21.76 GB','Windows · EXE · 136 MB');
 try {
  await run({onlyDLC:true,environment:{AUTO_DOWNLOAD:'true',DOWNLOAD_DLC:'true',GAME_SERIAL:'TEST-SECRET',INSTALLER_DIR:dir,DLC_DIR:join(dir,'dlc')},fetchImpl:async(url,options)=>{
   if(url.endsWith('/downloads.php')) return new Response(fixture()+dlc);
   ids.push(options.body.get('downloadId'));
   return new Response(null,{status:302,headers:{location:'https://cdn1.giants-software.com/FarmingSimulator25_MacDon_test.exe'}});
  },downloadFile:async(...args)=>downloads.push(args)});
  assert.deepEqual(ids,['695']);
  assert.equal(downloads[0][1],join(dir,'dlc'));
 } finally {rmSync(dir,{recursive:true,force:true});}
});
