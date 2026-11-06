import test from 'node:test';
import assert from 'node:assert/strict';
import {pickUploadFolder} from '../src/client/folderPicker.ts';
const file=name=>({kind:'file',name,getFile:async()=>new File(['content'],name)});
const directory=(name,entries)=>({kind:'directory',name,async *values(){yield* entries}});
test('directory picker requests read access and preserves root and nested paths',async()=>{
 const files=await pickUploadFolder({showDirectoryPicker:async options=>{
  assert.deepEqual(options,{mode:'read'});
  return directory('test',[file('a.txt'),directory('nested',[file('a.txt')])]);
 }});
 assert.deepEqual(files.map(f=>f.relativePath),['test/a.txt','test/nested/a.txt']);
 assert.equal(await files[1].text(),'content');
});
test('unavailable picker falls back, cancellation adds nothing, read failures propagate',async()=>{
 assert.equal(await pickUploadFolder({}),null);
 assert.deepEqual(await pickUploadFolder({showDirectoryPicker:async()=>{throw new DOMException('Cancelled','AbortError')}}),[]);
 await assert.rejects(pickUploadFolder({showDirectoryPicker:async()=>directory('test',[{kind:'file',name:'bad',getFile:async()=>{throw new Error('Unreadable')}}])}),/Unreadable/);
});
