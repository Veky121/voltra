import test from 'node:test';
import assert from 'node:assert/strict';
import {detectConsoleLevel,formatConsoleLines,formatConsoleBatch} from '../src/client/consoleFormatting.ts';
import {consoleOutput,stripConsoleControls} from '../src/client/consoleOutput.ts';

test('detects Minecraft, Source, Unreal and structured log levels from prefixes',()=>{
  for(const [line,level] of [
    ['[12:34:56] [Server thread/ERROR]: Could not load plugin','error'],
    ['[12:34:56 WARN]: Can’t keep up!','warning'],
    ['2026-10-22T08:12:30Z ERROR Unable to bind port','error'],
    ['LogNet: Warning: Connection lost','warning'],
    ['[DEBUG] Loading config','debug'],
    ['{"level":"error","message":"failed"}','error'],
    ['[12:34:56 INFO]: Done (1.2s)! For help, type "help"','success'],
    ['[Voltra] Checking disk usage','daemon'],
    ['[INFO] Player said ERROR in chat','info'],
    ['received:WARNING stop','normal'],
    ['[12:34:56] [Server thread/INFO]: <Player> Server ready','info'],
  ])assert.equal(detectConsoleLevel(line),level,line);
});

test('preserves ANSI colors, resets, and styles across lines',()=>{
  const [first,second]=formatConsoleLines(['\x1b[31;1mError','still red\x1b[0m normal']);
  assert.equal(first.segments[0].style.color,'#ff808e');
  assert.equal(first.segments[0].style.fontWeight,700);
  assert.equal(second.segments[0].style.color,'#ff808e');
  assert.deepEqual(second.segments[1],{text:' normal',style:{}});
});

test('supports 256 colors and truecolor without generating HTML',()=>{
  const [line]=formatConsoleLines(['\x1b[38;5;196mred\x1b[38;2;12;34;56m<img src=x onerror=alert(1)>']);
  assert.equal(line.segments[0].style.color,'rgb(255, 0, 0)');
  assert.equal(line.segments[1].style.color,'rgb(12, 34, 56)');
  assert.equal(line.segments[1].text,'<img src=x onerror=alert(1)>');
});

test('keeps color for rendering and removes control sequences from copied logs',()=>{
  const source='\x1b]0;Window title\x07\x1b[2J\x1b[33m[Pterodactyl Daemon] Starting\x1b[0m';
  const output=consoleOutput(source,'console output',true);
  assert.equal(output,'\x1b[33m[Voltra] Starting\x1b[0m');
  assert.equal(stripConsoleControls(output),'[Voltra] Starting');
  assert.equal(consoleOutput('\x1b[32mVOLTRA_READY\x1b[0m','console output',true),'');
});


test('container launch commands have a separate color', () => {
  assert.equal(detectConsoleLevel('container@voltra~ java -version'), 'command');
  assert.equal(detectConsoleLevel('Chat: container@voltra~ java -version'), 'normal');
});

test('normalizes Minecraft logger INFO green, including the raw Forge namespace prefix', () => {
  const raw='\x1b[m\x1b[32m[05:53:36] [Server thread/INFO] [AllTheLeaks/]: |- LevelChunk (minecraft): 232';
  const batch=formatConsoleBatch([
    raw,
    '\x1b[m\x1b[32m[05:42:06] [Server thread/INFO] [cy.jd.jei/]: JEIStuff loaded',
    '[05:53:37] [Server thread/WARN] [AllTheLeaks/]: WARNING leak detected',
    '[05:53:38] [Server thread/ERROR]: Failed to load',
    '[05:53:39] [Server thread/DEBUG]: Inspecting chunks',
    '\x1b[m\x1b[32m[05:53:40] [Server thread/INFO]: Done (1.2s)! For help, type "help"',
  ]);
  assert.deepEqual(batch.lines.map(line=>line.level),['info','info','warning','error','debug','success']);
  for (const line of batch.lines) assert.ok(line.segments.every(segment=>segment.style.color===undefined));
  assert.deepEqual(batch.endStyle,{});
  assert.equal(batch.lines[0].segments.map(segment=>segment.text).join(''),stripConsoleControls(raw));
});

test('Minecraft INFO drops inherited logger foreground but preserves inline chat colors and resets', () => {
  const batch=formatConsoleBatch([
    '\x1b[32m[05:53:36] [Server thread/INFO] [jei/]: loading \x1b[35mcolored\x1b[39m neutral',
    '[05:53:37] [Server thread/INFO]: <Player> \x1b[32mgreen chat\x1b[0m plain',
  ],{color:'#ff808e',fontWeight:700});
  assert.equal(batch.lines[0].segments[0].style.color,undefined);
  assert.equal(batch.lines[0].segments[0].style.fontWeight,700);
  assert.equal(batch.lines[0].segments[1].style.color,'#d6a1ed');
  assert.equal(batch.lines[0].segments[2].style.color,undefined);
  assert.equal(batch.lines[1].segments[1].style.color,'#86dba0');
  assert.deepEqual(batch.lines[1].segments[2].style,{});
  assert.deepEqual(batch.endStyle,{});
});

test('non-log ANSI continuation survives across batches and foreground reset stops bleed', () => {
  const first=formatConsoleBatch(['\x1b[32mgame chat']);
  const next=formatConsoleBatch(['still green\x1b[39m neutral','plain'],first.endStyle);
  assert.equal(next.lines[0].segments[0].style.color,'#86dba0');
  assert.deepEqual(next.lines[0].segments[1].style,{});
  assert.deepEqual(next.lines[1].segments[0].style,{});
  assert.deepEqual(next.endStyle,{});
});
