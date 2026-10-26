import test from 'node:test';
import assert from 'node:assert/strict';
import {beginPowerOperation,advancePowerOperation,powerOperationLabel} from '../src/client/powerOperation.ts';
const accepted=signal=>({...beginPowerOperation(signal,100,60000,100),accepted:true});

test('request acceptance and stale running samples do not complete restart',()=>{
 const sending=beginPowerOperation('restart',100,60000,100);
 assert.equal(advancePowerOperation(sending,'running',10,200).operation,sending);
 const restart=accepted('restart');
 assert.equal(advancePowerOperation(restart,'running',10,100).operation,restart);
 assert.equal(advancePowerOperation(restart,'running',62000,200).outcome,undefined);
});
test('restart waits for exit and then running; stopping alone is insufficient',()=>{
 let operation=advancePowerOperation(accepted('restart'),'stopping',61000,200).operation;
 assert.equal(powerOperationLabel(operation),'Waiting for exit…');
 const staleRunning=advancePowerOperation(operation,'running',63000,300);
 assert.equal(staleRunning.outcome,undefined);
 operation=advancePowerOperation(operation,'offline',0,400).operation;
 assert.equal(powerOperationLabel(operation),'Starting…');
 operation=advancePowerOperation(operation,'starting',200,500).operation;
 assert.equal(advancePowerOperation(operation,'running',1000,600).message,'Server restarted.');
});
test('restart can prove a quick missed exit from process uptime reset',()=>{
 assert.equal(advancePowerOperation(accepted('restart'),'running',1000,200).outcome,'success');
 assert.equal(advancePowerOperation(accepted('restart'),'running',0,200).outcome,undefined);
});
test('stop and force stop finish when offline, without waiting for startup',()=>{
 for(const signal of ['stop','kill']){
  const operation=advancePowerOperation(accepted(signal),'stopping',61000,200).operation;
  assert(operation);
  const result=advancePowerOperation(operation,'offline',0,300);
  assert.equal(result.operation,null);assert.equal(result.outcome,'success');
 }
});
test('start stays pending until running, and detects an observed startup failure',()=>{
 let operation=advancePowerOperation(accepted('start'),'offline',0,200).operation;
 assert(operation);assert.equal(powerOperationLabel(operation),'Starting…');
 operation=advancePowerOperation(operation,'starting',100,300).operation;
 assert.equal(advancePowerOperation(operation,'running',1000,400).message,'Server started.');
 assert.equal(advancePowerOperation(operation,'offline',0,400).outcome,'error');
});
test('restart startup failure reports failure instead of success',()=>{
 const operation=advancePowerOperation(accepted('restart'),'starting',100,200).operation;
 assert.equal(advancePowerOperation(operation,'offline',0,300).outcome,'error');
});
