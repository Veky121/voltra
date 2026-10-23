import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {claim,release,resize,replacePort,transact} from './batch-queue.mjs';
const plan={games:['a','b','c'].map(path=>({path,state:'queued'}))};
const limits={memory_mib:100,disk_mib:200,reserved_disk_mib:20,max_active:2,port_min:28000,port_max:28005};
const req=(game,owner='worker')=>({game,owner,memory_mib:40,disk_mib:80,ports:2});
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
