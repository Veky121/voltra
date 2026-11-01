import test from 'node:test';
import assert from 'node:assert/strict';
import {consoleViewport,consoleViewportChunks} from '../src/client/consoleViewport.ts';
import {appendConsoleHistory,emptyConsoleHistory,consoleHistoryText} from '../src/client/consoleHistory.ts';

test('renders a bounded window at the start, middle and end',()=>{
  for(const top of [0,50000,99600]){
    const range=consoleViewport(5000,top,400,20);
    assert.ok(range.start>=0&&range.end<=5000);
    assert.ok(range.end-range.start<=100);
  }
  assert.deepEqual(consoleViewport(0,10000,400,20),{start:0,end:0});
});
test('windows preserve line order and ANSI formatting across chunk boundaries',()=>{
  const history=appendConsoleHistory(emptyConsoleHistory(),Array.from({length:1100},(_,i)=>`\x1b[31mline ${i}`));
  const lines=consoleViewportChunks(history,{start:490,end:1010}).flatMap(c=>c.lines);
  assert.equal(lines.length,520);
  assert.equal(lines[0],history.chunks[0].lines[490]);
  assert.equal(lines.at(-1).id,1009);
  assert.equal(lines[15].formatted.segments[0].style.color,'#ff808e');
  assert.ok(consoleHistoryText(history).includes('line 0'));
  assert.equal(history.count,1100);
});
test('keeps selected rows mounted when scrolling away from their anchor',()=>{
  const selected={start:100,end:140};
  const down=consoleViewport(5000,20000,400,20,selected);
  assert.equal(down.start,100);
  assert.ok(down.end>1000);
  const up=consoleViewport(5000,0,400,20,selected);
  assert.equal(up.start,0);assert.equal(up.end,140);
});
