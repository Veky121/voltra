import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadTarget,transferIdentity} from '../src/client/fileTransferPaths.ts';

test('folder uploads preserve every parent under captured target directory',()=>{
  assert.equal(uploadTarget('/world/','mods/nested/example.jar','example.jar'),'/world/mods/nested');
  assert.equal(uploadTarget('/','one.txt','one.txt'),'/');
  assert.equal(uploadTarget('/configs','', 'my settings.json'),'/configs');
});
test('rejects traversal, malformed folder selections, slash and null characters',()=>{
  for(const relative of ['../secret.txt','mods/../../secret.txt','mods\\secret.txt','mods/./secret.txt','mods/secret\u0000.txt'])assert.throws(()=>uploadTarget('/world',relative,'secret.txt'));
  assert.throws(()=>uploadTarget('/world/../','ok.txt','ok.txt'));
  assert.throws(()=>uploadTarget('/','a/other.txt','file.txt'));
  for(const name of ['..','.','folder/a','a\u0000'])assert.throws(()=>uploadTarget('/','',name));
  assert.equal(uploadTarget('/linux\\folder','', 'name\\with\nnewline.txt'),'/linux\\folder');
});
test('resume identity cannot cross server or upload directory',()=>{
  const identity=transferIdentity('/api/client/servers/a','/mods','same-file');
  assert.notEqual(identity,transferIdentity('/api/client/servers/b','/mods','same-file'));
  assert.notEqual(identity,transferIdentity('/api/client/servers/a','/world','same-file'));
  assert.equal(identity,transferIdentity('/api/client/servers/a','/mods','same-file'));
  assert.notEqual(transferIdentity('a:b','c','d'),transferIdentity('a','b:c','d'));
});
