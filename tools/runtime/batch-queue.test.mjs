import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {claim,claimUtility,claimReviewedRetry,claimReviewedUtilityRetry,release,resize,replacePort,transact} from './batch-queue.mjs';
const plan={games:['a','b','c'].map(path=>({path,state:'queued'}))};
const limits={memory_mib:100,disk_mib:200,reserved_disk_mib:20,max_active:2,port_min:28000,port_max:28005};
test('reviewed utility retries preserve identity, history and zero-port resource bounds',()=>{
 const state={claims:[]},request={task:'metadata',owner:'probe',memory_mib:10,disk_mib:30,ports:0};
 const old=claimUtility(state,request,limits);release(state,old.lease_id,'probe','tested',true);const original=structuredClone(old);
 const retry={...request,disk_mib:60,retry_review:{lease_id:old.lease_id,game:'utility/metadata',resources_removed:true,reviewer:'root',cleanup_receipt:'artifacts/cleanup.json',cleanup_sha256:'b'.repeat(64)}};
 assert.throws(()=>claimUtility(state,request,limits),/already/);
 assert.throws(()=>claimReviewedUtilityRetry(state,{...retry,game:'a'},limits),/catalog/);
 assert.throws(()=>claimReviewedUtilityRetry(state,{...retry,task:'renamed'},limits),/latest/);
 assert.throws(()=>claimReviewedUtilityRetry(state,{...retry,disk_mib:181},limits),/budget/);
 assert.deepEqual(old,original);assert.equal(state.claims.length,1);
 const next=claimReviewedUtilityRetry(state,retry,limits);assert.deepEqual(next.ports,[]);assert.equal(next.kind,'utility');assert.equal(next.task,'metadata');assert.equal(next.retry_of,old.lease_id);assert.deepEqual(old,original);
});
test('legacy requeue cannot rewrite terminal acceptance history',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'batch-requeue-'));
 try {
  const statePath=path.join(dir,'queue.json');
  const original={claims:[{lease_id:'prior',owner:'worker',game:'a',status:'tested'}]};
  fs.writeFileSync(statePath,JSON.stringify(original));
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./batch-queue.mjs',import.meta.url)),'requeue',JSON.stringify({lease_id:'prior',owner:'worker'})],{encoding:'utf8',windowsHide:true,env:{...process.env,GAME_BATCH_STATE:statePath}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Historical outcomes are retained/);
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath)),original);
  assert.equal(fs.existsSync(statePath+'.lock'),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('reviewed retries retain terminal history and enforce reservations, budgets and latest cleanup',()=>{
 const state={claims:[]};const first=claim(state,plan,req('a'),limits);
 release(state,first.lease_id,'worker','tested',true);
 const original=structuredClone(first);
 const retry={...req('a'),retry_review:{lease_id:first.lease_id,game:'a',resources_removed:true,reviewer:'root',cleanup_receipt:'artifacts/cleanup.json',cleanup_sha256:'a'.repeat(64)}};
 assert.throws(()=>claim(state,plan,retry,limits),/already/);
 for(const delta of [{lease_id:'wrong'},{game:'b'},{resources_removed:false},{cleanup_sha256:''},{cleanup_receipt:'artifacts/../outside.json'}]){
  assert.throws(()=>claimReviewedRetry(state,plan,{...retry,retry_review:{...retry.retry_review,...delta}},limits));
  assert.equal(state.claims.length,1);assert.deepEqual(first,original);
 }
 state.reservations=[{game:'a',owner:'other'}];
 assert.throws(()=>claimReviewedRetry(state,plan,retry,limits),/reserved/);state.reservations=[];
 assert.throws(()=>claimReviewedRetry(state,plan,retry,{...limits,reserved_disk_mib:150}),/budget/);
 const second=claimReviewedRetry(state,plan,retry,limits);
 assert.notEqual(second.lease_id,first.lease_id);assert.equal(second.retry_of,first.lease_id);
 assert.deepEqual(first,original);assert.deepEqual(second.ports,first.ports);
 assert.throws(()=>claimReviewedRetry(state,plan,retry,limits),/latest|already/);
 release(state,second.lease_id,'worker','blocked',true);
 assert.throws(()=>claimReviewedRetry(state,plan,retry,limits),/latest/);
 assert.throws(()=>claimReviewedRetry(state,{games:[{path:'a',state:'reserved_reviewed'}]},retry,limits),/queued/);
});
const req=(game,owner='worker')=>({game,owner,memory_mib:40,disk_mib:80,ports:2});

test('utility leases share game budgets and cleanup guards without catalog entries or listener ports',()=>{
 const state={claims:[]},utility={task:'parser-proof',owner:'probe',memory_mib:40,disk_mib:80,ports:0};
 const u=claimUtility(state,utility,limits);assert.equal(u.kind,'utility');assert.deepEqual(u.ports,[]);
 assert.throws(()=>claimUtility(state,utility,limits),/already/);
 assert.throws(()=>claimUtility(state,{...utility,game:'a'},limits),/catalog/);
 assert.throws(()=>claimUtility(state,{...utility,task:'../escape'},limits),/label/);
 assert.throws(()=>claimUtility(state,{...utility,task:'other',ports:-1},limits),/nonnegative/);
 const game=claim(state,plan,req('a'),limits);assert.deepEqual(game.ports,[28000,28001]);
 assert.throws(()=>claim(state,plan,req('b'),limits),/budget/);
 assert.throws(()=>release(state,u.lease_id,'probe','released',false),/confirmation/);
 release(state,u.lease_id,'probe','released',true);
 claim(state,plan,req('b'),limits);
});
test('leases enforce port isolation, weighted budgets and cleanup before reuse',()=>{
 const state={claims:[]}; const a=claim(state,plan,req('a'),limits),b=claim(state,plan,req('b'),limits);
 assert.deepEqual(a.ports,[28000,28001]); assert.deepEqual(b.ports,[28002,28003]);
 assert.throws(()=>claim(state,plan,req('c'),limits),/budget/);
 assert.throws(()=>release(state,a.lease_id,'other','released',true),/owner/);
 assert.throws(()=>release(state,a.lease_id,'worker','released',false),/confirmation/);
 release(state,a.lease_id,'worker','released',true);
 assert.deepEqual(claim(state,plan,req('c'),limits).ports,[28000,28001]);
});
test('reservations, duplicates and reviewed games cannot be stolen',()=>{
 const state={claims:[],reservations:[{game:'a',owner:'alice'}]};
 assert.throws(()=>claim(state,plan,req('a'),limits),/reserved/);
 claim(state,plan,req('a','alice'),limits);
 assert.throws(()=>claim(state,plan,req('a','alice'),limits),/already/);
 assert.throws(()=>claim(state,{games:[{path:'b',state:'reserved_reviewed'}]},req('b'),limits),/reserved/);
});
test('cache headroom counts against disk allocation',()=>{
 assert.throws(()=>claim({claims:[]},plan,req('a'),{...limits,reserved_disk_mib:150}),/budget/);
});
test('stopped resize retains disk/ports and cannot overbook reacquisition',()=>{
 const state={claims:[]};const a=claim(state,plan,req('a'),limits);claim(state,plan,req('b'),limits);
 const request={lease_id:a.lease_id,owner:'worker',memory_mib:10,stopped_confirmed:true};
 assert.throws(()=>resize(state,{...request,stopped_confirmed:false},limits),/stopped/);
 assert.throws(()=>resize(state,{...request,owner:'other'},limits),/owned/);
 resize(state,request,limits);assert.equal(a.memory_mib,10);assert.equal(a.disk_mib,80);assert.deepEqual(a.ports,[28000,28001]);assert.equal(a.status,'active');
 assert.throws(()=>resize(state,{...request,memory_mib:70},limits),/budget/);
 resize(state,{...request,memory_mib:60},limits);assert.equal(a.resource_changes.length,2);
});
test('atomic lock prevents concurrent writers and survives failed operations',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'batch-test-')); const file=path.join(dir,'state.json');
 try {
  transact(file,state=>{state.claims.push({test:1}); assert.throws(()=>transact(file,()=>{}),/EEXIST/);});
  assert.equal(JSON.parse(fs.readFileSync(file)).claims.length,1);
  assert.throws(()=>transact(file,()=>{throw Error('abort');}),/abort/);
  assert.equal(fs.existsSync(file+'.lock'),false);
 } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('disk resize counts other leases and cache reserve, with atomic failure and owner guards',()=>{
 const state={claims:[]};const a=claim(state,plan,req('a'),limits);claim(state,plan,req('b'),limits);
 const request={lease_id:a.lease_id,owner:'worker',disk_mib:100,stopped_confirmed:true};
 const unchanged=structuredClone(state);
 for(const [input,budget,reason] of [
  [{...request,owner:'other'},limits,/owned/],
  [{...request,stopped_confirmed:false},limits,/stopped/],
  [{...request,disk_mib:101},limits,/budget/],
  [{...request,memory_mib:70},limits,/budget/],
  [{...request,disk_mib:0},limits,/positive/],
  [request,{...limits,reserved_disk_mib:-1},/reserved_disk/],
 ]){assert.throws(()=>resize(state,input,budget),reason);assert.deepEqual(state,unchanged);}
 resize(state,request,limits);assert.equal(a.disk_mib,100);assert.equal(a.memory_mib,40);assert.deepEqual(a.ports,[28000,28001]);
 assert.equal(a.resource_changes[0].previous_disk_mib,80);
 resize(state,{...request,disk_mib:90,memory_mib:60},limits);assert.equal(a.disk_mib,90);assert.equal(a.memory_mib,60);
 assert.throws(()=>resize(state,{lease_id:a.lease_id,owner:'worker',stopped_confirmed:true},limits),/requires/);
});

test('stopped port replacement preserves budgets and rejects overlap, theft and unreviewed range',()=>{
 const state={claims:[]};const a=claim(state,plan,req('a'),limits);claim(state,plan,req('b'),limits);
 const request={owner:'worker',lease_id:a.lease_id,from_port:28001,to_port:27003,stopped_confirmed:true};
 const reviewed={port_min:27003,port_max:27003};
 assert.throws(()=>replacePort(state,{...request,owner:'other'},reviewed),/owned/);
 assert.throws(()=>replacePort(state,{...request,stopped_confirmed:false},reviewed),/stopped/);
 assert.throws(()=>replacePort(state,request,limits),/reviewed/);
 assert.throws(()=>replacePort(state,{...request,to_port:28002},limits),/reserved/);
 assert.throws(()=>replacePort(state,{...request,from_port:28005},reviewed),/not reserved/);
 replacePort(state,request,reviewed);
 assert.deepEqual(a.ports,[28000,27003]);assert.equal(a.memory_mib,40);assert.equal(a.disk_mib,80);assert.equal(a.status,'active');
 assert.equal(a.port_changes.length,1);assert.equal(state.claims.length,2);
});
