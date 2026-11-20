import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {discardBootReads, rememberSignedIn, takeBootRead} from '../src/bootReads.ts';

const answer = (status, body = '{}') => new Response(body, {status});
// A browser's storage as startup.js leaves it: holding the session revision
// that the start noted. Tests that are about the revision put their own
// storage in its place.
const noted = 'revision-at-start';
if (!globalThis.localStorage)
  Object.defineProperty(globalThis, 'localStorage', {
    value: {getItem: key => (key === 'voltra.snapshot-session' ? noted : null), setItem() {}, removeItem() {}},
    configurable: true,
    writable: true,
  });
function install(reads, at = performance.now()) {
  const pending = new Map(Object.entries(reads));
  const boot = {
    at,
    revision: noted,
    cancelled: 0,
    take(path) {
      const read = pending.get(path);
      pending.delete(path);
      return read;
    },
    cancel() {
      boot.cancelled++;
    },
  };
  globalThis.__voltraBoot = boot;
  return boot;
}

test('an early answer goes to the first request for its path and to no other', async () => {
  const account = new Response('{"attributes":{"uuid":"a"}}', {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
  install({'/api/client/account': Promise.resolve(account)});
  assert.equal(await takeBootRead('/api/client/settings'), undefined);
  const taken = await takeBootRead('/api/client/account');
  assert.equal(taken.status, 200);
  assert.equal(taken.headers.get('content-type'), 'application/json');
  assert.deepEqual(await taken.json(), {attributes: {uuid: 'a'}});
  assert.equal(await takeBootRead('/api/client/account'), undefined, 'the answer is spent');
  discardBootReads();
  assert.equal(await takeBootRead('/api/client/account'), undefined);
});

test('refused, failed and late answers are left to an ordinary request', async () => {
  install({'/a': Promise.resolve(answer(401)), '/b': Promise.resolve(undefined), '/c': Promise.resolve(answer(500))});
  for (const path of ['/a', '/b', '/c']) assert.equal(await takeBootRead(path), undefined, path);
  install({'/a': Promise.resolve(answer(200))}, performance.now() - 15_001);
  assert.equal(await takeBootRead('/a'), undefined);
  assert.equal(globalThis.__voltraBoot, undefined, 'late answers are dropped together');
});

test('a caller that gives up is not kept waiting for the early answer', async () => {
  install({'/slow': new Promise(() => {}), '/done': Promise.resolve(answer(200))});
  const controller = new AbortController();
  const waiting = takeBootRead('/slow', controller.signal);
  controller.abort(new Error('gave up'));
  await assert.rejects(waiting, /gave up/);
  await assert.rejects(takeBootRead('/done', controller.signal), /gave up/);
  discardBootReads();
});

test('an answer still on its way is not used once a write, a sign-out or time has passed', async () => {
  let deliver;
  const slow = () =>
    new Promise(resolve => {
      deliver = resolve;
    });
  const boot = install({'/settings': slow()});
  let waiting = takeBootRead('/settings');
  discardBootReads(); // what a write or a sign-out does
  assert.equal(await waiting, undefined, 'the caller is released at once to fetch a fresh answer');
  assert.equal(boot.cancelled, 1, 'and the reads still on their way are abandoned');
  deliver(answer(200, '{"before":"the write"}'));

  // The same when the headers have arrived and only the body is outstanding.
  const stalledBody = new Response(new ReadableStream({start() {}}), {status: 200});
  install({'/settings': Promise.resolve(stalledBody)});
  waiting = takeBootRead('/settings');
  await new Promise(resolve => setImmediate(resolve));
  discardBootReads();
  assert.equal(await waiting, undefined, 'a body that never arrives does not hold a discarded read');

  const realNow = performance.now;
  let now = 1000;
  performance.now = () => now;
  try {
    install({'/settings': slow()}, now);
    waiting = takeBootRead('/settings');
    now += 15_001;
    deliver(answer(200));
    assert.equal(await waiting, undefined, 'an answer that took longer than its lifetime is no head start');
  } finally {
    performance.now = realNow;
    discardBootReads();
  }
});

test('early answers asked for before another tab ended the session are not used', async () => {
  // The other tab signed out while this page was still loading its bundle, so
  // this page was not yet listening when the store's revision moved.
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let stored = 'r1';
  Object.defineProperty(globalThis, 'localStorage', {
    value: {getItem: key => (key === 'voltra.snapshot-session' ? stored : null)},
    configurable: true,
    writable: true,
  });
  try {
    const boot = install({'/api/client/account': Promise.resolve(answer(200))});
    boot.revision = 'r0';
    assert.equal(
      await takeBootRead('/api/client/account'),
      undefined,
      'the answer belongs to a session that has ended'
    );
    assert.equal(boot.cancelled, 1);
    assert.equal(globalThis.__voltraBoot, undefined, 'and so do the others');

    install({'/api/client/account': Promise.resolve(answer(200))}).revision = 'r1';
    assert.equal((await takeBootRead('/api/client/account')).status, 200, 'an unchanged session keeps its head start');
    // A revision that is not there proves nothing: a sign-in or sign-out that
    // could not write a new one, in a full store, removes the old one instead.
    stored = null;
    install({'/api/client/account': Promise.resolve(answer(200))}).revision = null;
    assert.equal(await takeBootRead('/api/client/account'), undefined, 'absent before and absent now is not a match');
    stored = 'r1';
    install({'/api/client/account': Promise.resolve(answer(200))}).revision = 'r1';
    stored = null;
    assert.equal(
      await takeBootRead('/api/client/account'),
      undefined,
      'a revision that has gone missing counts as moved'
    );
    // A start that could note no revision has nothing to be checked against.
    // What depends on the session is not used; the setup state still is.
    stored = 'r9';
    const unnoted = install({
      '/api/client/account': Promise.resolve(answer(200)),
      '/api/setup/status': Promise.resolve(answer(200)),
    });
    delete unnoted.revision;
    assert.equal((await takeBootRead('/api/setup/status')).status, 200, 'the setup state depends on no session');
    assert.equal(await takeBootRead('/api/client/account'), undefined, 'an answer that cannot be checked is not used');

    // The app asks for the setup state and the session in the same instant. In
    // a browser whose storage is blocked only the first was started early; the
    // second finding nothing must not cost the first its answer.
    let deliverSetup;
    const blockedStart = install({
      '/api/setup/status': new Promise(resolve => {
        deliverSetup = resolve;
      }),
    });
    delete blockedStart.revision;
    const setup = takeBootRead('/api/setup/status');
    const session = takeBootRead('/api/auth/session');
    assert.equal(await session, undefined);
    deliverSetup(answer(200));
    assert.equal((await setup).status, 200, 'the setup answer is still used');
    assert.equal(blockedStart.cancelled, 0, 'and was not abandoned');

    // Storage that could be read at the start and cannot be read now is no better.
    install({'/api/client/account': Promise.resolve(answer(200))}).revision = 'r9';
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem() {
          throw new Error('blocked since');
        },
      },
      configurable: true,
      writable: true,
    });
    assert.equal(
      await takeBootRead('/api/client/account'),
      undefined,
      'nor is one whose session can no longer be checked'
    );
    Object.defineProperty(globalThis, 'localStorage', {
      value: {getItem: key => (key === 'voltra.snapshot-session' ? stored : null)},
      configurable: true,
      writable: true,
    });

    // The session ends while a request is already waiting for its answer.
    let deliver;
    install({
      '/api/client/account': new Promise(resolve => {
        deliver = resolve;
      }),
    }).revision = 'r9';
    const waiting = takeBootRead('/api/client/account');
    stored = 'r10';
    deliver(answer(200));
    assert.equal(await waiting, undefined, 'an answer that arrives after the session ended is not used');
  } finally {
    discardBootReads();
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('the lifetime of the early answers bounds the wait itself', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  try {
    // Headers arrived, the body stalls, and the caller sets no deadline of its own.
    const stalled = new Response(new ReadableStream({start() {}}), {status: 200});
    const boot = install(
      {'/api/client/account': Promise.resolve(stalled), '/api/client/settings': new Promise(() => {})},
      performance.now() - 5000
    );
    const account = takeBootRead('/api/client/account', new AbortController().signal);
    const settings = takeBootRead('/api/client/settings');
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(9000);
    assert.ok(globalThis.__voltraBoot, 'still within the lifetime');
    t.mock.timers.tick(1100);
    assert.equal(await account, undefined, 'the page is not left loading past the lifetime');
    assert.equal(await settings, undefined);
    assert.equal(boot.cancelled, 1);
    assert.equal(globalThis.__voltraBoot, undefined);
  } finally {
    t.mock.timers.reset();
    discardBootReads();
  }
});

test('the desktop host saying the connection changed is the answer, not a reason to ask again', async () => {
  install({
    '/api/client/account': Promise.resolve(
      new Response('{"error":"The saved connection changed. Reload the app."}', {
        status: 409,
        headers: {'content-type': 'application/json'},
      })
    ),
  });
  const refused = await takeBootRead('/api/client/account');
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /connection changed/);
  discardBootReads();
});

test('a caller can give up while the body of an early answer is still arriving', async () => {
  // The headers have arrived; the body never finishes.
  const stalled = new Response(new ReadableStream({start() {}}), {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
  install({'/api/auth/session': Promise.resolve(stalled)});
  const controller = new AbortController();
  const waiting = takeBootRead('/api/auth/session', controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(new Error('the panel took too long'));
  await assert.rejects(waiting, /took too long/);
  // A connection that drops mid-answer is not the caller's failure: it asks again.
  const dropped = new Response(
    new ReadableStream({
      start(stream) {
        stream.error(new Error('connection reset'));
      },
    }),
    {status: 200}
  );
  install({'/api/auth/session': Promise.resolve(dropped)});
  assert.equal(await takeBootRead('/api/auth/session', new AbortController().signal), undefined);
  install({'/empty': Promise.resolve(new Response(null, {status: 204}))});
  assert.equal((await takeBootRead('/empty')).status, 204, 'an answer without a body is passed on as one');
  discardBootReads();
});

test('the signed-in note survives blocked storage', () => {
  const values = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const use = value => Object.defineProperty(globalThis, 'localStorage', {value, configurable: true, writable: true});
  try {
    use({setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)});
    rememberSignedIn(true);
    assert.equal(values.get('voltra.signed-in'), '1');
    rememberSignedIn(false);
    assert.equal(values.size, 0);
    use({
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    });
    assert.doesNotThrow(() => rememberSignedIn(true));
    assert.doesNotThrow(() => rememberSignedIn(false));
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

// startup.js runs as a classic script before the bundle. With no #root the
// splash half returns at once, which leaves the early reads to observe.
const startup = readFileSync(new URL('../public/startup.js', import.meta.url), 'utf8').replace(/^﻿/, '');
const stored = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
};
function start({signedIn = false, desktop = false, pathname = '/', storage, files, offline = false} = {}) {
  const requests = [],
    links = [];
  const window = {
    document: {
      getElementById: () => null,
      documentElement: {hasAttribute: name => desktop && name === 'data-voltra-desktop'},
      querySelector: selector => (files && selector === 'meta[name="voltra-first-page"]' ? {content: files} : null),
      createElement: tag => ({tag}),
      head: {append: link => links.push(link)},
    },
    localStorage: storage ?? stored(signedIn ? {'voltra.signed-in': '1'} : {}),
    location: {pathname},
    performance: {now: () => 5},
    fetch: (path, options) => {
      if (offline) throw new Error('no network stack');
      requests.push({path, options});
      return path.endsWith('/settings') ? Promise.reject(new Error('offline')) : Promise.resolve(answer(200));
    },
    Map,
    Promise,
    AbortController,
    Date,
    Math,
    Error,
  };
  window.window = window;
  vm.runInNewContext(startup, window);
  return {requests, links, boot: window.__voltraBoot};
}

test('before sign-in only the session and setup state are requested', () => {
  const {requests, boot} = start();
  assert.deepEqual(
    requests.map(r => r.path),
    ['/api/setup/status', '/api/auth/session']
  );
  assert.ok(requests.every(r => r.options.cache === 'no-store' && r.options.headers.Accept === 'application/json'));
  assert.equal(boot.at, 5);
  assert.equal(
    start({storage: {getItem: key => (key === 'voltra.snapshot-session' ? 'r7' : null)}}).boot.revision,
    'r7',
    'the session revision is noted as the reads begin'
  );
  // A browser that has never held a revision is given one, so that there is
  // something for a later sign-in or sign-out to move.
  const first = stored();
  const fresh = start({storage: first});
  assert.ok(typeof fresh.boot.revision === 'string' && fresh.boot.revision.length > 8);
  assert.equal(first.values.get('voltra.snapshot-session'), fresh.boot.revision);
  assert.deepEqual(
    fresh.requests.map(r => r.path),
    ['/api/setup/status', '/api/auth/session']
  );
  assert.ok(requests.every(r => !r.options.signal.aborted));
  boot.cancel();
  assert.ok(
    requests.every(r => r.options.signal.aborted),
    'one switch abandons every read'
  );
  // With storage blocked there is no way to learn that another tab signed
  // out, so nothing that depends on who is signed in is asked for early.
  const blocked = start({
    storage: {
      getItem() {
        throw new Error('blocked');
      },
    },
  });
  assert.deepEqual(
    blocked.requests.map(r => r.path),
    ['/api/setup/status']
  );
  assert.equal(blocked.boot.revision, undefined);
  // The same when the signed-in note can be read but the revision cannot: a
  // note with nothing to check it against starts no account reads.
  const half = start({
    storage: {
      getItem(key) {
        if (key === 'voltra.signed-in') return '1';
        throw new Error('blocked');
      },
    },
  });
  assert.deepEqual(
    half.requests.map(r => r.path),
    ['/api/setup/status']
  );
  assert.equal(half.boot.revision, undefined);
  // And when there is no revision and none can be written or kept: a full
  // store, or one that accepts a write and forgets it.
  for (const [name, storage] of Object.entries({
    full: {
      getItem: key => (key === 'voltra.signed-in' ? '1' : null),
      setItem() {
        throw new Error('quota');
      },
    },
    forgetful: {getItem: key => (key === 'voltra.signed-in' ? '1' : null), setItem() {}},
  })) {
    const unkept = start({storage});
    assert.deepEqual(
      unkept.requests.map(r => r.path),
      ['/api/setup/status'],
      name
    );
    assert.equal(unkept.boot.revision, undefined, name);
  }
});

test('a returning account has its shell and first page requested at once', async () => {
  const shell = [
    '/api/setup/status',
    '/api/auth/session',
    '/api/client/account',
    '/api/client/settings',
    '/api/client/account/server-navigation',
    '/api/client/artwork/catalog',
  ];
  const overview = '/api/client?summary=overview&per_page=100';
  const {requests, boot} = start({signedIn: true});
  assert.deepEqual(
    requests.map(r => r.path),
    [...shell, overview]
  );
  assert.equal(requests[2].options.cache, 'default');
  assert.deepEqual(
    start({signedIn: true, pathname: '/server/abc'}).requests.map(r => r.path),
    shell
  );
  // The desktop host reads all of it itself, as its process starts. Reads
  // started by the page as well would only wait on the host, six at a time,
  // which is every connection the WebView has for the window's own buttons.
  const desktop = start({signedIn: true, desktop: true, files: '/assets/Client-a1.js'});
  assert.deepEqual(desktop.requests, [], 'the desktop page starts no reads of its own');
  assert.equal(desktop.boot, undefined, 'so the app asks the host for each as usual');
  assert.equal(desktop.links.length, 1, 'the first page is still fetched beside the entry');
  assert.equal((await boot.take('/api/client/account')).status, 200);
  assert.equal(boot.take('/api/client/account'), undefined);
  assert.equal(await boot.take('/api/client/settings'), undefined, 'a failed read resolves to nothing');
});

test('the first page listed by the build is fetched beside the entry, except under admin', () => {
  const files = '/assets/Client-a1.js /assets/Client-b2.css /assets/Overview-c3.js';
  const {links} = start({files});
  assert.deepEqual(
    links.map(link => [link.tag, link.rel, link.as, link.crossOrigin, link.href]),
    [
      ['link', 'modulepreload', undefined, '', '/assets/Client-a1.js'],
      ['link', 'preload', 'style', '', '/assets/Client-b2.css'],
      ['link', 'modulepreload', undefined, '', '/assets/Overview-c3.js'],
    ]
  );
  assert.equal(start({files, pathname: '/server/abc'}).links.length, 3, 'every client page needs the client module');
  for (const pathname of ['/admin', '/admin/nodes']) assert.equal(start({files, pathname}).links.length, 0, pathname);
  assert.equal(start({files, pathname: '/administrators'}).links.length, 3, 'only the admin section is excluded');
  assert.equal(start().links.length, 0, 'a build that lists nothing adds nothing');
});

test('a failure in one head start does not cost the other', () => {
  const {boot, links} = start({files: '/assets/Client-a1.js', offline: true});
  assert.equal(boot, undefined, 'the app then asks for everything itself');
  assert.equal(links.length, 1);
});

// The request helper itself, bundled the way the query cache tests bundle it.
const {build} = await import('esbuild');
const {fileURLToPath} = await import('node:url');
const apiBundle = await build({
  stdin: {
    contents:
      "export {api} from './src/lib'; export {readAccountSnapshot,writeAccountSnapshot,clearAccountSnapshots,setSnapshotLocks,setSnapshotStore,snapshotOwner} from './src/accountSnapshots'; export {memoryStore} from './src/features/desktop/desktopSnapshots';",
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'ui-stubs',
      setup(b) {
        b.onResolve({filter: /notifications$|components\/ui\/card|\.\/ui\/Select|\.\/ui\/Modal/}, () => ({
          path: 'ui',
          namespace: 'stub',
        }));
        b.onLoad({filter: /.*/, namespace: 'stub'}, () => ({
          contents:
            'export const Feedback=()=>null;export const Card=()=>null;export const Select=()=>null;export const Modal=()=>null;',
        }));
      },
    },
  ],
});
const app = await import(
  `data:text/javascript;base64,${Buffer.from(apiBundle.outputFiles[0].text).toString('base64')}`
);
// A browser with Web Locks, and no other tab holding the lock.
app.setSnapshotLocks({
  request: (name, change) => {
    change();
    return Promise.resolve();
  },
});
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

test('requests use an early answer once, and a write ends the head start', async () => {
  const values = new Map();
  const storage = {
    get length() {
      return values.size;
    },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true, writable: true});
  const oldFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (path, options) => {
    fetched.push(`${options?.method || 'GET'} ${path}`);
    return json({attributes: {name: 'live'}});
  };
  try {
    values.set('voltra.snapshot-session', noted);
    install({
      '/api/client/account': Promise.resolve(json({attributes: {uuid: 'account-a', name: 'early'}})),
      '/api/client/settings': Promise.resolve(json({attributes: {name: 'early'}})),
      '/api/auth/session': Promise.resolve(json({}, 401)),
    });
    assert.equal((await app.api('/api/client/account')).attributes.name, 'early');
    assert.deepEqual(fetched, [], 'the early answer replaced the request');
    assert.equal(values.get('voltra.signed-in'), '1', 'the next start may ask for account reads early');
    app.writeAccountSnapshot('navigation', [{uuid: 's1'}], app.snapshotOwner());
    assert.ok(values.has('voltra.snapshot.v1.navigation.account-a'), 'the account read names whose copies are kept');

    assert.equal((await app.api('/api/client/account')).attributes.name, 'live');
    assert.equal((await app.api('/api/auth/session')).attributes.name, 'live');
    assert.deepEqual(
      fetched,
      ['GET /api/client/account', 'GET /api/auth/session'],
      'a refused early answer is asked again'
    );

    // Signing in starts from nothing, whatever an earlier session left behind,
    // and tells other tabs, which may be holding answers asked for before it.
    const beforeSignIn = values.get('voltra.snapshot-session');
    await app.api('/api/auth/login', {method: 'POST', body: '{}'});
    assert.notEqual(values.get('voltra.snapshot-session'), beforeSignIn, 'a sign-in moves the session revision');
    assert.equal(
      values.has('voltra.snapshot.v1.navigation.account-a'),
      false,
      'a sign-in removes the copies of whoever was here before'
    );
    assert.equal(app.readAccountSnapshot('navigation'), undefined);

    await app.api('/api/client/servers/one/power', {method: 'POST', body: '{}'});
    assert.equal(
      (await app.api('/api/client/settings')).attributes.name,
      'live',
      'an answer fetched before a write is not used after it'
    );
    assert.equal(globalThis.__voltraBoot, undefined);
  } finally {
    app.clearAccountSnapshots();
    discardBootReads();
    globalThis.fetch = oldFetch;
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test("an early account answer identifies the account in a store that is this page's own", async () => {
  // startup.js noted the revision in the browser's storage; the saved pages
  // live elsewhere, in a store only this page uses, and have never named anyone.
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: key => (key === 'voltra.snapshot-session' ? 'webview-revision' : null),
      setItem() {},
      removeItem() {},
    },
    configurable: true,
    writable: true,
  });
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('the early answer must be used');
  };
  const entries = {};
  app.setSnapshotStore(app.memoryStore({}, values => Object.assign(entries, values)));
  try {
    install({'/api/client/account': Promise.resolve(json({attributes: {uuid: 'desktop-account'}}))}).revision =
      'webview-revision';
    await app.api('/api/client/account');
    assert.notEqual(app.snapshotOwner(), undefined, "the account is identified under the store's own revision");
    app.writeAccountSnapshot('navigation', [{uuid: 's1'}], app.snapshotOwner());
    assert.ok(entries['voltra.snapshot.v1.navigation.desktop-account']);
  } finally {
    app.clearAccountSnapshots();
    app.setSnapshotStore(null);
    discardBootReads();
    globalThis.fetch = oldFetch;
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
