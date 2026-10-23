import test from 'node:test';
import assert from 'node:assert/strict';
import {readBounded,previewKind,mixedNewlines,responseSize} from '../src/client/fileDocumentSupport.ts';

test('bounded reader cancels a node that ignores the range limit',async()=>{
  let cancelled=false;
  const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));c.enqueue(new Uint8Array([3,4,5]));},cancel(){cancelled=true;}}));
  const result=await readBounded(response,4);
  assert.deepEqual([...new Uint8Array(result.buffer)],[1,2,3,4]);
  assert.equal(result.truncated,true);assert.equal(cancelled,true);
});
test('bounded reader accepts an exact sized file and empty files',async()=>{
  const result=await readBounded(new Response('test'),4);
  assert.equal(new TextDecoder().decode(result.buffer),'test');assert.equal(result.truncated,false);
  assert.equal((await readBounded(new Response(null),4)).buffer.byteLength,0);
});
test('active document formats never use inline media preview',()=>{
  for(const file of ['index.html','payload.svg','page.xhtml','data.xml','unknown'])assert.equal(previewKind(file),'text');
  assert.equal(previewKind('PHOTO.PNG'),'image');assert.equal(previewKind('doc.pdf'),'pdf');
});
test('mixed newlines are detected without mistaking CRLF for two types',()=>{
  assert.equal(mixedNewlines('a\r\nb\r\n'),false);
  assert.equal(mixedNewlines('a\r\nb\n'),true);
  assert.equal(mixedNewlines('a\rb\n'),true);
});
test('range size uses full representation rather than chunk length',()=>{
  assert.equal(responseSize(new Response('hello',{status:206,headers:{'Content-Range':'bytes 0-4/900','Content-Length':'5'}})),900);
  assert.equal(responseSize(new Response(null)),null);
});
