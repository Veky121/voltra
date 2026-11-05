import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installerInfo,latestInstallers,begin,complete,rollback,markerValid,digest,recover,preventDowngrades} from '../../internal/panel/game_library/fs25/lib/dlc-update.mjs';
import {verifyPendingDLCs} from '../../internal/panel/game_library/fs25/lib/dlc-state.mjs';
import {download} from '../../internal/panel/game_library/fs25/lib/download-game.mjs';

const file='FarmingSimulator25_pumpsAndHosesPack_1_2_1_0_ESD.exe';
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'fs25-update-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const env={DOCS_DIR:join(root,'data'),DLC_DIR:join(root,'dlc')};
  mkdirSync(join(env.DOCS_DIR,'pdlc'),{recursive:true});mkdirSync(env.DLC_DIR);
  return {env,payload:join(env.DOCS_DIR,'pdlc/pumpsAndHosesPack.dlc'),info:installerInfo(file)};
}
test('selects one numeric latest installer per product, ignoring unsupported filenames',()=>{
  assert.deepEqual(latestInstallers([file,file.replace('_1_2_1_0','_1_10_0_0'),file.replace('_1_2_1_0','_1_2_0_0'),'other.exe']).map(x=>x.version),[[1,10,0,0]]);
});
test('failed same-name replacement restores exact old bytes',async t=>{
  const {env,payload,info}=fixture(t);writeFileSync(payload,'old working bytes');
  await begin(info,env);assert.equal(existsSync(payload),false);
  writeFileSync(payload,'incomplete new');rollback(info,env);
  assert.equal(readFileSync(payload,'utf8'),'old working bytes');
});
test('interrupted update is recovered before another attempt',async t=>{
  const {env,payload,info}=fixture(t);writeFileSync(payload,'old');
  await begin(info,env);writeFileSync(payload,'partial');await begin(info,env);
  rollback(info,env);assert.equal(readFileSync(payload,'utf8'),'old');
});
test('fresh failed installation removes partial payload',async t=>{
  const {env,payload,info}=fixture(t);await begin(info,env);writeFileSync(payload,'partial');rollback(info,env);
  assert.equal(existsSync(payload),false);
});
test('removing the newest installer cannot trigger a downgrade to a leftover old installer',async t=>{
  const {env,payload,info}=fixture(t);await begin(info,env);writeFileSync(payload,'new');await complete(info,'a'.repeat(64),env);
  assert.deepEqual(preventDowngrades(latestInstallers([file.replace('_1_2_1_0','_1_2_0_0')]),env.DLC_DIR),[]);
});
test('startup recovers interruption even if installer has been removed',async t=>{
  const {env,payload,info}=fixture(t);writeFileSync(payload,'old');
  await begin(info,env);writeFileSync(payload,'partial');await recover(env);
  assert.equal(readFileSync(payload,'utf8'),'old');
});
test('startup retains a complete pending replacement for game validation',async t=>{
  const {env,payload,info}=fixture(t);writeFileSync(payload,'old');
  await begin(info,env);writeFileSync(payload,'new');await complete(info,'b'.repeat(64),env);await recover(env);
  assert.equal(readFileSync(payload,'utf8'),'new');
  assert.equal(readFileSync(join(env.DOCS_DIR,'pdlc/.voltra-update/pumpsAndHosesPack.dlc'),'utf8'),'old');
});
test('empty replacements never receive a pending marker',async t=>{
  const {env,payload,info}=fixture(t);await begin(info,env);writeFileSync(payload,'');
  await assert.rejects(complete(info,'a'.repeat(64),env));
});
test('same-name update requires exact game version and gameplay before discarding backup',async t=>{
  const {env,payload,info}=fixture(t),hash='a'.repeat(64);
  writeFileSync(payload,'old');await begin(info,env);writeFileSync(payload,'new');await complete(info,hash,env);
  assert.equal(await markerValid(info,hash,env),true);
  const log='2026-11-03 18:00:00.000 Load dlc: pdlc_pumpsAndHosesPack\n2026-11-03 18:00:01.000 Info: Entered Gameplay\n';
  assert.equal(verifyPendingDLCs(env.DLC_DIR,'Available dlc: (Version: 1.2.0.0) pdlc_pumpsAndHosesPack\n'+log,()=>{},env.DOCS_DIR),0);
  assert.equal(existsSync(join(env.DOCS_DIR,'pdlc/.voltra-update/pumpsAndHosesPack.dlc')),true);
  assert.equal(verifyPendingDLCs(env.DLC_DIR,'Available dlc: (Version: 1.2.1.0) pdlc_pumpsAndHosesPack\n'+log,()=>{},env.DOCS_DIR),1);
  assert.equal(existsSync(join(env.DOCS_DIR,'pdlc/.voltra-update/pumpsAndHosesPack.dlc')),false);
  assert.equal(await markerValid(info,hash,env),true);
  writeFileSync(payload,'changed');assert.equal(await markerValid(info,hash,env),false);
});
test('download receipt detects corrupt cache, then reuses verified bytes',async t=>{
  const {env}=fixture(t),url='https://cdn.giants-software.com/'+file;
  let calls=0;
  const options={fetchImpl:async()=>{calls++;return new Response('installer',{headers:{'content-length':'9','content-type':'application/octet-stream'}});}};
  writeFileSync(join(env.DLC_DIR,file),'bad cache');
  await download(url,env.DLC_DIR,100,options);assert.equal(calls,1);
  await download(url,env.DLC_DIR,100,options);assert.equal(calls,1);
  writeFileSync(join(env.DLC_DIR,file),'corrupted');
  await download(url,env.DLC_DIR,100,options);assert.equal(calls,2);
  assert.equal(JSON.parse(readFileSync(join(env.DLC_DIR,file+'.verified.json'))).sha256,await digest(join(env.DLC_DIR,file)));
});
test('short download keeps previous cache and deletes partial data',async t=>{
  const {env}=fixture(t),target=join(env.DLC_DIR,file);writeFileSync(target,'old');
  await assert.rejects(download('https://cdn.giants-software.com/'+file,env.DLC_DIR,100,{fetchImpl:async()=>new Response('short',{headers:{'content-length':'10','content-type':'application/octet-stream'}})}));
  assert.equal(readFileSync(target,'utf8'),'old');assert.equal(existsSync(target+'.partial'),false);
});
test('console download progress includes measured percent, rate and ETA without URLs',async t=>{
  const {env}=fixture(t),lines=[],original=console.log;
  console.log=line=>lines.push(String(line));t.after(()=>{console.log=original;});
  let tick=0;
  await download('https://cdn.giants-software.com/'+file+'?token=SECRET',env.DLC_DIR,100,{
    now:()=>{tick+=6000;return tick;},
    fetchImpl:async()=>new Response(new Uint8Array(9),{headers:{'content-length':'9','content-type':'application/octet-stream'}}),
  });
  assert.match(lines.join('\n'),/100\.0%.*MiB\/s, ETA/);
  assert.doesNotMatch(lines.join('\n'),/SECRET|https:/);
});
