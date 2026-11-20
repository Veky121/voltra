import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {ConsoleReplayOverlap, collectorLineKey} from '../src/features/console/consoleReplay.ts';
import {emptyConsoleHistory, appendConsoleHistory, consoleHistoryText} from '../src/features/console/consoleHistory.ts';
import {ConsoleLineQueue, CONSOLE_QUEUE_FRAME_MS} from '../src/features/console/consoleQueue.ts';
import {consoleOutput} from '../src/features/console/consoleOutput.ts';
import {consoleClock, consoleStateLine} from '../src/features/console/consoleLifecycle.ts';
import {consoleRunID, consoleRunChanged} from '../src/features/console/consoleRun.ts';
import * as installProgress from '../src/features/console/installProgress.ts';
import {loadServerSocket} from './serverSocketModule.mjs';

function fixture({regular = false, server = {}} = {}) {
  const effects = [],
    timers = new Map(),
    requests = [],
    sockets = [],
    feedback = [];
  const doc = Object.assign(new EventTarget(), {hidden: false});
  let history = emptyConsoleHistory(),
    installHistory = emptyConsoleHistory(),
    safeStages = [],
    installation = installProgress.emptyInstallProgress,
    historyHook = 0,
    nextTimer = 0,
    cleanups = [],
    subscriber,
    fresh = false;
  const react = {
    useEffect: fn => effects.push(fn),
    useRef: current => ({current}),
    useState: initial => {
      let state = typeof initial === 'function' ? initial() : initial;
      const historyIndex = initial === emptyConsoleHistory ? historyHook++ : -1;
      return [
        state,
        update => {
          state = typeof update === 'function' ? update(state) : update;
          if (historyIndex === 0) history = state;
          if (historyIndex === 1) installHistory = state;
          if (initial === installProgress.emptyInstallProgress) installation = state;
          if (state?.stages && typeof state.phase === 'string') safeStages = state.stages;
        },
      ];
    },
  };
  class Socket {
    sent = [];
    constructor() {
      sockets.push(this);
    }
    send(text) {
      this.sent.push(JSON.parse(text));
    }
    close() {}
    emit(event, line) {
      this.onmessage({data: JSON.stringify({event, args: [line]})});
    }
  }
  const api = path => new Promise((resolve, reject) => requests.push({path, resolve, reject}));
  const Feedback = () => null;
  const create = (type, props) => {
    if (type === Feedback) feedback.push(props);
    return null;
  };
  const modules = {
    react,
    '../../hooks/liveEvents': {
      observeLivePath: (_path, fn) => {
        subscriber = fn;
        return () => {
          subscriber = undefined;
        };
      },
      isLivePathFresh: () => fresh,
    },
    'react/jsx-runtime': {jsx: create, jsxs: create},
    '../../notifications': {Feedback},
    '../../lib': {
      api,
      useAPI: () => ({data: {root_admin: !regular}}),
      unwrap: data => data,
    },
    '../servers/ServerDashboard': {useServerTelemetry: () => ({state: 'unknown'})},
    './consoleHistory': {emptyConsoleHistory, appendConsoleHistory},
    './consoleQueue': {ConsoleLineQueue, CONSOLE_QUEUE_FRAME_MS},
    './consoleReplay': {ConsoleReplayOverlap},
    './consoleOutput': {consoleOutput},
    './consoleLifecycle': {consoleClock, consoleStateLine},
    './installProgress': installProgress,
    '../servers/serverPower': {consolePowerEvent: 'power'},
    '../shared/common': {
      can: (permissions, permission) => permissions.includes(permission),
      useServer: () => ({base: '/server', server, permissions: ['websocket.connect']}),
      useAction: () => ({}),
      value: r => r,
    },
  };
  const code = ts.transpileModule(
    readFileSync(new URL('../src/features/console/Console.tsx', import.meta.url), 'utf8'),
    {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}
  ).outputText;
  modules['./consoleRun'] = {consoleRunID, consoleRunChanged};
  const exports = {},
    win = {matchMedia: () => ({matches: true}), addEventListener() {}, removeEventListener() {}};
  const setTimer = (fn, delay) => {
      const id = ++nextTimer;
      timers.set(id, {fn, delay});
      return id;
    },
    clearTimer = id => timers.delete(id);
  modules['../servers/serverSocket'] = loadServerSocket({
    api,
    window: win,
    WebSocket: Socket,
    location: {href: 'http://localhost'},
    setTimeout: setTimer,
    clearTimeout: clearTimer,
  });
  new Function('require', 'exports', 'window', 'document', 'WebSocket', 'location', 'setTimeout', 'clearTimeout', code)(
    name => modules[name] ?? {},
    exports,
    win,
    doc,
    Socket,
    {href: 'http://localhost'},
    setTimer,
    clearTimer
  );
  exports.default();
  for (const effect of effects) {
    const result = effect();
    if (result) cleanups.push(result);
  }
  // The shared socket fetches its credentials through a couple more promise steps.
  const tick = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  const run = async delay => {
    for (const [id, timer] of [...timers])
      if (timer.delay === delay) {
        timers.delete(id);
        timer.fn();
      }
    await tick();
  };
  const respond = async data => {
    const request = requests.find(r => r.path.includes('console-history'));
    assert.ok(request);
    requests.splice(requests.indexOf(request), 1);
    const start = BigInt(data.cursor) - BigInt(data.data?.length ?? 0) + 1n;
    request.resolve({
      ...data,
      data: data.data?.map((entry, i) => ({id: String(start + BigInt(i)), ...entry})),
    });
    await tick();
    await run(0);
  };
  return {
    requests,
    sockets,
    run,
    respond,
    tick,
    visibility: hidden => {
      doc.hidden = hidden;
      doc.dispatchEvent(new Event('visibilitychange'));
    },
    setFresh: value => {
      fresh = value;
    },
    emit: data => subscriber?.({status: 200, data}),
    text: () => consoleHistoryText(history),
    installText: () => consoleHistoryText(installHistory),
    installation: () => installation,
    safeStages: () => safeStages,
    feedback,
    cleanup: () => cleanups.forEach(fn => fn()),
  };
}
const entry = line => ({event: 'console output', line});

test('install progress redraws stay in the full log and survive gameplay history rotation', async () => {
  const f = fixture();
  try {
    const redraws = '### 20.0%\r###### 60.0%\r########## 100.0%';
    await f.respond({
      run_start: '0',
      cursor: '603',
      capture: {connected: true},
      data: [
        {event: 'install output', line: 'Downloading server'},
        {event: 'install output', line: redraws},
        {event: 'install output', line: 'Extracting archive'},
      ],
    });
    assert.doesNotMatch(f.text(), /\d+\.0%/);
    assert.equal(f.installText(), `Downloading server\n${redraws.replaceAll('\r', '\n')}\nExtracting archive`);
    assert.deepEqual(
      f.installation().stages.map(stage => stage.id),
      ['download', 'extract']
    );
    await f.run(1000);
    await f.respond({run_start: '604', cursor: '605', capture: {connected: true}, data: [entry('New startup')]});
    await f.run(10);
    await f.respond({
      run_start: '604',
      cursor: '605',
      capture: {connected: true},
      data: [
        {id: '603', event: 'install output', line: 'Extracting archive'},
        {
          id: '604',
          event: 'panel message',
          line: '[Voltra]: Server is starting. Preparing the container and launching the process.',
        },
        entry('New startup'),
      ],
    });
    assert.equal(f.installation().runtime, 'starting');
    assert.equal(f.installText().split('Extracting archive').length - 1, 1);
    assert.match(f.installText(), /### 20.0%/);
    assert.match(f.text(), /New startup/);
  } finally {
    f.cleanup();
  }
});

test('saved retry boundaries replace the full log and keep installer lines out of the live console', async () => {
  const f = fixture();
  try {
    await f.respond({
      cursor: '2',
      capture: {connected: true},
      data: [
        {event: 'install output', line: 'Downloading server'},
        {event: 'install output', line: 'Installation failed: previous diagnostic'},
      ],
    });
    assert.equal(f.installation().outcome, 'failed');
    await f.run(1000);
    await f.respond({
      cursor: '5',
      capture: {connected: true},
      data: [
        {event: 'panel message', line: installProgress.installAttemptBoundary},
        {event: 'install output', line: '### 37%'},
        {event: 'install output', line: 'Current diagnostic'},
      ],
    });
    assert.equal(f.installation().outcome, undefined);
    assert.equal(f.installation().stages[0].progress.value, 37);
    assert.equal(f.installText(), '### 37%\nCurrent diagnostic');
    assert.doesNotMatch(f.text(), /diagnostic|Installer attempt started/);
  } finally {
    f.cleanup();
  }
});

test('installation failure sends role-appropriate recovery guidance to the island', () => {
  for (const regular of [false, true]) {
    const f = fixture({regular, server: {status: 'install_failed'}});
    try {
      const message = f.feedback.find(event => event.title === 'Installation failed');
      assert.equal(message.tone, 'error');
      assert.match(message.message, regular ? /Ask your server administrator/ : /Review the full install log/);
    } finally {
      f.cleanup();
    }
  }
});

test('regular console access replays and polls the safe install feed', async () => {
  const f = fixture({regular: true, server: {status: 'installing'}});
  try {
    const path = '/server/install-progress';
    const response = value => ({
      stages: [{id: 'download', label: 'Downloading server', state: 'running', progress: {value}}],
    });
    const first = f.requests.find(request => request.path === path);
    first.resolve(response(29));
    await f.tick();
    assert.equal(f.safeStages()[0].progress.value, 29);
    await f.run(1000);
    const next = f.requests.filter(request => request.path === path).at(-1);
    assert.notEqual(next, first);
    next.resolve(response(37));
    await f.tick();
    assert.equal(f.safeStages()[0].progress.value, 37);
  } finally {
    f.cleanup();
  }
});

test('deferred recovery includes disconnected output, suppresses live copies, resumes saved cursor', async () => {
  const f = fixture();
  try {
    const ws = f.requests.find(r => r.path.endsWith('/websocket'));
    ws.resolve({socket: 'ws://localhost', token: 'test'});
    await f.tick();
    const socket = f.sockets[0];
    socket.emit('auth success');
    await f.respond({cursor: '10', capture: {connected: true}, data: [entry('saved')]});
    await f.run(1000);
    const failure = f.requests.find(r => r.path.includes('console-history'));
    failure.reject(new Error('unavailable'));
    f.requests.splice(f.requests.indexOf(failure), 1);
    await f.tick();
    socket.emit('console output', '\x1b[31mlive\x1b[0m');
    socket.emit('console output', 'repeat');
    socket.emit('console output', 'repeat');
    await f.run(0);
    socket.onclose();
    await f.run(3000);
    assert.ok(f.requests.some(r => r.path.endsWith('after=10')));
    await f.respond({
      cursor: '15',
      capture: {connected: true},
      more: true,
      data: [
        entry('\x1b[31mlive\x1b[0m'),
        entry('repeat'),
        entry('repeat'),
        entry('during disconnect'),
        {event: 'panel message', line: 'state saved'},
      ],
    });
    assert.equal(f.text().split('live').length - 1, 1);
    assert.equal(f.text().split('repeat').length - 1, 2);
    assert.match(f.text(), /during disconnect/);
    assert.match(f.text(), /state saved/);
    assert.match(f.text(), /\x1b\[31m/);
    await f.run(10);
    assert.ok(f.requests.some(r => r.path.endsWith('after=15')));
    socket.emit('console output', 'persistent copy');
    await f.run(0);
    assert.doesNotMatch(f.text(), /persistent copy/);
    await f.respond({cursor: '16', capture: {connected: true}, data: [entry('persistent copy')]});
    assert.match(f.text(), /persistent copy/);
    assert.equal(socket.sent.filter(x => x.event === 'send logs').length, 0);
  } finally {
    f.cleanup();
  }
});

test('reset clears provisional overlap and output; truncation is reported', async () => {
  const f = fixture();
  try {
    await f.respond({cursor: '9', capture: {connected: false}, data: [entry('old')]});
    await f.run(1000);
    await f.respond({reset: true, truncated: true, cursor: '2', capture: {connected: true}, data: [entry('new')]});
    assert.doesNotMatch(f.text(), /old/);
    assert.match(f.text(), /new/);
    assert.match(f.text(), /Older output expired/);
  } finally {
    f.cleanup();
  }
});

test('overlap uses event and exact ANSI, preserves repeated occurrence counts, and bounds retention', () => {
  const h = new ConsoleReplayOverlap(2, 1000);
  h.record('console output', 'same');
  h.record('console output', 'same');
  assert.equal(h.consume('daemon message', 'same'), false);
  assert.equal(h.consume('console output', 'same'), true);
  h.record('console output', 'next');
  h.record('console output', 'last');
  assert.equal(h.consume('console output', 'same'), false);
  assert.equal(h.consume('console output', 'next'), true);
  h.record('console output', '\x1b[31mred');
  assert.equal(h.consume('console output', 'red'), false);
  h.clear();
  assert.equal(h.consume('console output', 'last'), false);
  const small = new ConsoleReplayOverlap(100, 10);
  small.record('console output', 'too long');
  assert.equal(small.consume('console output', 'too long'), false);
});

test('initial failure and deferred collector pages reconcile arrivals while a request is pending', async () => {
  const f = fixture();
  try {
    const ws = f.requests.find(r => r.path.endsWith('/websocket'));
    ws.resolve({socket: 'ws://localhost', token: 'test'});
    await f.tick();
    const socket = f.sockets[0];
    socket.emit('auth success');
    const failure = f.requests.find(r => r.path.includes('console-history'));
    failure.reject(new Error('temporary'));
    f.requests.splice(f.requests.indexOf(failure), 1);
    await f.tick();
    socket.emit('console output', 'first');
    await f.run(0);
    await f.run(3000);
    socket.emit('console output', 'arrived during request');
    await f.run(0);
    await f.respond({cursor: '1', more: true, capture: {connected: false}, data: [entry('first')]});
    await f.run(10);
    await f.respond({
      cursor: '2',
      capture: {connected: true},
      data: [entry('arrived during request'), entry('missed by socket')],
    });
    assert.equal(f.text().split('first').length - 1, 1);
    assert.equal(f.text().split('arrived during request').length - 1, 1);
    assert.match(f.text(), /missed by socket/);
  } finally {
    f.cleanup();
  }
});

test('legacy 404 still requests the Wings tail and displays state events', async () => {
  const f = fixture();
  try {
    const ws = f.requests.find(r => r.path.endsWith('/websocket'));
    ws.resolve({socket: 'ws://localhost', token: 'test'});
    await f.tick();
    const socket = f.sockets[0];
    socket.emit('auth success');
    const failure = f.requests.find(r => r.path.includes('console-history'));
    failure.reject(new Error('404 page not found'));
    await f.tick();
    assert.equal(socket.sent.filter(x => x.event === 'send logs').length, 1);
    socket.emit('status', 'running');
    socket.emit('console output', 'legacy line');
    await f.run(0);
    assert.match(f.text(), /Current server state: running/);
    assert.match(f.text(), /legacy line/);
  } finally {
    f.cleanup();
  }
});

test('saved-first fallback output consumes its delayed socket occurrence', async () => {
  const f = fixture();
  try {
    f.requests.find(r => r.path.endsWith('/websocket')).resolve({socket: 'ws://localhost', token: 'test'});
    await f.tick();
    f.sockets[0].emit('auth success');
    await f.respond({cursor: '1', capture: {connected: false}, data: [entry('saved first')]});
    f.sockets[0].emit('console output', 'saved first');
    await f.run(0);
    assert.equal(f.text().split('saved first').length - 1, 1);
  } finally {
    f.cleanup();
  }
});
test('overlap matches collector byte truncation at multibyte boundaries', () => {
  const live = 'x'.repeat(16383) + '\u{1f30d}'.repeat(20);
  const saved = 'x'.repeat(16383) + ' [line truncated by Voltra]';
  assert.equal(collectorLineKey(live), saved);
  assert.equal(collectorLineKey(saved), saved);
  const h = new ConsoleReplayOverlap();
  h.record('console output', live);
  assert.equal(h.consume('console output', saved), true);
  h.record('console output', saved);
  assert.equal(h.consume('console output', live), true);
});

test('healthy saved-log socket suppresses HTTP polling and deduplicates overlapping IDs', async () => {
  const f = fixture();
  try {
    await f.respond({cursor: '10', capture: {connected: true}, data: [{...entry('initial'), id: '10'}]});
    f.setFresh(true);
    for (let i = 0; i < 60; i++) await f.run(1000);
    assert.equal(f.requests.filter(r => r.path.includes('console-history')).length, 0);
    f.emit({
      after: '10',
      head: '13',
      cursor: '13',
      capture: {connected: true},
      data: [
        {...entry('same'), id: '12'},
        {...entry('same'), id: '13'},
      ],
    });
    await f.run(0);
    f.emit({
      after: '10',
      head: '13',
      cursor: '13',
      capture: {connected: true},
      data: [
        {...entry('same'), id: '12'},
        {...entry('same'), id: '13'},
      ],
    });
    await f.run(0);
    assert.equal(f.text().split('same').length - 1, 2);
    f.setFresh(false);
    await f.run(1000);
    assert.ok(f.requests.some(r => r.path.endsWith('after=13')));
  } finally {
    f.cleanup();
  }
});

test('missed socket batches recover through HTTP and drain pages while socket stays fresh', async () => {
  const f = fixture();
  try {
    await f.respond({cursor: '10', capture: {connected: true}, data: [entry('initial')]});
    f.setFresh(true);
    f.emit({after: '15', head: '20', cursor: '20', capture: {connected: true}, data: []});
    assert.ok(f.requests.some(r => r.path.endsWith('after=10')));
    await f.respond({cursor: '16', more: true, capture: {connected: true}, data: [entry('recovered')]});
    await f.run(10);
    assert.ok(f.requests.some(r => r.path.endsWith('after=16')));
    await f.respond({cursor: '20', capture: {connected: true}, data: [entry('last page')]});
    assert.match(f.text(), /recovered/);
    assert.match(f.text(), /last page/);
    f.emit({after: '2', head: '2', cursor: '2', capture: {connected: true}, data: []});
    assert.ok(f.requests.some(r => r.path.endsWith('after=20')));
    await f.respond({reset: true, cursor: '2', capture: {connected: true}, data: [entry('new history')]});
    assert.doesNotMatch(f.text(), /initial/);
    assert.match(f.text(), /new history/);
  } finally {
    f.cleanup();
  }
});

test('hidden console pauses HTTP fallback and recovers on return', async () => {
  const f = fixture();
  try {
    await f.respond({cursor: '10', capture: {connected: true}, data: []});
    f.visibility(true);
    for (let i = 0; i < 60; i++) await f.run(1000);
    assert.equal(f.requests.filter(r => r.path.includes('console-history')).length, 0);
    f.visibility(false);
    assert.ok(f.requests.some(r => r.path.endsWith('after=10')));
  } finally {
    f.cleanup();
  }
});

test('new run reloads the retained tail for an already connected console', async () => {
  const f = fixture();
  try {
    await f.respond({
      run_start: '0',
      cursor: '600',
      capture: {connected: true},
      data: [entry('old unwanted output'), entry('final crash diagnostic')],
    });
    f.setFresh(true);
    f.emit({
      run_start: '601',
      after: '600',
      head: '603',
      cursor: '603',
      capture: {connected: true},
      data: [
        {id: '601', event: 'panel message', line: 'New run.'},
        {id: '603', ...entry('fresh startup')},
      ],
    });
    await f.tick();
    assert.ok(f.requests.some(r => r.path.endsWith('console-history?after=0')));
    await f.respond({
      run_start: '601',
      cursor: '603',
      capture: {connected: true},
      data: [entry('final crash diagnostic'), {event: 'panel message', line: 'New run.'}, entry('fresh startup')],
    });
    assert.doesNotMatch(f.text(), /old unwanted/);
    assert.match(f.text(), /final crash diagnostic/);
    assert.match(f.text(), /fresh startup/);
    assert.equal(f.text().split('New run.').length - 1, 1);
    await f.run(1000);
    assert.equal(f.requests.filter(r => r.path.includes('console-history')).length, 0);
  } finally {
    f.cleanup();
  }
});

test('HTTP fallback detects a new run without a socket and reloads once', async () => {
  const f = fixture();
  try {
    await f.respond({run_start: '10', cursor: '50', capture: {connected: true}, data: [entry('old unwanted')]});
    await f.run(1000);
    await f.respond({run_start: '51', cursor: '52', capture: {connected: true}, data: [entry('fresh startup')]});
    await f.run(10);
    assert.ok(f.requests.some(r => r.path.endsWith('console-history?after=0')));
    await f.respond({
      run_start: '51',
      cursor: '52',
      capture: {connected: true},
      data: [entry('previous tail'), entry('fresh startup')],
    });
    assert.equal(f.text(), 'previous tail\nfresh startup');
    await f.run(1000);
    assert.ok(f.requests.some(r => r.path.endsWith('console-history?after=52')));
  } finally {
    f.cleanup();
  }
});

test('saved history hides internal markers, keeps game output and stamps panel lines with the console clock', async () => {
  const f = fixture();
  try {
    const at = new Date(2026, 10, 19, 7, 8, 9);
    await f.respond({
      cursor: '4',
      capture: {connected: true},
      data: [
        entry('container@pterodactyl~ java -jar server.jar --rcon-password=secret'),
        entry('Loading world'),
        entry('VOLTRA_ARK_READY'),
        {
          event: 'panel message',
          line: '\x1b[0m\x1b[94m[Voltra]: Console history capture connected. Saved history is retained; continuity during panel downtime cannot be verified.\x1b[0m',
          created_at: at.toISOString(),
        },
        {
          event: 'panel message',
          line: '\x1b[0m\x1b[92m[Voltra]: Server entered the running state.\x1b[0m',
          created_at: at.toISOString(),
        },
      ],
    });
    const text = f.text();
    assert.doesNotMatch(text, /container@|secret|VOLTRA_ARK_READY|capture connected/);
    assert.match(text, /Loading world/);
    assert.ok(text.includes(`[${consoleClock(at)}] \x1b[0m\x1b[92m[Voltra]: Server entered the running state.`), text);
  } finally {
    f.cleanup();
  }
});
