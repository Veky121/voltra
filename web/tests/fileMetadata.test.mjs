import test from 'node:test';
import assert from 'node:assert/strict';
import {fileEntrySize,fileEntryType,fileModifiedDate,reportedStorage} from '../src/client/fileMetadata.ts';

const file={name:'server.properties',is_file:true,size:1234,modified_at:'2026-10-26T02:00:00Z'};
test('file metadata distinguishes file extensions, dotfiles, folders and links',()=>{
  assert.equal(fileEntryType(file),'PROPERTIES file');
  assert.equal(fileEntryType({...file,name:'README'}),'File');
  assert.equal(fileEntryType({...file,name:'.env'}),'File');
  assert.equal(fileEntryType({...file,name:'world.tar.gz'}),'GZ file');
  assert.equal(fileEntryType({...file,is_file:false}),'Folder');
  assert.equal(fileEntryType({...file,is_symlink:true}),'Symbolic link');
});
test('listing sizes never present directory or link metadata as content storage',()=>{
  assert.equal(fileEntrySize(file),1234);
  assert.equal(fileEntrySize({...file,size:0}),0);
  assert.equal(fileEntrySize({...file,is_file:false,size:4096}),null);
  assert.equal(fileEntrySize({...file,is_symlink:true}),null);
  for(const size of [undefined,null,'1234',NaN,Infinity,-1])assert.equal(fileEntrySize({...file,size}),null);
});
test('missing and invalid modification times stay unavailable',()=>{
  assert.equal(fileModifiedDate(file.modified_at)?.toISOString(),'2026-10-26T02:00:00.000Z');
  for(const value of ['',undefined,null,'not a date'])assert.equal(fileModifiedDate(value),null);
});
test('storage distinguishes an actual zero reading from absent or stale telemetry',()=>{
  assert.equal(reportedStorage({disk_bytes:0},1,''),0);
  assert.equal(reportedStorage({disk_bytes:1024},1,''),1024);
  assert.equal(reportedStorage({disk_bytes:1024},1,'Connection failed'),null);
  assert.equal(reportedStorage({disk_bytes:1024},0,''),null);
  for(const disk_bytes of [undefined,null,'0',NaN,Infinity,-1])assert.equal(reportedStorage({disk_bytes},1,''),null);
});
