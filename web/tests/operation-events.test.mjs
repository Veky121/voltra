import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOperationReporter} from '../../internal/panel/game_library/scripts/operation-report.mjs';
import {download} from '../../internal/panel/game_library/fs25/lib/download-game.mjs';
import {parseOperationEvent,mergeOperationEvent,operationPrefix} from '../src/client/operationEvents.ts';

test('reporter bounds rate, strips arbitrary payloads and ends after terminal event',()=>{
  let at=0;const lines=[];const report=createOperationReporter({source:'fixture',id:'test',write:line=>lines.push(line),now:()=>at});
  report({state:'running',phase:'download',code:'DOWNLOAD_RECEIVING',bytes:1,total:null,password:'secret',url:'https://secret.test'});
  report({state:'running',phase:'download',code:'DOWNLOAD_RECEIVING',bytes:2});
  at=1000;report({state:'running',phase:'download',code:'DOWNLOAD_RECEIVING',bytes:3});
  report({state:'failed',phase:'download',code:'DOWNLOAD_FAILED'});
  report({state:'completed',phase:'download',code:'DOWNLOAD_COMPLETE'});
  assert.equal(lines.length,3);assert.ok(!lines.join('').includes('secret'));
  assert.equal(parseOperationEvent(lines[0]).total,null);
  assert.equal(parseOperationEvent(lines[2]).state,'failed');
});
test('parser rejects unknown codes, oversized events, invalid sizes and extra secret fields',()=>{
  const base={v:1,id:'test',sequence:1,at:new Date().toISOString(),source:'fixture',state:'running',phase:'download',code:'DOWNLOAD_RECEIVING'};
  const parse=patch=>parseOperationEvent(operationPrefix+JSON.stringify({...base,...patch}));
  assert.equal(parse({code:'RAW_SECRET'}),null);assert.equal(parse({bytes:-1}),null);assert.equal(parse({bytes:3,total:2}),null);
  assert.equal(parse({id:undefined}),null);assert.equal(parse({source:undefined}),null);
  assert.equal(parseOperationEvent('chat '+operationPrefix+JSON.stringify(base)),null);
  assert.equal(parseOperationEvent(operationPrefix+' '.repeat(2049)),null);
  assert.equal(parse({password:'secret'}).password,undefined);
});
test('replay cannot regress a terminal operation and retained history is bounded',()=>{
  const event={v:1,id:'test',sequence:2,at:new Date().toISOString(),source:'fixture',state:'completed',phase:'download',code:'DOWNLOAD_COMPLETE'};
  let events=[event];assert.equal(mergeOperationEvent(events,{...event,sequence:1,state:'running'}),events);
  assert.equal(mergeOperationEvent(events,{...event,sequence:3,state:'running'}),events);
  for(let i=0;i<30;i++)events=mergeOperationEvent(events,{...event,id:`test${i}`});
  assert.equal(events.length,12);
});
test('real FS25 download reports actual known or unknown byte totals and preserves file data',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'voltra-operation-'));const originalFetch=globalThis.fetch,originalLog=console.log;
  try {
    for(const known of [true,false]){
      const output=[];console.log=line=>output.push(line);globalThis.fetch=async()=>new Response('fixture',{headers:{'content-type':'application/octet-stream',...(known?{'content-length':'7'}:{})}});
      const name=`FarmingSimulator25_${known?'known':'unknown'}.img`;
      await download(`https://cdn1.giants-software.com/${name}`,dir,100);
      assert.equal(await readFile(join(dir,name),'utf8'),'fixture');
      const events=output.map(parseOperationEvent).filter(Boolean),last=events.at(-1);
      assert.equal(last.state,'completed');assert.equal(last.bytes,7);assert.equal(last.total,known?7:null);
    }
  }finally{globalThis.fetch=originalFetch;console.log=originalLog;await rm(dir,{recursive:true,force:true});}
});
test('incomplete download emits failure and removes partial data',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'voltra-operation-'));const originalFetch=globalThis.fetch,originalLog=console.log,output=[];
  try {
    console.log=line=>output.push(line);globalThis.fetch=async()=>new Response('short',{headers:{'content-length':'10','content-type':'application/octet-stream'}});
    await assert.rejects(download('https://cdn1.giants-software.com/FarmingSimulator25_incomplete.img',dir,100),/Incomplete/);
    assert.equal(output.map(parseOperationEvent).filter(Boolean).at(-1).state,'failed');
    await assert.rejects(readFile(join(dir,'FarmingSimulator25_incomplete.img.partial')),/ENOENT/);
  }finally{globalThis.fetch=originalFetch;console.log=originalLog;await rm(dir,{recursive:true,force:true});}
});
