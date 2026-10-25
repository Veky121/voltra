import test from 'node:test';
import assert from 'node:assert/strict';
import {appendConsoleHistory,emptyConsoleHistory,consoleHistoryText,CONSOLE_HISTORY_LINES,CONSOLE_HISTORY_CHARACTERS} from '../src/client/consoleHistory.ts';

test('retains one hundred thousand lines and evicts only the oldest excess',()=>{
  const h=appendConsoleHistory(emptyConsoleHistory(),Array.from({length:CONSOLE_HISTORY_LINES+10},(_,i)=>`line ${i}`));
  assert.equal(h.count,100000);
  assert.equal(h.chunks[0].lines[0].text,'line 10');
  assert.equal(h.chunks.at(-1).lines.at(-1).text,'line 100009');
});
test('existing history snapshots and completed chunks stay immutable while output arrives',()=>{
  const h=appendConsoleHistory(emptyConsoleHistory(),Array.from({length:501},(_,i)=>`old ${i}`));
  const next=appendConsoleHistory(h,['new output']);
  assert.equal(h.count,501);assert.equal(next.count,502);
  assert.equal(next.chunks[0],h.chunks[0]);
  assert.equal(consoleHistoryText(h).includes('new output'),false);
  assert.equal(next.chunks[1].lines[0],h.chunks[1].lines[0]);
});
test('text budget bounds long lines without shortening retained lines',()=>{
  const long='x'.repeat(CONSOLE_HISTORY_CHARACTERS/3);
  const h=appendConsoleHistory(emptyConsoleHistory(),[long,long,long,'last']);
  assert.ok(h.characters<=CONSOLE_HISTORY_CHARACTERS);
  assert.equal(h.count,3);
  assert.equal(h.chunks[0].lines[0].text,long);
  assert.equal(h.chunks.at(-1).lines.at(-1).text,'last');
});
test('ANSI style carries across batches and survives eviction without reparsing history',()=>{
  const h=appendConsoleHistory(emptyConsoleHistory(),['\x1b[31mred']);
  const next=appendConsoleHistory(h,['also red\x1b[0m normal']);
  const segments=next.chunks[0].lines[1].formatted.segments;
  assert.equal(segments[0].style.color,'#ff808e');
  assert.deepEqual(segments[1].style,{});
  assert.equal(h.endStyle.color,'#ff808e');
});
test('clear resets both history and color state; empty append is stable',()=>{
  const h=emptyConsoleHistory();assert.equal(appendConsoleHistory(h,[]),h);
  const next=appendConsoleHistory(h,['plain']);
  assert.equal(consoleHistoryText(next),'plain');
  assert.deepEqual(next.chunks[0].lines[0].formatted.segments[0].style,{});
});
