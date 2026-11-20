import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import * as React from 'react';
import {fileURLToPath} from 'node:url';
import {loadModule} from './loadModule.mjs';

globalThis.__recoveryReact = React;
async function load(entry) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    define: {'import.meta.env.VITE_DESKTOP': '"false"'},
    plugins: [
      {
        name: 'fixture',
        setup(b) {
          b.onResolve({filter: /.*/}, args =>
            args.kind === 'entry-point' ? undefined : {path: args.path, namespace: 'fixture'}
          );
          b.onLoad({filter: /.*/, namespace: 'fixture'}, ({path}) => {
            // Stand-ins are named by module, wherever the importing file sits.
            const name = path.replace(/^(?:\.\.?\/)+/, '');
            let contents;
            if (path === 'react')
              contents =
                ['useState', 'useEffect', 'useCallback', 'useRef']
                  .map(n => `export const ${n}=(...a)=>globalThis.__gate.${n}(...a);`)
                  .join('\n') +
                '\nexport const createContext=globalThis.__recoveryReact.createContext; export const Component=globalThis.__recoveryReact.Component; export const lazy=globalThis.__recoveryReact.lazy; export const Suspense=globalThis.__recoveryReact.Suspense;';
            else if (path === 'react/jsx-runtime')
              contents =
                'export const jsx=(type,props,key)=>({type,props,key});export const jsxs=jsx;export const Fragment="fragment";';
            else if (path === 'react-router-dom')
              contents =
                'export const Link="a";export const useLocation=()=>({pathname:"/"});export const useNavigate=()=>()=>{};';
            else if (name === 'lib')
              contents =
                'export const api=(...a)=>globalThis.__gate.request(...a);export const queryCacheSessionIdentity=s=>JSON.stringify(s);' +
                ['Select', 'Button', 'Card', 'ErrorBox', 'Field', 'Loading']
                  .map(n => `export const ${n}="${n}";`)
                  .join('');
            else if (name === 'components/ui/checkbox') contents = 'export const Checkbox="input";';
            else if (name === 'components/ui/input') contents = 'export const Input="input";';
            else if (name === 'notifications') contents = 'export const Feedback="Feedback";';
            else if (name === 'ui/ActionButton') contents = 'export const ActionButton="button";';
            else if (name === 'desktop/desktop') contents = 'export const DesktopRecoveryActions="recovery";';
            else if (name === 'signedOut')
              contents =
                'export const forgetSignedInAccount=()=>{globalThis.__forgotAccount=(globalThis.__forgotAccount||0)+1};';
            else if (name === 'RouteRecovery') contents = 'export default "RouteRecovery";';
            else if (path === 'react-dom') contents = 'export const createPortal=node=>node;';
            else if (name === 'hooks/queryCache') contents = 'export const invalidateQueryCache=()=>{};';
            // Synchronous stand-in for the shared, debounced focus handler.
            else if (name === 'hooks/focusRevalidation')
              contents =
                'export const onFocusRevalidate=(fresh,revalidate)=>{const run=()=>{if(!fresh({hidden:false}))revalidate()};window.addEventListener("focus",run);return()=>window.removeEventListener("focus",run)};';
            else contents = 'export default "stub";';
            return {contents, loader: 'js'};
          });
        },
      },
    ],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const {default: SetupGate} = await load('../src/features/setup/setup.tsx');
const {default: RouteRecovery} = await load('../src/RouteRecovery.tsx');
function fixture() {
  let index = 0,
    pending = false,
    effects = [];
  const hooks = [],
    requests = [];
  const f = {
    requests,
    value: null,
    request(path) {
      return new Promise((resolve, reject) => requests.push({path, resolve, reject}));
    },
    useState(initial) {
      const slot = index++;
      if (!hooks[slot]) hooks[slot] = {value: typeof initial === 'function' ? initial() : initial};
      return [
        hooks[slot].value,
        next => {
          hooks[slot].value = typeof next === 'function' ? next(hooks[slot].value) : next;
          pending = true;
        },
      ];
    },
    useRef(initial) {
      return f.useState(() => ({current: initial}))[0];
    },
    useCallback(callback, deps) {
      const slot = index++;
      if (!hooks[slot] || deps.some((v, i) => v !== hooks[slot].deps[i])) hooks[slot] = {value: callback, deps};
      return hooks[slot].value;
    },
    useEffect(effect, deps) {
      const slot = index++,
        old = hooks[slot];
      if (!old || deps.some((v, i) => v !== old.deps[i])) {
        const h = {deps, cleanup: old?.cleanup};
        hooks[slot] = h;
        effects.push(() => {
          h.cleanup?.();
          h.cleanup = effect();
        });
      }
    },
    render() {
      do {
        pending = false;
        index = 0;
        globalThis.__gate = f;
        f.value = SetupGate({children: 'draft'});
        const run = effects;
        effects = [];
        run.forEach(e => e());
      } while (pending);
      return f.value;
    },
    async settle() {
      await new Promise(r => setImmediate(r));
      return f.render();
    },
    close() {
      hooks.forEach(h => h.cleanup?.());
    },
  };
  globalThis.window = new EventTarget();
  f.render();
  return f;
}
const status = {needs_setup: false, setup_allowed: false, auth_enabled: true, dev_mode: false};
const session = {authenticated: true, user: {id: 1, root_admin: true}};
async function ready() {
  const f = fixture();
  f.requests[0].resolve(status);
  f.requests[1].resolve(session);
  await f.settle();
  return f;
}
function protectedPage(f) {
  return f.value.props.children?.[0] === 'draft';
}
test('focus transient failure preserves the mounted protected child and provider identity', async () => {
  const f = await ready();
  try {
    const key = f.value.key;
    window.dispatchEvent(new Event('focus'));
    f.render();
    f.requests[2].reject(new Error('offline'));
    f.requests[3].reject(new Error('offline'));
    await f.settle();
    assert(protectedPage(f));
    assert.equal(f.value.key, key);
  } finally {
    f.close();
  }
});
test('confirmed signout applies even if setup status fails', async () => {
  const f = await ready();
  try {
    window.dispatchEvent(new Event('focus'));
    f.render();
    f.requests[2].reject(new Error('offline'));
    f.requests[3].resolve({authenticated: false});
    await f.settle();
    assert(!protectedPage(f));
    assert.equal(f.value.type.name, 'Login');
  } finally {
    f.close();
  }
});
test('401 event clears protected content immediately and ignores stale authenticated response', async () => {
  const f = await ready();
  try {
    window.dispatchEvent(new Event('focus'));
    f.render();
    window.dispatchEvent(new Event('desktop-session-rejected'));
    f.render();
    assert(!protectedPage(f));
    f.requests[2].resolve(status);
    f.requests[3].resolve(session);
    await f.settle();
    assert(!protectedPage(f));
    assert.equal(f.requests.length, 4);
  } finally {
    f.close();
  }
});
test('auth mutation clears mounted protected content before revalidation', async () => {
  const f = await ready();
  try {
    window.dispatchEvent(new Event('panel-auth-changed'));
    f.render();
    assert(!protectedPage(f));
  } finally {
    f.close();
  }
});
test('rejected lazy import renders explicit reload recovery without automatic reload', async () => {
  let reloads = 0;
  globalThis.window = {
    location: {
      reload() {
        reloads++;
      },
    },
  };
  const Lazy = React.lazy(() => Promise.reject(new Error('chunk unavailable')));
  let thrown;
  try {
    Lazy._init(Lazy._payload);
  } catch (pending) {
    await pending.catch(() => {});
  }
  try {
    Lazy._init(Lazy._payload);
  } catch (error) {
    thrown = error;
  }
  assert.match(thrown.message, /chunk unavailable/);
  const boundary = new RouteRecovery({children: 'route'});
  boundary.state = RouteRecovery.getDerivedStateFromError(thrown);
  const view = boundary.render();
  assert.equal(view.props.children[0].type, 'Feedback');
  assert.equal(view.props.children[0].props.tone, 'error');
  assert.equal(reloads, 0);
  view.props.children[1].props.onClick();
  assert.equal(reloads, 1);
  assert.throws(() => Lazy._init(Lazy._payload), /chunk unavailable/);
});

test('account refresh failure retains shell only while account data exists', async () => {
  const element = (type, props, key) => ({type, props, key});
  const shell = data =>
    loadModule(
      new URL('../src/App.tsx', import.meta.url),
      {
        react: {useEffect() {}},
        'react/jsx-runtime': {jsx: element, jsxs: element, Fragment: 'fragment'},
        './lib': {useAPI: () => ({data, error: 'offline', reload() {}}), unwrap: r => r.attributes, Loading: 'loading'},
        './hooks/readyRoute': {readyRoute: () => ({preload: () => Promise.resolve()})},
        './features/desktop/DesktopResume': {default: 'resume'},
        './ThemeProvider': {ThemeProvider: 'theme'},
        './ServerNavigation': {ServerNavigationProvider: 'navigation'},
        './features/servers/ArtworkProvider': {ArtworkProvider: 'artwork'},
        './ui/ActionButton': {ActionButton: 'button'},
        './notifications': {Feedback: 'feedback'},
      },
      {window: {location: {pathname: '/'}}}
    ).AuthenticatedShell();
  const run = account => shell(account && {attributes: account});
  assert.equal(run({id: 1}).type, 'resume');
  assert.equal(run({id: 1}).props.children.type, 'theme');
  assert.equal(run(null).type, 'div');
});
test('60 second timer uses the same non-destructive refresh path', async () => {
  const original = setInterval;
  let callback;
  globalThis.setInterval = (fn, delay) => {
    assert.equal(delay, 60000);
    callback = fn;
    return original(() => {}, 60000);
  };
  const f = await ready();
  globalThis.setInterval = original;
  try {
    callback();
    f.render();
    f.requests[2].reject(new Error('offline'));
    f.requests[3].reject(new Error('offline'));
    await f.settle();
    assert(protectedPage(f));
  } finally {
    f.close();
    globalThis.setInterval = original;
  }
});

test('confirmed session signout clears content while setup request is still pending', async () => {
  const f = await ready();
  try {
    window.dispatchEvent(new Event('focus'));
    f.render();
    f.requests[3].resolve({authenticated: false});
    await f.settle();
    assert(!protectedPage(f));
    assert.equal(f.value.type.name, 'Login');
    f.requests[2].resolve(status);
    await f.settle();
  } finally {
    f.close();
  }
});
test('navigation resets a failed boundary without reloading the document', () => {
  const boundary = new RouteRecovery({children: 'new route', resetKey: '/account'});
  boundary.state = {failed: true};
  boundary.setState = next => {
    boundary.state = {...boundary.state, ...next};
  };
  boundary.componentDidUpdate({children: 'old route', resetKey: '/server/one'});
  const rendered = boundary.render();
  assert.equal(rendered.props.children[1], 'new route');
  assert.equal(rendered.props.children[0].props.hidden, true);
});
test('a session that ended without sign-out removes the saved pages; an open development panel keeps them', async () => {
  globalThis.__forgotAccount = 0;
  let f = fixture();
  f.requests[0].resolve(status);
  f.requests[1].resolve({authenticated: false});
  await f.settle();
  try {
    assert(!protectedPage(f));
    assert.equal(globalThis.__forgotAccount, 1);
  } finally {
    f.close();
  }
  globalThis.__forgotAccount = 0;
  f = fixture();
  f.requests[0].resolve({...status, auth_enabled: false, dev_mode: true});
  f.requests[1].resolve({authenticated: false});
  await f.settle();
  try {
    assert(protectedPage(f));
    assert.equal(globalThis.__forgotAccount, 0);
  } finally {
    f.close();
  }
  f = await ready();
  try {
    assert.equal(globalThis.__forgotAccount, 0);
  } finally {
    f.close();
  }
});
test('the setup wizard and HTTPS check load inside the reload recovery', async () => {
  const inside = element =>
    element.type === 'RouteRecovery' &&
    typeof element.props.children.type !== 'string' &&
    !!element.props.children.props.fallback;
  let f = fixture();
  f.requests[0].resolve({...status, needs_setup: true, setup_allowed: true});
  f.requests[1].resolve({authenticated: false});
  await f.settle();
  try {
    assert(inside(f.value), 'first-run setup');
  } finally {
    f.close();
  }
  f = fixture();
  f.requests[0].resolve({...status, https_pending: true});
  f.requests[1].resolve(session);
  await f.settle();
  try {
    assert(inside(f.value.props.children[0]), 'pending HTTPS');
  } finally {
    f.close();
  }
});
