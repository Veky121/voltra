import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBatchReceipt} from './cache-owned-server.mjs';
const uuid='93f5f00c-8d68-4f4d-a752-22b2f44a9801';
const node={node:249,node_uuid:uuid,container:'voltra-batch-20261023',root:'/var/lib/voltra-batch-20261023',volume_root:'/var/lib/voltra-batch-20261023/volumes',cache_root:'/var/lib/voltra-batch-20261023/cache'};
const receipt={uuid,internal_id:433,node:249,node_uuid:uuid};
test('reviewed registration can change numeric ID with exact owner/UUID/root',()=>assert.doesNotThrow(()=>validateBatchReceipt(receipt,node)));
test('old or foreign node IDs cannot seed a current volume',()=>assert.throws(()=>validateBatchReceipt({...receipt,node:202},node)));
test('changed registration UUID and foreign daemon label are rejected',()=>{
 assert.throws(()=>validateBatchReceipt({...receipt,node_uuid:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},node));
 assert.throws(()=>validateBatchReceipt(receipt,{...node,container:'foreign-daemon'}));
});
test('foreign root, cache and volume path are rejected',()=>{
 for(const key of ['root','cache_root','volume_root'])assert.throws(()=>validateBatchReceipt(receipt,{...node,[key]:'/foreign'}));
});
