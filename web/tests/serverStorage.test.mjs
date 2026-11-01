import test from 'node:test';
import assert from 'node:assert/strict';
import {backupStorage,storageTotals,storageLimit} from '../src/client/serverStorage.ts';

const backups={local_bytes:20,remote_bytes:30,other_bytes:5,total_bytes:55,pending_count:0,failed_count:0};
test('combines recorded storage without charging remote backups to the node or any backup to the file cap',()=>{
  assert.deepEqual(storageTotals(100,backups),{recorded:155,local:120,incomplete:false});
  assert.equal(storageLimit(100,200).percent,50);
});
test('unavailable readings never become zero or a misleading partial total',()=>{
  assert.equal(storageTotals(null,backups).recorded,null);
  assert.equal(storageTotals(100,null).recorded,null);
  assert.equal(storageTotals(0,{...backups,local_bytes:0,remote_bytes:0,other_bytes:0,total_bytes:0}).recorded,0);
  for(const value of [null,{}, {...backups,total_bytes:-1},{...backups,remote_bytes:NaN}])assert.equal(backupStorage(value),null);
  assert.equal(storageTotals(100,{...backups,pending_count:1}).incomplete,true);
  assert.equal(storageTotals(100,{...backups,failed_count:1}).incomplete,true);
});
test('disk zero means unlimited but backup zero means disabled; unknown is neither',()=>{
  assert.equal(storageLimit(100,0).message,'No configured limit');
  assert.equal(storageLimit(0,0,'disabled').message,'Backups disabled');
  assert.equal(storageLimit(0,undefined).level,'unknown');
  assert.equal(storageLimit(null,100).percent,undefined);
});
test('warns before the cap and preserves over-limit readings',()=>{
  assert.equal(storageLimit(79,100).level,'normal');
  assert.equal(storageLimit(80,100).message,'Approaching limit');
  assert.equal(storageLimit(90,100).message,'Almost full');
  assert.equal(storageLimit(100,100).message,'Limit reached');
  assert.equal(storageLimit(150,100).percent,150);
});
