import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
// The real hook module. Its imports and browser globals come from the current fixture.
const deps = [
  'readPolicy',
  'observeQuery',
  'applyLiveQuery',
  'readQuerySnapshot',
  'invalidateExactQuery',
  'fenceQueryResponse',
  'queryAnsweredAt',
  'observeLivePath',
  'isLivePathFresh',
  'observeReadInvalidation',
  'liveSocketReady',
  'liveHintsHealthy',
  'onFocusRevalidate',
  'answeredRecently',
  'useState',
  'useEffect',
  'useRef',
  'useCallback',
];
const forward = names =>
  names.map(name => `export const ${name}=(...args)=>globalThis.__useAPIRequestFixture.${name}(...args);`).join('');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/hooks/useAPIRequest.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  define: {
    document: 'globalThis.__useAPIRequestFixture.document',
    window: 'globalThis.__useAPIRequestFixture.window',
    setInterval: 'globalThis.__useAPIRequestFixture.setInterval',
    clearInterval: 'globalThis.__useAPIRequestFixture.clearInterval',
  },
  plugins: [
    {
      name: 'fixture-modules',
      setup(b) {
        b.onResolve({filter: /^(react|[.][/](readPolicy|queryCache|liveEvents|focusRevalidation))$/}, args => ({
          path: args.path,
          namespace: 'fixture',
        }));
        b.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: forward(deps), loader: 'js'}));
      },
    },
  ],
});
const {useAPIRequest} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(live = false) {
  let state,
    index = 0;
  const hooks = [],
    effects = [],
    cleanups = [],
    timers = [],
    calls = [];
  let sample, hint, pending, focus;
  const window = new EventTarget(),
    document = Object.assign(new EventTarget(), {hidden: false});
  const useRef = initial => {
    const i = index++;
    return (hooks[i] ??= {current: initial});
  };
  const useState = initial => {
    state = typeof initial === 'function' ? initial() : initial;
    return [state, next => (state = typeof next === 'function' ? next(state) : next)];
  };
  const injected = [
    useState,
    fn => effects.push(fn),
    useRef,
    fn => fn,
    () => undefined,
    () => undefined,
    () => {},
    () => false,
    (_p, cb, onPending) => {
      sample = cb;
      pending = onPending;
      return live ? () => {} : undefined;
    },
    () => false,
    (_p, cb) => {
      hint = cb;
      return () => {};
    },
    () => ({domains: ['files'], reconcileMs: 15000}),
    document,
    window,
    fn => {
      timers.push(fn);
      return timers.length;
    },
    () => {},
    () => {},
    () => 0,
    () => false,
    () => false,
    (fresh, revalidate) => {
      focus = {fresh, revalidate};
      return () => {
        focus = undefined;
      };
    },
    at => at > 0 && Date.now() - at < 10000,
  ];
  globalThis.__useAPIRequestFixture = {
    ...Object.fromEntries(
      [
        'useState',
        'useEffect',
        'useRef',
        'useCallback',
        'observeQuery',
        'readQuerySnapshot',
        'applyLiveQuery',
        'invalidateExactQuery',
        'observeLivePath',
        'isLivePathFresh',
        'observeReadInvalidation',
        'readPolicy',
        'document',
        'window',
        'setInterval',
        'clearInterval',
        'fenceQueryResponse',
        'queryAnsweredAt',
        'liveSocketReady',
        'liveHintsHealthy',
        'onFocusRevalidate',
        'answeredRecently',
      ].map((name, i) => [name, injected[i]])
    ),
  };
  const hook = useAPIRequest;
  hook(
    '/api/client/servers/a/files/list',
    (_path, options) => new Promise((resolve, reject) => calls.push({resolve, reject, options}))
  );
  for (const effect of effects) cleanups.push(effect());
  return {
    calls,
    get focus() {
      return focus;
    },
    get state() {
      return state;
    },
    poll: () => timers[0](),
    pending: () => pending(),
    sample: value => sample(value),
    hint: () => hint(),
    cleanup: () => cleanups.forEach(fn => fn?.()),
  };
}
test('reconciliation ticks never starve a slow HTTP response', async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) f.poll();
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve({data: ['first']});
  await tick();
  assert.deepEqual(f.state.data, {data: ['first']});
  assert.equal(f.calls.length, 2);
  f.cleanup();
});
test('change hint fences an in-flight HTTP response and schedules one replacement', async () => {
  const f = fixture();
  f.hint();
  f.hint();
  f.calls[0].resolve({data: ['old']});
  await tick();
  assert.equal(f.state.data, null);
  assert.equal(f.calls.length, 2);
  f.calls[1].resolve({data: ['new']});
  await tick();
  assert.deepEqual(f.state.data, {data: ['new']});
  f.cleanup();
});
test('socket snapshots win over older HTTP; transient errors retain content but revocation clears it', async () => {
  const f = fixture(true);
  f.sample({status: 200, data: {data: ['live']}});
  f.calls[0].resolve({data: ['old']});
  await tick();
  assert.deepEqual(f.state.data, {data: ['live']});
  f.sample({status: 503, data: {errors: [{detail: 'Node unavailable'}]}});
  assert.deepEqual(f.state.data, {data: ['live']});
  assert.equal(f.state.error, 'Node unavailable');
  f.sample({status: 403, data: {errors: [{detail: 'Forbidden'}]}});
  assert.equal(f.state.data, null);
  f.cleanup();
});
test('unmounted requests are aborted and cannot write late results', async () => {
  const f = fixture();
  f.cleanup();
  assert.equal(f.calls[0].options.signal.aborted, true);
  f.calls[0].resolve({old: true});
  await tick();
  assert.equal(f.state.data, null);
});

test('pending snapshot fences old HTTP without immediately starting a duplicate read', async () => {
  const f = fixture(true);
  f.pending();
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve({data: ['old']});
  await tick();
  assert.equal(f.state.data, null);
  assert.equal(f.calls.length, 1);
  f.sample({status: 200, data: {data: ['current']}});
  assert.deepEqual(f.state.data, {data: ['current']});
  f.cleanup();
});

test('return to the page goes through the shared focus pass and skips a read that just answered', async () => {
  const f = fixture();
  f.calls[0].resolve({data: ['first']});
  await tick();
  assert.equal(typeof f.focus.fresh, 'function');
  // Answered moments ago: fresh, even after the page was hidden.
  assert.equal(f.focus.fresh({hidden: true}), true);
  const realNow = Date.now;
  Date.now = () => realNow() + 60000;
  try {
    assert.equal(f.focus.fresh({hidden: true}), false);
    f.focus.revalidate();
    assert.equal(f.calls.length, 2);
  } finally {
    Date.now = realNow;
  }
  f.cleanup();
  assert.equal(f.focus, undefined);
});
