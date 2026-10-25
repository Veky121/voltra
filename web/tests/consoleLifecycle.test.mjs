import test from 'node:test';
import assert from 'node:assert/strict';
import {lifecycleLine, runPowerRequest, consoleStateLine} from '../src/client/consoleLifecycle.ts';
import {stripConsoleControls} from '../src/client/consoleOutput.ts';
import {formatConsoleBatch} from '../src/client/consoleFormatting.ts';

test('power request is logged before transport; acceptance does not claim completion', async () => {
  for (const signal of ['start','stop','restart','kill']) {
    const events = [];
    let resolve;
    const pending = runPowerRequest(signal, () => {events.push('transport'); return new Promise(done => {resolve=done;});}, line => events.push(stripConsoleControls(line)));
    assert.match(events[0], /requested/);
    assert.equal(events[1], 'transport');
    assert.equal(events.length, 2);
    resolve('accepted');
    assert.equal(await pending, 'accepted');
    assert.match(events[2], /request accepted by the node. Waiting for a state update/);
    assert.doesNotMatch(events[2], /Server stopped|Server entered/);
  }
});
test('failed requests preserve errors but do not copy private error details into logs', async () => {
  const lines = [], error = new Error('private-token=never-copy-this');
  await assert.rejects(runPowerRequest('stop', () => Promise.reject(error), line => lines.push(line)), e => e === error);
  assert.equal(lines.length,2);
  assert.match(stripConsoleControls(lines[1]), /Could not confirm the stop request/);
  assert.doesNotMatch(lines.join(''), /private-token|never-copy-this|accepted/);
  assert.match(lines[1], /\x1b\[91m/);
});
test('state changes are distinct and deduplicated without inventing readiness or crashes', () => {
  assert.match(stripConsoleControls(consoleStateLine('unknown','running')), /Current server state: running/);
  assert.equal(consoleStateLine('running','running'),null);
  assert.equal(consoleStateLine('running','unexpected'),null);
  assert.match(stripConsoleControls(consoleStateLine('offline','starting')), /Server is starting/);
  assert.match(stripConsoleControls(consoleStateLine('starting','running')), /entered the running state/);
  assert.match(stripConsoleControls(consoleStateLine('running','stopping')), /Waiting for the process to exit/);
  assert.match(stripConsoleControls(consoleStateLine('stopping','offline')), /Server stopped/);
  assert.match(stripConsoleControls(consoleStateLine('starting','offline')), /went offline during startup/);
  assert.match(stripConsoleControls(consoleStateLine('running','offline')), /process exited or was stopped/);
});
test('timestamped colors do not inherit or leak game ANSI styles', () => {
  const line = lifecycleLine('Server stopped.', 'success', new Date(2026,0,1,9,2,3));
  assert.equal(stripConsoleControls(line), '[09:02:03] [Voltra]: Server stopped.');
  const parsed = formatConsoleBatch([line, 'uncolored game log'], {backgroundColor:'red',fontWeight:700});
  assert.equal(parsed.lines[0].segments.find(s => s.text==='Server stopped.').style.color, '#a3edb9');
  assert.deepEqual(parsed.lines[1].segments[0].style, {});
});
