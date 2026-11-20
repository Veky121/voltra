import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as model from '../src/ui/terminalProgressModel.ts';
import {loadModule} from './loadModule.mjs';

const {bytesProgressValue, formatBytesProgress, terminalBar, terminalGlyph, terminalPercent} = model;
const {TerminalProgress} = loadModule(new URL('../src/ui/TerminalProgress.tsx', import.meta.url), {
  './terminalProgressModel': model,
});

test('terminal bar draws a moving head and a full bar without one', () => {
  assert.equal(terminalBar(0, 10), '[          ]');
  assert.equal(terminalBar(50, 10), '[====>     ]');
  assert.equal(terminalBar(100, 10), '[==========]');
  assert.equal(terminalBar(250, 10), '[==========]');
  assert.equal(terminalBar(-5, 10), '[          ]');
  assert.equal(terminalBar(50, 1).length, 6); // never narrower than four cells
});

test('percentages are clamped and unknown amounts stay unknown', () => {
  assert.equal(terminalPercent(42.5), 42.5);
  assert.equal(terminalPercent(140), 100);
  assert.equal(terminalPercent(null), null);
  assert.equal(terminalPercent(Number.NaN), null);
  assert.equal(terminalGlyph('done'), '✔');
  assert.equal(terminalGlyph('failed'), '✖');
});

test('byte progress preserves measured work and uses the shared size units', () => {
  const gb = 1024 ** 3;
  assert.equal(bytesProgressValue(gb, 2 * gb), 50);
  assert.equal(bytesProgressValue(0, gb), 0);
  assert.equal(bytesProgressValue(3 * gb, 2 * gb), 100);
  assert.equal(bytesProgressValue(34), null);
  assert.equal(bytesProgressValue(34, 0), null);
  assert.equal(bytesProgressValue(-1, gb), null);
  assert.equal(bytesProgressValue(Number.NaN, gb), null);
  assert.equal(formatBytesProgress(gb / 2, 2 * gb), '512 MB of 2 GB');
  assert.equal(formatBytesProgress(0, undefined), '0 B received');
  assert.equal(formatBytesProgress(undefined, gb), '1 GB total');
  assert.equal(formatBytesProgress(Number.NaN, undefined), '');
});

test('terminal progress exposes measured values and an accessible operation name', () => {
  const html = renderToStaticMarkup(
    createElement(TerminalProgress, {
      label: 'Downloading',
      ariaLabel: 'Downloading world.zip',
      value: 52,
      detail: '52 MB of 100 MB',
      width: 20,
    })
  );
  assert.match(html, /role="progressbar" aria-label="Downloading world\.zip"/);
  assert.match(html, /aria-valuenow="52"/);
  assert.match(html, /aria-valuetext="52%, 52 MB of 100 MB"/);
  assert.match(html, /\[=========&gt; {10}\]/);
  assert.match(html, /class="terminal-spinner" aria-hidden="true"/);
});

test('unknown active or finished phases omit percentages', () => {
  const render = props => renderToStaticMarkup(createElement(TerminalProgress, {label: 'Creating backup', ...props}));
  assert.match(render({}), /terminal-spinner/);
  assert.doesNotMatch(render({}), /aria-valuenow|terminal-progress-bar/);
  for (const value of [undefined, null, Number.NaN, Infinity]) {
    const done = render({state: 'done', value});
    assert.match(done, /is-done/);
    assert.doesNotMatch(done, /aria-valuenow|terminal-progress-bar|terminal-spinner/);
  }
});

test('paused and finished rows expose their status and keep measured percentages', () => {
  for (const [state, status] of [
    ['done', 'Complete'],
    ['failed', 'Failed'],
    ['waiting', 'Paused'],
  ]) {
    const html = renderToStaticMarkup(
      createElement(TerminalProgress, {
        label: 'world.zip',
        ariaLabel: 'Uploading world.zip',
        state,
        statusText: state === 'waiting' ? status : undefined,
        value: 26,
      })
    );
    assert.match(html, /role="status"/);
    assert.match(html, new RegExp('world\.zip.*' + status));
    assert.match(html, /terminal-progress-percent">26%/);
    assert.doesNotMatch(html, /progressbar|aria-valuenow|aria-label="Uploading|terminal-spinner|100%/);
  }
});
