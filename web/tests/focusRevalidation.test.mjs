import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle = await build({
  entryPoints: [new URL('../src/hooks/focusRevalidation.ts', import.meta.url).pathname.replace(/^\/(.:)/, '$1')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const f = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function page(t) {
  t.mock.timers.enable({apis: ['setTimeout']});
  const old = {window: globalThis.window, document: globalThis.document};
  const listeners = {window: 0, document: 0};
  const counted = (target, key) => {
    const add = target.addEventListener.bind(target),
      remove = target.removeEventListener.bind(target);
    target.addEventListener = (...a) => {
      listeners[key]++;
      add(...a);
    };
    target.removeEventListener = (...a) => {
      listeners[key]--;
      remove(...a);
    };
    return target;
  };
  globalThis.window = counted(new EventTarget(), 'window');
  globalThis.document = counted(Object.assign(new EventTarget(), {hidden: false}), 'document');
  t.after(() => Object.assign(globalThis, old));
  return {
    listeners,
    focus: () => window.dispatchEvent(new Event('focus')),
    hide: () => {
      document.hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
    },
    show: () => {
      document.hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

test('every read shares one listener pair, and focus plus visibility collapse into one pass', t => {
  const p = page(t);
  let a = 0,
    b = 0;
  const stops = [
    f.onFocusRevalidate(
      () => false,
      () => a++
    ),
    f.onFocusRevalidate(
      () => false,
      () => b++
    ),
  ];
  for (let i = 0; i < 50; i++)
    stops.push(
      f.onFocusRevalidate(
        () => true,
        () => assert.fail('fresh read fetched')
      )
    );
  assert.equal(p.listeners.window, 1);
  assert.equal(p.listeners.document, 1);
  p.hide();
  p.show();
  p.focus();
  p.focus();
  t.mock.timers.tick(f.FOCUS_DEBOUNCE_MS - 1);
  assert.equal(a, 0);
  t.mock.timers.tick(1);
  assert.equal(a, 1);
  assert.equal(b, 1);
  p.focus();
  t.mock.timers.tick(f.FOCUS_DEBOUNCE_MS);
  assert.equal(a, 2);
  stops.forEach(stop => stop());
  assert.equal(p.listeners.window, 0);
});

test('a pass tells reads whether the page was hidden, and nothing runs while hidden', t => {
  const p = page(t);
  const passes = [];
  const stop = f.onFocusRevalidate(
    pass => {
      passes.push(pass.hidden);
      return true;
    },
    () => {}
  );
  p.focus();
  t.mock.timers.tick(f.FOCUS_DEBOUNCE_MS);
  p.hide();
  p.focus();
  t.mock.timers.tick(f.FOCUS_DEBOUNCE_MS);
  assert.deepEqual(passes, [false]);
  p.show();
  t.mock.timers.tick(f.FOCUS_DEBOUNCE_MS);
  assert.deepEqual(passes, [false, true]);
  stop();
});

test('the last reader removes the listeners and a pending pass', t => {
  const p = page(t);
  let runs = 0;
  const stop = f.onFocusRevalidate(
    () => false,
    () => runs++
  );
  p.focus();
  stop();
  t.mock.timers.tick(1000);
  assert.equal(runs, 0);
  assert.equal(p.listeners.window, 0);
  assert.equal(p.listeners.document, 0);
});

test('a read that unmounts during a pass is skipped and a failing check revalidates', t => {
  const p = page(t);
  let later = 0,
    failing = 0,
    stopLater;
  const first = f.onFocusRevalidate(
    () => false,
    () => stopLater()
  );
  stopLater = f.onFocusRevalidate(
    () => false,
    () => later++
  );
  const broken = f.onFocusRevalidate(
    () => {
      throw new Error('x');
    },
    () => failing++
  );
  p.focus();
  t.mock.timers.tick(f.FOCUS_DEBOUNCE_MS);
  assert.equal(later, 0);
  assert.equal(failing, 1);
  first();
  broken();
  assert.equal(f.answeredRecently(0), false);
  assert.equal(f.answeredRecently(1000, 1000 + f.FOCUS_FRESH_MS - 1), true);
  assert.equal(f.answeredRecently(1000, 1000 + f.FOCUS_FRESH_MS), false);
});
