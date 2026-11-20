const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const code = fs.readFileSync(require('node:path').join(__dirname, '../public/startup.js'), 'utf8');
function harness(reduced = false) {
  let now = 0,
    id = 0,
    raf = null,
    observer,
    removed = false,
    busy = true,
    content = false,
    alert = false;
  const timers = new Map(),
    classes = new Set();
  const dots = Array.from({length: 3}, () => ({setAttribute() {}}));
  const overlay = {
    querySelectorAll: () => dots,
    classList: {add: (...v) => v.forEach(x => classes.add(x)), remove: (...v) => v.forEach(x => classes.delete(x))},
    remove() {
      removed = true;
    },
  };
  const root = {
    inert: false,
    get firstElementChild() {
      return content ? {} : null;
    },
    querySelector(s) {
      return s.includes('alert') ? (alert ? {} : null) : busy ? {} : null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const ctx = {
    document: {
      getElementById: id => (id === 'root' ? root : null),
      createElement: () => ({
        set innerHTML(v) {
          assert.match(v, /Voltra/);
        },
        firstElementChild: overlay,
      }),
      body: {append() {}},
    },
    MutationObserver: class {
      constructor(cb) {
        observer = cb;
      }
      observe() {}
      disconnect() {}
    },
    window: {addEventListener() {}, removeEventListener() {}},
    HTMLScriptElement: class {},
    matchMedia: () => ({matches: reduced}),
    performance: {now: () => now},
    setTimeout(fn, ms) {
      timers.set(++id, {fn, at: now + ms});
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    requestAnimationFrame(fn) {
      raf = fn;
      return ++id;
    },
    cancelAnimationFrame() {
      raf = null;
    },
  };
  vm.runInNewContext(code, ctx);
  function tick(ms) {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + 10);
      for (const [id, t] of [...timers])
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      if (raf) {
        const fn = raf;
        raf = null;
        fn(now);
      }
    }
  }
  return {
    root,
    classes,
    tick,
    get removed() {
      return removed;
    },
    render(loading, error = false) {
      content = true;
      busy = loading;
      alert = error;
      observer();
    },
  };
}
test('holds over initial gate and lazy route, then releases input after 150ms fade', () => {
  const h = harness();
  h.tick(1000);
  assert.equal(h.removed, false);
  assert.equal(h.root.inert, true);
  h.render(true);
  h.tick(1000);
  assert.equal(h.removed, false);
  h.render(false);
  h.tick(90);
  assert.equal(h.classes.size, 0);
  h.tick(160);
  assert.equal(h.classes.has('settled'), true);
  assert.equal(h.classes.has('leaving'), false);
  assert.equal(h.removed, false);
  h.tick(100);
  assert.equal(h.classes.has('leaving'), true);
  assert.equal(h.removed, false);
  h.tick(150);
  assert.equal(h.removed, true);
  assert.equal(h.root.inert, false);
});
test('a chained loading gate cancels early completion', () => {
  const h = harness();
  h.tick(20);
  h.render(false);
  h.tick(200);
  h.render(true);
  h.tick(1000);
  assert.equal(h.removed, false);
  h.render(false);
  h.tick(700);
  assert.equal(h.removed, true);
});
test('a page that keeps changing once it has loaded does not hold the splash', () => {
  // Live readings and artwork touch the page every few milliseconds from here on.
  const h = harness();
  h.tick(20);
  h.render(false);
  for (let i = 0; i < 14; i++) {
    h.tick(30);
    h.render(false);
    if (i === 2) assert.equal(h.removed, false);
  }
  assert.equal(h.classes.has('leaving'), true);
  h.tick(40);
  assert.equal(h.removed, true);
});
test('a loading state that returns during the exit undoes it', () => {
  const h = harness();
  h.tick(20);
  h.render(false);
  h.tick(150);
  assert.equal(h.classes.has('settled'), true);
  h.render(true);
  assert.equal(h.classes.size, 0);
  h.tick(1000);
  assert.equal(h.removed, false);
  h.render(false);
  h.tick(90);
  assert.equal(h.classes.size, 0);
  h.tick(360);
  assert.equal(h.removed, true);
});
test('real recovery error is revealed even if a loading marker remains', () => {
  const h = harness();
  h.tick(20);
  h.render(true, true);
  h.tick(700);
  assert.equal(h.removed, true);
});
test('stalled startup fails open instead of trapping keyboard input forever', () => {
  const h = harness();
  h.tick(20010);
  assert.equal(h.removed, true);
  assert.equal(h.root.inert, false);
});
test('reduced motion skips completion animation', () => {
  const h = harness(true);
  h.tick(20);
  h.render(false);
  h.tick(120);
  assert.equal(h.removed, true);
});
