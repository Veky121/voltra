import test from 'node:test';
import assert from 'node:assert/strict';
import {ancestorFolders,blocksFileNavigation,childPath,filePath,isArchive,managerDOMPath,managerEntries,newName,parentPath,plainFileClick} from '../src/client/fileManagerModel.ts';

test('single-click opening leaves modified clicks and non-primary buttons for selection',()=>{
  const click={button:0,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false};
  assert.equal(plainFileClick(click),true);
  for(const key of ['ctrlKey','metaKey','shiftKey','altKey'])assert.equal(plainFileClick({...click,[key]:true}),false);
  for(const button of [1,2])assert.equal(plainFileClick({...click,button}),false);
});
test('presentation IDs preserve exact Linux names and reject toolbar/body IDs',()=>{
  assert.equal(managerDOMPath(':/配置 +%?#.txt'),'/配置 +%?#.txt');
  assert.equal(managerDOMPath(':/literal%2Fname'),'/literal%2Fname');
  assert.equal(managerDOMPath(':/wx-filemanager-parent-link'),'/wx-filemanager-parent-link');
  for(const value of [null,':body',':toggle-tree','/unencoded'])assert.equal(managerDOMPath(value),null);
});
test('all entries survive the Wings adapter with Unicode and Linux names',()=>{
  const files=Array.from({length:1205},(_,i)=>({name:`配置 ${i}+%?#.txt`,is_file:true,size:i,modified_at:'2026-10-22T10:00:00Z'}));
  const result=managerEntries('/mods',files);
  assert.equal(result.length,1205);assert.equal(result[1204].id,'/mods/配置 1204+%?#.txt');
  assert.ok(result.every(f=>f.type==='file'&&f.date instanceof Date));
});
test('every original archive MIME and extensionless archives offer extraction',()=>{
  for(const mimetype of ['application/vnd.rar','application/x-rar-compressed','application/x-tar','application/x-br','application/x-bzip2','application/gzip','application/x-gzip','application/x-lzip','application/x-sz','application/x-xz','application/zstd','application/zip','application/x-7z-compressed'])assert.equal(isArchive({name:'no-extension',is_file:true,size:0,modified_at:'',mimetype}),true,mimetype);
  assert.equal(isArchive({name:'world.tar.zst',is_file:true,size:0,modified_at:''}),true);
  assert.equal(isArchive({name:'folder.zip',is_file:false,size:0,modified_at:''}),false);
});
test('container paths preserve Linux names and support parent moves without escaping root',()=>{
  assert.equal(filePath('/../../mods/../config/'),'/config');
  assert.equal(childPath('/mods','配置 +?#%.txt'),'/mods/配置 +?#%.txt');
  assert.equal(parentPath('/a.txt'),'/');assert.equal(parentPath('/a/b.txt'),'/a');
  assert.deepEqual(ancestorFolders('/a/b').map(f=>f.id),['/','/a','/a/b']);
  assert.equal(newName(' leading and trailing '),' leading and trailing ');
  for(const name of ['', '..','a/b','a\0b'])assert.throws(()=>newName(name));
});
test('pending transfers permit folder and file browsing but prevent losing the queue',()=>{
  const current={pathname:'/server/a/files',search:'?directory=%2F'};
  const folder={...current,search:'?directory=%2Fmods'},file={...current,search:'?directory=%2F&file=%2Fconfig.cfg'};
  const v0={...current,search:'?manager=v0'},consolePage={pathname:'/server/a/console',search:''};
  assert.equal(blocksFileNavigation(false,true,current,folder),false);
  assert.equal(blocksFileNavigation(false,true,current,file),false);
  assert.equal(blocksFileNavigation(false,true,current,v0),true);
  assert.equal(blocksFileNavigation(false,true,current,consolePage),true);
  assert.equal(blocksFileNavigation(true,true,current,folder),true);
  assert.equal(blocksFileNavigation(true,false,current,current),false);
  assert.equal(blocksFileNavigation(false,false,current,consolePage),false);
});
