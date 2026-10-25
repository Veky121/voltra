import test from 'node:test';
import assert from 'node:assert/strict';
import {ConsoleLineQueue,CONSOLE_QUEUE_DRAIN_MS,CONSOLE_QUEUE_FRAME_MS} from '../src/client/consoleQueue.ts';
import {appendConsoleHistory,emptyConsoleHistory,consoleHistoryText} from '../src/client/consoleHistory.ts';

test('spreads an incoming burst across frames and drains it within the catch-up window',()=>{
  const queue=new ConsoleLineQueue(),lines=Array.from({length:100},(_,i)=>`line ${i}`);
  queue.enqueue(lines);
  const batches=[];
  for(let now=0;now<=CONSOLE_QUEUE_DRAIN_MS;now+=CONSOLE_QUEUE_FRAME_MS)batches.push(queue.take(now));
  assert.ok(batches[0].length>0&&batches[0].length<lines.length);
  assert.ok(batches.filter(batch=>batch.length).length>5);
  assert.deepEqual(batches.flat(),lines);
  assert.equal(queue.size,0);
});

test('new arrivals join the current deadline rather than building a growing delay',()=>{
  const queue=new ConsoleLineQueue(),expected=[],actual=[];
  for(let now=0;now<CONSOLE_QUEUE_DRAIN_MS;now+=CONSOLE_QUEUE_FRAME_MS){
    const lines=Array.from({length:50},(_,i)=>`${now}:${i}`);
    expected.push(...lines);queue.enqueue(lines);actual.push(...queue.take(now));
  }
  actual.push(...queue.take(CONSOLE_QUEUE_DRAIN_MS));
  assert.equal(queue.size,0);assert.deepEqual(actual,expected);
});

test('large bursts catch up without losing, reordering or deduplicating output',()=>{
  const queue=new ConsoleLineQueue(),lines=Array.from({length:10000},(_,i)=>i%2?'same line':`line ${i}`),actual=[];
  queue.enqueue(lines);
  for(let now=0;now<=CONSOLE_QUEUE_DRAIN_MS;now+=CONSOLE_QUEUE_FRAME_MS)actual.push(...queue.take(now));
  assert.deepEqual(actual,lines);assert.equal(queue.size,0);
});

test('clear discards queued output and resets the next burst deadline',()=>{
  const queue=new ConsoleLineQueue();queue.enqueue(['old line','old line']);queue.take(0);queue.clear();
  assert.deepEqual(queue.take(1000),[]);
  queue.enqueue(Array.from({length:40},(_,i)=>`new ${i}`));
  assert.equal(queue.take(1000).length,2);
});

test('hidden tabs and reduced-motion mode can flush immediately',()=>{
  const queue=new ConsoleLineQueue();queue.enqueue(['one','','three']);
  assert.deepEqual(queue.take(0,true),['one','','three']);assert.equal(queue.size,0);
});

test('ANSI styles carry between paced batches exactly as for a single append',()=>{
  const queue=new ConsoleLineQueue(),lines=['\x1b[31mred','still red','\x1b[0mnormal'];
  queue.enqueue(lines);let paced=emptyConsoleHistory();
  for(let now=0;now<=CONSOLE_QUEUE_DRAIN_MS;now+=CONSOLE_QUEUE_FRAME_MS)paced=appendConsoleHistory(paced,queue.take(now));
  const direct=appendConsoleHistory(emptyConsoleHistory(),lines);
  assert.equal(consoleHistoryText(paced),consoleHistoryText(direct));
  assert.deepEqual(paced,direct);
});
