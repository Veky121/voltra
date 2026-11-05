import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySoldatInstallerObservation,observeInstallerExit} from './soldat-installer-observer.mjs';

test('observation timeout retains pending state and accepts the same installer later',async()=>{
  let finish;
  const installer=new Promise(resolve=>{finish=resolve;});
  assert.deepEqual(await observeInstallerExit(installer,5),{observed:false,pending:true,reason:'exit_not_observed'});
  finish(0);
  assert.deepEqual(await observeInstallerExit(installer,100),{observed:true,exit:0});
});
test('nonzero native exit is retained; observer failure never implies installer failure or success',async()=>{
  assert.deepEqual(await observeInstallerExit(Promise.resolve(1)),{observed:true,exit:1});
  assert.deepEqual(await observeInstallerExit(Promise.reject(Error('connection lost'))),{observed:false,pending:true,reason:'wait_observer_failed'});
  assert.deepEqual(await observeInstallerExit(Promise.resolve(NaN)),{observed:false,pending:true,reason:'invalid_exit_observation'});
});

function fixture(supplement=false){
  const uuid='11111111-1111-4111-8111-111111111111';
  const lease={lease_id:'lease',owner:'soldat_native',game:'soldat/egg-soldat.json',status:'active',memory_mib:512,disk_mib:4096};
  const slot={lease_id:lease.lease_id,owner:lease.owner,token:'owned',...(supplement?{supplement_mib:512,container_id:'fixture'}:{})};
  const memory=supplement?1024:512;
  return {uuid,lease,slot,queue:{claims:[lease],installer_slot:{...slot}},kernel:[String(memory*1024**2),'0','100000 100000'],container:{Id:'fixture',Name:`/${uuid}-installer`,State:{Running:true},HostConfig:{NetworkMode:'voltra-parity-20261029',Memory:memory*1024**2,MemorySwap:memory*1024**2,CpuPeriod:100000,CpuQuota:100000}}};
}
test('observer accepts exactly accounted Docker and kernel limits in both phases',()=>{
  for(const supplement of [false,true]){const f=fixture(supplement),p=verifySoldatInstallerObservation(f);assert.equal(p.runtime_memory_mib,512);assert.equal(p.accounted_installer_memory_mib,supplement?1024:512);}
});
test('observer rejects stale ownership and unaccounted or incorrect kernel memory',()=>{
  let f=fixture(true);f.slot={...f.slot,token:'stale'};assert.throws(()=>verifySoldatInstallerObservation(f),/owned/);
  f=fixture(true);delete f.slot.token;delete f.queue.installer_slot.token;assert.throws(()=>verifySoldatInstallerObservation(f),/owned/);
  f=fixture(true);f.kernel[0]=String(512*1024**2);assert.throws(()=>verifySoldatInstallerObservation(f),/kernel/);
  f=fixture(true);delete f.queue.installer_slot.supplement_mib;assert.throws(()=>verifySoldatInstallerObservation(f),/mismatch/);
  f=fixture(true);f.queue.claims[0]={...f.lease,status:'blocked'};assert.throws(()=>verifySoldatInstallerObservation(f),/owned/);
});
test('observer rejects wrong fixture, unlimited swap and unrelated supplement containers',()=>{
  let f=fixture(true);f.container.Name='/other-installer';assert.throws(()=>verifySoldatInstallerObservation(f),/owned/);
  f=fixture(true);f.kernel[1]='max';assert.throws(()=>verifySoldatInstallerObservation(f),/kernel/);
  f=fixture(true);f.queue.installer_slot.container_id='other';assert.throws(()=>verifySoldatInstallerObservation(f),/phase/);
});
