import test from 'node:test';
import assert from 'node:assert/strict';
import {saveSettingChanges} from '../src/client/saveSettingChanges.ts';
import {settingDescription} from '../src/client/settingDescription.ts';
test('one save waits for native and startup writes in order', async()=>{
 const calls=[];
 await saveSettingChanges([{save:async()=>{await Promise.resolve();calls.push('native');}},{save:async()=>{calls.push('startup');}}]);
 assert.deepEqual(calls,['native','startup']);
});
test('a failed write stops the batch and leaves later drafts untouched',async()=>{
 const drafts={first:true,failed:true,last:true};
 await assert.rejects(saveSettingChanges([{save:async()=>{delete drafts.first;}},{save:async()=>{throw Error('failed');}},{save:async()=>{delete drafts.last;}}]));
 assert.deepEqual(drafts,{failed:true,last:true});
});
test('description uses one short sentence',()=>{
 assert.equal(settingDescription('Username for the web portal. Used by the internal HTTP service.'),'Username for the web portal.');
 assert.ok(settingDescription('Long '.repeat(80)).length<=160);
});
