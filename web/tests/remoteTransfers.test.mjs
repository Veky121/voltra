import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeTransfers,reconcileTransfers,transferActive,transferRecentlyActive,transferPollDelay,transferProgress} from '../src/client/remoteTransferModel.ts';

const transfer={identifier:'one',name:'world.zip',directory:'/',state:'downloading',updated:100};

test('unknown and legacy size reports do not manufacture a percentage',()=>{
  assert.equal(transferProgress({...transfer,progress:0.7}),null);
  assert.equal(transferProgress({...transfer,size_known:false,total_bytes:100,received_bytes:70}),null);
  assert.equal(transferProgress({...transfer,size_known:true,total_bytes:0,received_bytes:0}),null);
  assert.equal(transferProgress({...transfer,size_known:true,total_bytes:100,received_bytes:NaN}),null);
});

test('known transfer byte counts produce bounded progress, awaiting save does not imply completion',()=>{
  assert.equal(transferProgress({...transfer,size_known:true,total_bytes:200,received_bytes:50}),25);
  assert.equal(transferProgress({...transfer,size_known:true,total_bytes:200,received_bytes:201}),100);
  assert.equal(transferProgress({...transfer,state:'awaiting_save',size_known:true,total_bytes:200,received_bytes:200}),null);
  assert.equal(transferActive({...transfer,state:'awaiting_save'}),true);
  assert.equal(transferActive({...transfer,state:'failed'}),false);
  assert.equal(transferProgress({...transfer,state:'complete'}),100);
});

test('late socket or polling events never regress completed work',()=>{
  const complete={...transfer,state:'complete',updated:200};
  assert.deepEqual(mergeTransfers({one:complete},[{...transfer,updated:250}]),{one:complete});
  assert.deepEqual(mergeTransfers({one:transfer},[{...transfer,updated:50,received_bytes:0}]),{one:transfer});
});

test('shared records combine upload and download producers without overwriting each other',()=>{
  const upload={...transfer,identifier:'upload-two',kind:'upload',state:'uploading'};
  const records=mergeTransfers({one:transfer},[upload]);
  assert.deepEqual(Object.keys(records),['one','upload-two']);
  assert.equal(records['upload-two'].kind,'upload');
  assert.deepEqual(mergeTransfers(records,[{...transfer,identifier:'',updated:900}]),records);
});

test('optimistic queued record does not override server time when client clock is ahead',()=>{
  const queued={...transfer,state:'queued',updated:0};
  assert.equal(mergeTransfers({one:queued},[transfer]).one.state,'downloading');
});

test('authoritative snapshots remove canceled uploads and expired outcomes without inventing completion',()=>{
  const upload={...transfer,identifier:'upload-two',kind:'upload',state:'uploading'};
  const started={one:transfer,'upload-two':upload};
  assert.deepEqual(reconcileTransfers(started,[],'upload',started),{one:transfer});
  const completed={...transfer,state:'complete'};
  assert.deepEqual(reconcileTransfers({one:completed},[],'download',{one:completed}),{});
});

test('an older snapshot cannot remove jobs started or updated while its request was in flight',()=>{
  const started={one:transfer};
  const update={...transfer,received_bytes:12,updated:101};
  const queued={...transfer,identifier:'new',state:'queued',updated:0};
  const current={one:update,new:queued};
  assert.deepEqual(reconcileTransfers(current,[],'download',started),current);
});


test('paused uploads remain resumable without active animation or frequent idle polling',()=>{
  const now=100000,upload={...transfer,kind:'upload',state:'uploading',updated:now-31000};
  assert.equal(transferActive(upload),true);
  assert.equal(transferRecentlyActive(upload,now),false);
  assert.equal(transferPollDelay([upload],true,now),30000);
  assert.equal(transferPollDelay([{...upload,updated:now}],true,now),5000);
  assert.equal(transferPollDelay([],false,now),30000);
  assert.equal(transferPollDelay([transfer],true,now),30000);
  assert.equal(transferPollDelay([transfer],false,now),5000);
  assert.equal(mergeTransfers({[upload.identifier]:upload},[{...upload,updated:now,received_bytes:20}])[upload.identifier].received_bytes,20);
});
