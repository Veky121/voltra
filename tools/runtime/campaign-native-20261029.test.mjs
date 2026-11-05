import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {policy,assertBudget,claimNative,claimNativeUtility,acquireInstallerState,releaseInstallerState,installerGate,proveInstaller,verifySnapshot,digest,dockerFailure,inspectListedContainers,classifyInstallOutcome} from './campaign-native-20261029.mjs';
const cap={ram:64*1024**3,disk:400*1024**3};
const row=(i=0)=>({lease_id:'lease'+i,owner:'owner',game:'game'+i,status:'active',memory_mib:128,disk_mib:1,ports:[29100+i],cpu_percent:100});
test('eight bounded leases allowed; ninth, CPU, memory, disk and host reserve refuse',()=>{
 const s={claims:Array.from({length:7},(_,i)=>row(i))},r={memory_mib:128,disk_mib:1};assert.doesNotThrow(()=>assertBudget(s,r,cap));
 assert.throws(()=>assertBudget({claims:[...s.claims,row(7)]},r,cap),/budget/);
 assert.throws(()=>assertBudget({claims:[{...row(),cpu_percent:800}]},r,cap),/budget/);
 assert.throws(()=>assertBudget({claims:[]},{...r,memory_mib:20481},cap),/budget/);
 assert.throws(()=>assertBudget({claims:[]},{...r,disk_mib:131073},cap),/budget/);
 assert.throws(()=>assertBudget({claims:[]},r,{...cap,ram:16*1024**3}),/headroom/);
 assert.throws(()=>assertBudget({claims:[]},r,{...cap,disk:100*1024**3}),/headroom/);
 assert.equal(policy.reserved_disk_mib,0);assert.equal(policy.disk_mib,128*1024);
});
test('conditional20GiB ceiling never overrides the16GiB host reserve or disk/CPU/count bounds',()=>{
 const gi=1024**3;
 assert.equal(policy.memory_mib,20*1024);assert.equal(policy.host_free_memory_bytes,16*gi);
 assert.equal(policy.max_active,8);assert.equal(policy.cpu_percent,800);assert.equal(policy.physical_disk_reserve_mib,16*1024);assert.equal(policy.host_free_disk_bytes,100*gi);
 const empty={claims:[]},full={memory_mib:20*1024,disk_mib:1};
 assert.doesNotThrow(()=>assertBudget(empty,full,{ram:36*gi,disk:cap.disk}));
 assert.throws(()=>assertBudget(empty,full,{ram:36*gi-1,disk:cap.disk}),/headroom/);
 const state={claims:[{...row(0),memory_mib:8192},{...row(1),memory_mib:5632}]},six={memory_mib:6144,disk_mib:49152};
 assert.doesNotThrow(()=>assertBudget(state,six,{ram:36*gi,disk:cap.disk}));
 assert.throws(()=>assertBudget(state,six,{ram:35.5*gi-1,disk:cap.disk}),/headroom/);
 assert.throws(()=>assertBudget(state,{...six,memory_mib:6657},cap),/budget/);
});
test('atomic queue claims preserve history and allocate requested port count; reviewed 27015 conflict refuses',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'campaign-native-'));try{
 const statePath=path.join(dir,'queue.json');fs.writeFileSync(statePath,JSON.stringify({claims:[],campaign:'fixture'}));const plan={games:['a','b','c'].map(path=>({path,state:'queued'}))};
 const a=claimNative({game:'a',owner:'one',memory_mib:128,disk_mib:1,ports:1},{statePath,plan,capacity:cap});assert.deepEqual(a.ports,[29100]);
 const b=claimNative({game:'b',owner:'two',memory_mib:128,disk_mib:1,ports:2,fixed_ports:[29101,27015]},{statePath,plan,capacity:cap});assert.deepEqual(b.ports,[29101,27015]);
 const before=fs.readFileSync(statePath,'utf8');assert.throws(()=>claimNative({game:'c',owner:'three',memory_mib:128,disk_mib:1,ports:1,fixed_ports:[27015]},{statePath,plan,capacity:cap}),/conflicting/);assert.equal(fs.readFileSync(statePath,'utf8'),before);
 }finally{fs.rmSync(dir,{recursive:true});}
});
test('installer slot is exclusive, persistent and owner/token checked with no timeout reclaim',()=>{
 const s={claims:[row()]};const slot=acquireInstallerState(s,'lease0','owner',0);
 assert.throws(()=>acquireInstallerState(s,'lease0','owner',0),/occupied/);
 assert.throws(()=>releaseInstallerState(s,{...slot,token:'other'},0),/ownership/);
 assert.throws(()=>releaseInstallerState(s,slot,1),/active/);releaseInstallerState(s,slot,0);assert.equal(s.installer_history.length,1);assert.equal(s.installer_slot,undefined);
 assert.throws(()=>acquireInstallerState(s,'lease0','other',0),/owned/);
 s.activation_pause={owner:'root'};assert.throws(()=>acquireInstallerState(s,'lease0','owner',0),/activation pause/);assert.equal(s.installer_slot,undefined);
});
test('resource gate preserves canonical installer suffix and refuses unsafe token or actual limits',()=>{
 const token='12345678-1234-1234-1234-123456789abc',body='#!/bin/bash\necho native\n';assert.ok(installerGate(body,token).endsWith(body));assert.throws(()=>installerGate(body,'../x'));
 const c={Id:'fixture',Name:'/installer',State:{Running:true},HostConfig:{NetworkMode:'voltra-parity-20261029',Memory:128*1024**2,MemorySwap:128*1024**2,CpuPeriod:100000,CpuQuota:100000}};
 assert.doesNotThrow(()=>proveInstaller(c,row()));assert.throws(()=>proveInstaller({...c,HostConfig:{...c.HostConfig,MemorySwap:-1}},row()),/mismatch/);
});
test('frozen snapshot verification rejects altered bytes, manifest fingerprint and unsafe paths',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'campaign-snapshot-'));try{
 fs.writeFileSync(path.join(dir,'input.txt'),'original');const inputs=[{path:'input.txt',sha256:digest('original')}];let fingerprint=digest(JSON.stringify(inputs));
 const save=()=>fs.writeFileSync(path.join(dir,'snapshot-manifest.json'),JSON.stringify({inputs,fingerprint}));save();assert.equal(verifySnapshot(dir,fingerprint).inputs_verified,1);
 fs.writeFileSync(path.join(dir,'input.txt'),'changed');assert.throws(()=>verifySnapshot(dir,fingerprint),/drift/);fs.writeFileSync(path.join(dir,'input.txt'),'original');assert.throws(()=>verifySnapshot(dir,'0'.repeat(64)),/fingerprint/);
 inputs[0].path='../escape';fingerprint=digest(JSON.stringify(inputs));save();assert.throws(()=>verifySnapshot(dir,fingerprint),/Unsafe/);
 }finally{fs.rmSync(dir,{recursive:true});}
});
test('concurrent Docker disappearance is skipped without leaking inspect output or command secrets',()=>{
 const ids=['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)],seen=[];assert.deepEqual(inspectListedContainers(ids,id=>{seen.push(id);return id===ids[1]?null:{Id:id};}),[{Id:ids[0]},{Id:ids[2]}]);assert.deepEqual(seen,ids);
 const e=dockerFailure(['exec','private-token=SECRET'],1);assert.equal(e.exitStatus,1);assert.ok(!e.stack.includes('SECRET'));assert.deepEqual(Object.keys(e),['exitStatus']);assert.throws(()=>inspectListedContainers(['../bad'],()=>null),/Invalid/);
 assert.throws(()=>inspectListedContainers(ids,()=>{throw dockerFailure(['inspect'],1);}),/Docker inspect failed/);
});
test('retained installed1 during reinstall is not terminal success and reinstall_failed is failure',()=>{
 assert.equal(classifyInstallOutcome({status:'reinstalling',container:{installed:1}}),null);
 assert.equal(classifyInstallOutcome({status:'installing',container:{installed:1}}),null);
 assert.equal(classifyInstallOutcome({status:null,container:{installed:0}}),null);
 assert.equal(classifyInstallOutcome({container:{installed:1}}),null);
 assert.deepEqual(classifyInstallOutcome({status:'reinstall_failed',container:{installed:1}}),{status:'reinstall_failed',installed:1,success:false});
 assert.deepEqual(classifyInstallOutcome({status:'install_failed',container:{installed:0}}),{status:'install_failed',installed:0,success:false});
 assert.deepEqual(classifyInstallOutcome({status:null,container:{installed:1}}),{status:null,installed:1,success:true});
});
test('metadata utilities share host,CPU,lease budgets without stealing catalog recipes or ports',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'campaign-utility-'));try{
 const statePath=path.join(dir,'queue.json');fs.writeFileSync(statePath,JSON.stringify({claims:[]}));
 const row=claimNativeUtility({task:'css_info',owner:'metadata',memory_mib:512,disk_mib:1024,ports:0},{statePath,capacity:cap});assert.equal(row.kind,'utility');assert.equal(row.game,'utility/css_info');assert.equal(row.cpu_percent,100);assert.deepEqual(row.ports,[]);
 const before=fs.readFileSync(statePath,'utf8');assert.throws(()=>claimNativeUtility({task:'other',owner:'metadata',game:'catalog',memory_mib:512,disk_mib:1024,ports:0},{statePath,capacity:cap}),/cannot claim/);assert.equal(fs.readFileSync(statePath,'utf8'),before);
 assert.throws(()=>claimNativeUtility({task:'other',owner:'metadata',memory_mib:512,disk_mib:1024,ports:0},{statePath,capacity:{ram:16*1024**3,disk:cap.disk}}),/headroom/);assert.equal(fs.readFileSync(statePath,'utf8'),before);
 }finally{fs.rmSync(dir,{recursive:true});}
});
import {bindInstallerSupplement,proveRuntime,installerSupplementPending} from './campaign-native-20261029.mjs';
import {transact} from './batch-queue.mjs';
test('Soldat supplement is atomic, exclusive, budgeted, and exact in each phase',()=>{
 const lease={...row(),game:'soldat/egg-soldat.json',memory_mib:512};const s={claims:[lease]};
 assert.throws(()=>acquireInstallerState(s,lease.lease_id,lease.owner,0,{supplement_mib:512}),/headroom/);assert.equal(s.installer_slot,undefined);
 const slot=acquireInstallerState(s,lease.lease_id,lease.owner,0,{supplement_mib:512,capacity:cap});
 assert.equal(lease.memory_mib,512);assert.throws(()=>acquireInstallerState(s,lease.lease_id,lease.owner,0),/occupied/);
 const c={Id:'a'.repeat(64),Name:'/fixture-installer',State:{Running:true},HostConfig:{NetworkMode:'voltra-parity-20261029',Memory:512*1024**2,MemorySwap:512*1024**2,CpuPeriod:100000,CpuQuota:100000}};
 assert.throws(()=>releaseInstallerState(s,slot,0),/active/);
 bindInstallerSupplement(s,slot,c);assert.throws(()=>proveInstaller(c,lease,s),/mismatch/);
 const enlarged={...c,HostConfig:{...c.HostConfig,Memory:1024*1024**2,MemorySwap:1024*1024**2}};
 assert.equal(proveInstaller(enlarged,lease,s).memory,1024);assert.throws(()=>proveInstaller(enlarged,lease),/mismatch/);
 assert.throws(()=>proveInstaller({...enlarged,Id:'b'.repeat(64)},lease,s),/phase/);
 assert.throws(()=>proveRuntime({...enlarged,Name:'/runtime'},lease),/mismatch/);
 assert.equal(proveRuntime({...c,Name:'/runtime'},lease).memory,512);
 assert.throws(()=>releaseInstallerState(s,slot,1),/active/);releaseInstallerState(s,slot,0);assert.equal(s.installer_history[0].supplement_mib,512);
});

test('waiter identifies the owned unbound phase before resize, then uses ordinary strict proof',()=>{
 const lease={...row(),game:'soldat/egg-soldat.json',memory_mib:512},s={claims:[lease]};
 const slot=acquireInstallerState(s,lease.lease_id,lease.owner,0,{supplement_mib:512,capacity:cap});
 const c={Id:'a'.repeat(64),Name:'/fixture-installer',State:{Running:true},HostConfig:{NetworkMode:'voltra-parity-20261029',Memory:512*1024**2,MemorySwap:512*1024**2,CpuPeriod:100000,CpuQuota:100000}};
 assert.equal(installerSupplementPending(c,lease,s,slot),true);
 assert.throws(()=>installerSupplementPending(c,lease,s,{...slot,token:'stale'}),/Owned/);
 assert.throws(()=>installerSupplementPending({...c,HostConfig:{...c.HostConfig,Memory:1024*1024**2}},lease,s,slot),/mismatch/);
 bindInstallerSupplement(s,slot,c);
 assert.equal(installerSupplementPending(c,lease,s,slot),false);
 assert.throws(()=>proveInstaller(c,lease,s),/mismatch/);
 assert.equal(proveInstaller({...c,HostConfig:{...c.HostConfig,Memory:1024*1024**2,MemorySwap:1024*1024**2}},lease,s).memory,1024);
 assert.equal(installerSupplementPending(c,lease,{claims:[lease]},slot),false);
});
test('supplement cannot steal memory from concurrent admissions; failure leaves queue bytes unchanged',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'supplement-'));try{
 const statePath=path.join(dir,'queue.json');const lease={...row(),game:'soldat/egg-soldat.json',memory_mib:512};
 fs.writeFileSync(statePath,JSON.stringify({claims:[lease,{...row(1),memory_mib:19968}]}));const before=fs.readFileSync(statePath,'utf8');
 assert.throws(()=>transact(statePath,s=>acquireInstallerState(s,lease.lease_id,lease.owner,0,{supplement_mib:512,capacity:cap})),/budget/);assert.equal(fs.readFileSync(statePath,'utf8'),before);
 const s={claims:[lease,{...row(1),memory_mib:19000}]};acquireInstallerState(s,lease.lease_id,lease.owner,0,{supplement_mib:512,capacity:cap});
 assert.throws(()=>assertBudget(s,{memory_mib:512,disk_mib:1},cap),/budget/);
 assert.throws(()=>acquireInstallerState({claims:[{...lease,game:'utility/soldat',kind:'utility'}]},lease.lease_id,lease.owner,0,{supplement_mib:512,capacity:cap}),/authorized/);
 }finally{fs.rmSync(dir,{recursive:true});}
});
