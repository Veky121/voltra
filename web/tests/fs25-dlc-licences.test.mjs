import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {dlcLicences,installerKey} from '../../internal/panel/game_library/fs25/lib/dlc-licences.mjs';
import {logRedactor} from '../../internal/panel/game_library/fs25/lib/console-logs.mjs';
import {run} from '../../internal/panel/game_library/fs25/lib/download-game.mjs';
import {verifyPendingDLCs} from '../../internal/panel/game_library/fs25/lib/dlc-state.mjs';

test('each admin DLC installer resolves only its assigned key and rejects ambiguous uploads',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fs25-keys-'));
 const environment={FS25_LIB:dir,GAME_SERIAL:'BASE-KEY',DLC_PRODUCT_KEY:JSON.stringify([{id:'1',name:'One',key:'DLC-ONE'},{id:'2',name:'Two',key:'DLC-TWO'}])};
 try {
  writeFileSync(join(dir,'dlc-downloads.json'),JSON.stringify({'FarmingSimulator25_One.exe':'1','FarmingSimulator25_Two.exe':'2'}));
  assert.equal(installerKey('FarmingSimulator25_One.exe',environment),'DLC-ONE');
  assert.equal(installerKey('FarmingSimulator25_Two.exe',environment),'DLC-TWO');
  assert.throws(()=>installerKey('FarmingSimulator25_Unknown.exe',environment),/no matching/);
  environment.DLC_PRODUCT_KEY='[]';assert.throws(()=>installerKey('FarmingSimulator25_One.exe',environment),/no longer assigned/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('legacy single-key installs remain readable and invalid admin data never leaks its contents',()=>{
 assert.equal(dlcLicences({DLC_PRODUCT_KEY:'LEGACY-KEY'})[0].key,'LEGACY-KEY');
 assert.throws(()=>dlcLicences({DLC_PRODUCT_KEY:'[{"key":"PRIVATE"'}),error=>!error.message.includes('PRIVATE'));
 assert.throws(()=>dlcLicences({DLC_PRODUCT_KEY:JSON.stringify([{id:'bad/id',key:'PRIVATE'}])}),error=>!error.message.includes('PRIVATE'));
});

test('individual keys inside an encrypted-snapshot JSON environment are masked in console output',()=>{
 const redact=logRedactor({DLC_PRODUCT_KEY:JSON.stringify([{id:'1',key:'ABCDE-FGHIJ-KLMNO-PQRST'}])});
 assert.doesNotMatch(redact('ABCDE-FGHIJ-KLMNO-PQRST ABCDEFGHIJKLMNOPQRST'),/ABCDE/);
});

test('multiple admin keys each fetch their own portal products and persist a non-secret installer mapping',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fs25-multi-')),downloads=[],keys=[];
 const environment={FS25_LIB:dir,INSTALLER_DIR:dir,DLC_DIR:join(dir,'dlc'),AUTO_DOWNLOAD:'true',DOWNLOAD_DLC:'true',GAME_SERIAL:'BASE',DLC_PRODUCT_KEY:JSON.stringify([{id:'1',name:'One',key:'KEY-ONE'},{id:'2',name:'Two',key:'KEY-TWO'}])};
 const form=(id,key)=>`<form class="download-primary-form" method="post" action="/download.php" data-default-downloads="{&quot;windows&quot;:{&quot;id&quot;:${id},&quot;caption&quot;:&quot;Windows EXE&quot;}}"><input type="hidden" name="activationKey" value="${key}"></form>`;
 try {
  await run({environment,onlyDLC:true,fetchImpl:async(url,options)=>{
   const key=options.body.get('activationKey');
   if(url.endsWith('/downloads.php')) {keys.push(key);return new Response(key==='BASE'?'No DLC':form(key==='KEY-ONE'?101:102,key));}
   const id=options.body.get('downloadId');assert.equal(key,id==='101'?'KEY-ONE':'KEY-TWO');
   return new Response(null,{status:302,headers:{location:`https://cdn1.giants-software.com/FarmingSimulator25_Pack${id}.exe`}});
  },downloadFile:async(url)=>downloads.push(url)});
  assert.deepEqual(keys,['BASE','KEY-ONE','KEY-TWO']);assert.equal(downloads.length,2);
  assert.equal(installerKey('FarmingSimulator25_Pack101.exe',environment),'KEY-ONE');
  assert.equal(installerKey('FarmingSimulator25_Pack102.exe',environment),'KEY-TWO');
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('DLC is verified only after the engine loads it and enters gameplay without a licence error',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fs25-validation-')),marker='.pending-'+'a'.repeat(64);
 try {
  writeFileSync(join(dir,marker),'macDonPack.dlc\n');
  const loaded='2026-10-26 05:54:26.798   Load dlc: pdlc_macDonPack\n';
  const ready='2026-10-26 05:56:44.624   Info: Entered Gameplay\n';
  assert.equal(verifyPendingDLCs(dir,'Available dlc: pdlc_macDonPack\n'+ready,()=>{}),0);
  assert.equal(verifyPendingDLCs(dir,loaded,()=>{}),0);
  assert.equal(verifyPendingDLCs(dir,loaded+ready+'Error: DLC licence not activated\n',()=>{}),0);
  assert.equal(verifyPendingDLCs(dir,loaded+ready,()=>{}),1);
  assert.equal(existsSync(join(dir,marker)),false);
  assert.equal(existsSync(join(dir,marker.replace('.pending-','.installed-'))),true);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
