import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,appendFileSync,rmSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLogFollower,formatLogSourceLine} from '../../internal/panel/game_library/fs25/lib/console-logs.mjs';

test('each source label has a distinct ANSI color which resets before the message',()=>{
 const starts=new Set();
 for(const source of ['Game','Server','WebPanel','Wine']) {
  const line=formatLogSourceLine(`[${source}] message`);
  starts.add(line.match(/^\x1b\[\d+m/)[0]);
  assert.match(line,/\x1b\[0m message$/);
  assert.equal(line.replace(/\x1b\[\d+m/g,''),`[${source}] message`);
  assert.equal(formatLogSourceLine(`[${source}] message`,false),`[${source}] message`);
 }
 assert.equal(starts.size,4);
});

test('only the exact server ready event emits a single timed Voltra confirmation',()=>{
 const f=fixture({environment:{FS25_START_TIME_MS:'1000'},now:()=>19400});try {
  writeFileSync(f.server,'[26/Oct/2026:05:24:16] Game server process started\n');f.poll();
  assert.equal(f.output.some(line=>line.startsWith('[Voltra]')),false);
  appendFileSync(f.server,'[26/Oct/2026:05:24:16] Game server started\n');f.poll();
  assert.equal(f.output.at(-1),'[Voltra]: Server marked as started in 18.4s.');
  appendFileSync(f.server,'[26/Oct/2026:05:24:16] Game server started\n');f.poll();
  assert.equal(f.output.filter(line=>line.startsWith('[Voltra]')).length,1);
 } finally {f.cleanup();}
});

test('recent history never emits a fresh startup confirmation',()=>{
 const f=fixture({fromEnd:true,historyBytes:65536});try {
  writeFileSync(f.server,'[26/Oct/2026:05:24:16] Game server started\n');f.poll();
  assert.equal(f.output.some(line=>line.startsWith('[Voltra]')),false);
 } finally {f.cleanup();}
});

function fixture(options={}) {
 const root=mkdtempSync(join(tmpdir(),'fs25-logs-')),docsDir=join(root,'data'),dediDir=join(docsDir,'dedicated_server');mkdirSync(join(dediDir,'logs'),{recursive:true});
 const output=[],follower=createLogFollower({docsDir,dediDir,write:line=>output.push(line),...options});
 return {root,output,poll:follower.poll,game:join(docsDir,'log_2026-10-26_05-00-00.txt'),server:join(dediDir,'logs/server_2026-10-26_05-00-00.log'),web:join(dediDir,'logs/webserver_2026-10-26_05-00-00.log'),wine:join(dediDir,'dedicatedServer.log'),cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('all four real FS25 log layouts are labelled, late creation and appends are followed without replay',()=>{
 const f=fixture();try {
  f.poll();
  for(const [file,text] of [[f.game,'game'],[f.server,'server'],[f.web,'web'],[f.wine,'wine']]) writeFileSync(file,text+'\r\n');
  f.poll();f.poll();
  assert.deepEqual(f.output,['[Game] game','[Server] server','[WebPanel] web','[Wine] wine']);
  appendFileSync(f.game,'joined\n');f.poll();assert.equal(f.output.at(-1),'[Game] joined');
 } finally {f.cleanup();}
});

test('hot attachment skips existing history but reads new sessions and same-name replacements',()=>{
 const f=fixture({fromEnd:true});try {
  writeFileSync(f.game,'old\n');f.poll();assert.deepEqual(f.output,[]);
  appendFileSync(f.game,'new\n');f.poll();assert.equal(f.output.at(-1),'[Game] new');
  const next=f.game.replace('05-00-00','06-00-00');writeFileSync(next,'next session\n');f.poll();assert.equal(f.output.at(-1),'[Game] next session');
  renameSync(next,next+'.old');writeFileSync(next,'replacement\n');f.poll();assert.equal(f.output.at(-1),'[Game] replacement');
  writeFileSync(next,'cut\n');f.poll();assert.equal(f.output.at(-1),'[Game] cut');
 } finally {f.cleanup();}
});

test('split UTF-8 and incomplete lines are retained until complete',()=>{
 const f=fixture();try {
  const bytes=Buffer.from('héllo\n');writeFileSync(f.game,bytes.subarray(0,2));f.poll();assert.deepEqual(f.output,[]);
  appendFileSync(f.game,bytes.subarray(2));f.poll();assert.deepEqual(f.output,['[Game] héllo']);
 } finally {f.cleanup();}
});

test('hot attachment drops the rest of a line already in progress',()=>{
 const f=fixture({fromEnd:true});try {
  writeFileSync(f.game,'existing partial');f.poll();
  appendFileSync(f.game,' secret suffix\nnext\n');f.poll();
  assert.deepEqual(f.output,['[Game] next']);
 } finally {f.cleanup();}
});

test('a bounded recent context drops the first partial line',()=>{
 const f=fixture({fromEnd:true,historyBytes:9});try {
  writeFileSync(f.game,'old entry\nrecent\n');f.poll();
  assert.deepEqual(f.output,['[Game] recent']);
 } finally {f.cleanup();}
});

test('credentials split across reads and encoded forms are masked before emission',()=>{
 const f=fixture({environment:{GAME_SERIAL:'ABCDE-FGHIJ-KLMNO-PQRST',WEB_PASSWORD:'a&private password'}});try {
  writeFileSync(f.game,'key ABCDE-FG');f.poll();assert.deepEqual(f.output,[]);
  appendFileSync(f.game,'HIJ-KLMNO-PQRST ABCDEFGHIJKLMNOPQRST a%26private%20password a&amp;private password\npassword=another-secret\n');f.poll();
  assert.doesNotMatch(f.output.join('\n'),/ABCDE|private|another-secret/);
  assert.match(f.output.join('\n'),/\[redacted\]/);
 } finally {f.cleanup();}
});

test('oversized lines are discarded with bounded output, subsequent complete lines survive',()=>{
 const f=fixture();try {
  writeFileSync(f.game,'x'.repeat(300000)+'\nnormal\n');f.poll();f.poll();
  assert.deepEqual(f.output,['[Game] [Oversized log line omitted]','[Game] normal']);
 } finally {f.cleanup();}
});
