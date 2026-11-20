import test from 'node:test';
import assert from 'node:assert/strict';
import {loadServerSocket} from './serverSocketModule.mjs';

function harness({fail = 0} = {}) {
  const sockets = [],
    timers = new Map(),
    requests = [],
    window = new EventTarget();
  let next = 0,
    failures = fail,
    token = 0;
  class Socket {
    sent = [];
    closed = false;
    constructor(url) {
      this.url = String(url);
      sockets.push(this);
    }
    send(raw) {
      this.sent.push(JSON.parse(raw));
    }
    close() {
      this.closed = true;
      this.onclose?.();
    }
    emit(event, ...args) {
      this.onmessage({data: JSON.stringify({event, args})});
    }
  }
  const api = async path => {
    requests.push(path);
    if (failures > 0) {
      failures--;
      throw new Error('Node offline');
    }
    return {attributes: {socket: 'https://node.test/api/servers/x/ws', token: `token-${++token}`}};
  };
  const setTimeout = (fn, delay) => {
      const id = ++next;
      timers.set(id, {fn, delay});
      return id;
    },
    clearTimeout = id => timers.delete(id);
  const m = loadServerSocket({
    api,
    window,
    WebSocket: Socket,
    location: {href: 'https://panel.test/server/x'},
    setTimeout,
    clearTimeout,
  });
  const tick = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  const run = async delay => {
    for (const [id, timer] of [...timers])
      if (delay === undefined || timer.delay === delay) {
        timers.delete(id);
        timer.fn();
      }
    await tick();
  };
  const sent = (socket, event) => socket.sent.filter(m => m.event === event);
  return {
    m,
    sockets,
    timers,
    requests,
    window,
    tick,
    run,
    sent,
    failNext: n => {
      failures = n;
    },
  };
}
const listener = (extra = {}) => {
  const log = {states: [], messages: [], ready: 0, closed: 0};
  const base = {
    state: (c, e) => log.states.push([c, e]),
    message: m => log.messages.push(m.event),
    ready: () => log.ready++,
    closed: () => log.closed++,
  };
  // Keep getters live, as the console's showsOutput is.
  return {log, listener: Object.defineProperties(base, Object.getOwnPropertyDescriptors(extra))};
};

test('the console and transfer tracking share one connection and one credential fetch', async () => {
  const h = harness();
  const a = h.m.acquireServerSocket('/api/client/servers/x'),
    b = h.m.acquireServerSocket('/api/client/servers/x');
  assert.equal(a.socket, b.socket);
  const one = listener(),
    two = listener();
  a.socket.subscribe(one.listener);
  b.socket.subscribe(two.listener);
  await h.tick();
  assert.equal(h.sockets.length, 1);
  assert.equal(h.requests.length, 1);
  assert.equal(h.sockets[0].url, 'wss://node.test/api/servers/x/ws');
  h.sockets[0].onopen();
  assert.deepEqual(h.sockets[0].sent[0], {event: 'auth', args: ['token-1']});
  h.sockets[0].emit('auth success');
  h.sockets[0].emit('console output', 'hello');
  assert.equal(one.log.ready, 1);
  assert.equal(two.log.ready, 1);
  assert.deepEqual(one.log.messages, ['auth success', 'console output']);
  assert.deepEqual(two.log.messages, one.log.messages);
  assert.deepEqual(one.log.states.at(-1), ['connected', '']);
  // A late subscriber learns the current state at once.
  const late = listener();
  a.socket.subscribe(late.listener);
  assert.equal(late.log.ready, 1);
  assert.deepEqual(late.log.states[0], ['connected', '']);
  // Releasing one holder keeps the socket; the last one closes it after a short linger.
  a.release();
  await h.run(h.m.SOCKET_LINGER_MS);
  assert.equal(h.sockets[0].closed, false);
  b.release();
  assert.equal(h.sockets[0].closed, false);
  const again = h.m.acquireServerSocket('/api/client/servers/x');
  assert.equal(again.socket, a.socket);
  again.release();
  await h.run(h.m.SOCKET_LINGER_MS);
  assert.equal(h.sockets[0].closed, true);
  const fresh = h.m.acquireServerSocket('/api/client/servers/x');
  assert.notEqual(fresh.socket, a.socket);
  fresh.release();
  await h.run();
});

test('a session change closes pooled sockets, lingering ones included', async () => {
  for (const event of ['panel-session-identity-changed', 'panel-auth-changed']) {
    const h = harness();
    const held = h.m.acquireServerSocket('/api/client/servers/x');
    held.socket.subscribe(listener().listener);
    await h.tick();
    h.sockets[0].onopen();
    h.sockets[0].emit('auth success');
    // The page unmounts: the socket lingers, still authenticated.
    held.release();
    assert.equal(h.sockets[0].closed, false);
    // Another tab merely acting keeps it: the page waits, mounted, for the session check.
    h.window.dispatchEvent(new Event('panel-session-elsewhere'));
    assert.equal(h.sockets[0].closed, false);
    h.window.dispatchEvent(new Event(event));
    assert.equal(h.sockets[0].closed, true, `${event} closes the lingering socket`);
    // The next page, for whoever is signed in now, gets its own connection.
    const next = h.m.acquireServerSocket('/api/client/servers/x');
    assert.notEqual(next.socket, held.socket);
    next.release();
    await h.run();
  }
});

test('token refresh re-authenticates the same connection; a failed refresh of an expired token reconnects', async () => {
  const h = harness();
  const s = h.m.createServerSocket('/s');
  const l = listener();
  s.subscribe(l.listener);
  await h.tick();
  const socket = h.sockets[0];
  socket.onopen();
  socket.emit('auth success');
  socket.emit('token expiring');
  await h.tick();
  assert.deepEqual(
    h.sent(socket, 'auth').map(m => m.args[0]),
    ['token-1', 'token-2']
  );
  socket.emit('auth success');
  assert.equal(l.log.ready, 1);
  assert.equal(h.sockets.length, 1);
  assert.equal(socket.closed, false);
  // Expiring but still valid: the error is shown and the connection stays.
  h.failNext(1);
  socket.emit('token expiring');
  await h.tick();
  assert.deepEqual(l.log.states.at(-1), ['connected', 'Node offline']);
  assert.equal(socket.closed, false);
  // Expired: start over with new credentials.
  h.failNext(1);
  socket.emit('token expired');
  await h.tick();
  assert.equal(socket.closed, true);
  assert.equal(l.log.closed, 1);
  await h.run(1000);
  assert.equal(h.sockets.length, 2);
  s.dispose();
});

test('credential failures back off, auth errors are reported and a rejected token reconnects', async () => {
  const h = harness({fail: 2});
  const s = h.m.createServerSocket('/s');
  const l = listener();
  s.subscribe(l.listener);
  await h.tick();
  assert.deepEqual(l.log.states.at(-1), ['disconnected', 'Node offline']);
  assert.deepEqual(
    [...h.timers.values()].map(t => t.delay),
    [1000]
  );
  await h.run(1000);
  assert.deepEqual(l.log.states.at(-2), ['reconnecting', 'Node offline']);
  assert.deepEqual(
    [...h.timers.values()].map(t => t.delay),
    [2000]
  );
  await h.run(2000);
  assert.equal(h.sockets.length, 1);
  const socket = h.sockets[0];
  socket.onopen();
  socket.emit('auth success');
  assert.deepEqual(l.log.states.at(-1), ['connected', '']);
  socket.emit('daemon error', 'Disk full');
  assert.deepEqual(l.log.states.at(-1), ['connected', 'Disk full']);
  socket.emit('jwt error', 'Bad token');
  assert.equal(socket.closed, true);
  assert.equal(l.log.closed, 1);
  assert.deepEqual(l.log.states.at(-1), ['disconnected', 'Bad token']);
  // A successful authentication reset the backoff.
  assert.deepEqual(
    [...h.timers.values()].map(t => t.delay),
    [1000]
  );
  await h.run(1000);
  assert.equal(h.sockets.length, 2);
  socket.emit('console output', 'stale');
  assert.equal(l.log.messages.includes('stale'), false);
  s.dispose();
});

test('a sign-in change closes the connection and nothing from it reaches listeners', async () => {
  const h = harness();
  const s = h.m.createServerSocket('/s');
  const l = listener();
  s.subscribe(l.listener);
  await h.tick();
  const old = h.sockets[0];
  old.onopen();
  old.emit('auth success');
  h.window.dispatchEvent(new Event('panel-auth-changed'));
  assert.equal(old.closed, true);
  assert.equal(l.log.closed, 1);
  assert.equal(s.authenticated, false);
  const before = l.log.messages.length;
  old.emit('console output', 'after sign-out');
  assert.equal(l.log.messages.length, before);
  await h.tick();
  assert.equal(h.sockets.length, 2);
  assert.equal(h.requests.length, 2);
  s.dispose();
});

test('log replays: the console asks for its own, recovery waits while output is shown', async () => {
  const h = harness();
  const s = h.m.createServerSocket('/s');
  let showing = true;
  const transfers = listener({ready: () => s.requestLogs('recovery')});
  const consoleView = listener({
    get showsOutput() {
      return showing;
    },
  });
  s.subscribe(transfers.listener);
  const stopConsole = s.subscribe(consoleView.listener);
  await h.tick();
  const socket = h.sockets[0];
  socket.onopen();
  socket.emit('auth success');
  assert.equal(h.sent(socket, 'send logs').length, 0);
  // Persistent history: the console no longer shows socket output, so a replay is harmless.
  showing = false;
  assert.equal(s.requestLogs('recovery'), true);
  assert.equal(h.sent(socket, 'send logs').length, 1);
  assert.equal(s.requestLogs('recovery'), false);
  assert.equal(h.sent(socket, 'send logs').length, 1);
  // A legacy console asks for the tail itself.
  assert.equal(s.requestLogs('display'), true);
  assert.equal(h.sent(socket, 'send logs').length, 2);
  // Next connection: recovery is deferred while output is shown and sent when the console leaves.
  showing = true;
  socket.close();
  await h.run(1000);
  const next = h.sockets[1];
  next.onopen();
  next.emit('auth success');
  assert.equal(h.sent(next, 'send logs').length, 0);
  stopConsole();
  assert.equal(h.sent(next, 'send logs').length, 1);
  // A console that stays but switches to saved history releases the deferred replay.
  const stayingConsole = listener({
    get showsOutput() {
      return showing;
    },
  });
  s.subscribe(stayingConsole.listener);
  next.close();
  await h.run(1000);
  const third = h.sockets[2];
  third.onopen();
  third.emit('auth success');
  assert.equal(h.sent(third, 'send logs').length, 0, 'deferred while the console shows output');
  s.outputChanged();
  assert.equal(h.sent(third, 'send logs').length, 0, 'still showing output: nothing is sent');
  showing = false;
  s.outputChanged();
  assert.equal(h.sent(third, 'send logs').length, 1, 'sent once the console switched to saved history');
  assert.equal(s.send('send stats'), true);
  s.dispose();
  assert.equal(s.send('send stats'), false);
});
