import test from 'node:test';
import assert from 'node:assert/strict';
import {reinstallWithBackup,reinstallBackupName} from '../src/client/reinstall.ts';
function fixture(overrides={}) {
  const calls=[],controller=new AbortController();
  return {calls,controller,deps:{signal:controller.signal,stage:()=>{},wait:async()=>{},
    createBackup:async name=>{calls.push(['backup',name]);return {uuid:'b1'}},
    readBackup:async uuid=>{calls.push(['read',uuid]);return {uuid,completed_at:'now',is_successful:true}},
    reinstall:async uuid=>{calls.push(['reinstall',uuid])},...overrides}};
}
test('waits for completed successful backup before reinstall',async()=>{
  const f=fixture(); await reinstallWithBackup(true,f.deps);
  assert.deepEqual(f.calls.map(x=>x[0]),['backup','read','reinstall']);assert.equal(f.calls.at(-1)[1],'b1');
});
test('backup failures never start reinstall',async()=>{
  for(const overrides of [
    {createBackup:async()=>{throw Error('Quota reached')}},
    {readBackup:async()=>({uuid:'b1',completed_at:'now',is_successful:false})},
    {readBackup:async()=>{throw Error('Connection lost')}},
  ]) {const f=fixture(overrides);await assert.rejects(reinstallWithBackup(true,f.deps));assert.ok(!f.calls.some(x=>x[0]==='reinstall'));}
});
test('continues polling pending backups',async()=>{
  let reads=0;const f=fixture({readBackup:async()=>({uuid:'b1',completed_at:++reads===3?'now':null,is_successful:true})});
  await reinstallWithBackup(true,f.deps);assert.equal(reads,3);assert.equal(f.calls.at(-1)[0],'reinstall');
});
test('explicit opt out reinstalls without creating backup',async()=>{
  const f=fixture();await reinstallWithBackup(false,f.deps);assert.deepEqual(f.calls,[['reinstall',undefined]]);
});
test('closing while backing up cancels reinstall but keeps backup',async()=>{
  const f=fixture();f.deps.wait=async()=>f.controller.abort();await assert.rejects(reinstallWithBackup(true,f.deps),/cancelled/);assert.ok(!f.calls.some(x=>x[0]==='reinstall'));
});
test('backup names include unambiguous date and time',()=>{
  assert.equal(reinstallBackupName(new Date('2026-11-03T20:15:32Z')),'Reinstall Backup - 2026-11-03 20:15:32 UTC');
});
