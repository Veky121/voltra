import assert from 'node:assert/strict';
import test from 'node:test';
import * as react from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadModule} from './loadModule.mjs';
import * as progress from '../src/ui/terminalProgressModel.ts';
import * as history from '../src/features/console/consoleHistory.ts';
import * as viewport from '../src/features/console/consoleViewport.ts';
import * as output from '../src/features/console/consoleOutput.ts';
import * as install from '../src/features/console/installProgress.ts';
import * as transfers from '../src/features/servers/remoteTransferModel.ts';
import * as operations from '../src/features/servers/operationEvents.ts';

const {createElement: el} = react;
const url = path => new URL(`../src/${path}`, import.meta.url);
const render = (Component, props) => renderToStaticMarkup(el(Component, props));
const nil = () => null;
const children = props => props.children;
const can = (permissions, permission) => permissions.includes(permission);
const button = ({variant: _variant, size: _size, ...props}) => el('button', props);
const terminalProgress = loadModule(url('ui/TerminalProgress.tsx'), {'./terminalProgressModel': progress});

function terminalFixture({reducedMotion = false, overlayFocused = false} = {}) {
  const buttons = new Map();
  let copied, downloaded, saved, copyAction;
  const Button = props => {
    buttons.set(
      props['aria-label'] ||
        react.Children.toArray(props.children)
          .filter(child => typeof child === 'string')
          .join(''),
      props.onClick
    );
    return button(props);
  };
  let completion, effectIndex, changed, focus;
  const activeElement = {};
  const effects = [];
  const pendingEffects = [];
  const timers = new Map();
  let now = 0;
  const globals = {
    window: {
      matchMedia: query => {
        assert.equal(query, '(prefers-reduced-motion: reduce)');
        return {matches: reducedMotion};
      },
    },
    document: {activeElement},
    setTimeout(fn, delay) {
      const timer = Symbol();
      timers.set(timer, {fn, at: now + delay});
      return timer;
    },
    clearTimeout: timer => timers.delete(timer),
  };
  const overlay = loadModule(
    url('features/console/InstallOverlay.tsx'),
    {
      react: {
        useState: () => [
          completion,
          next => {
            changed = true;
            completion = next;
          },
        ],
        useEffect: (run, deps) => {
          const index = effectIndex++;
          const old = effects[index];
          if (old && deps.every((dep, i) => Object.is(dep, old.deps[i]))) return;
          pendingEffects.push(() => {
            old?.cleanup?.();
            effects[index] = {deps, cleanup: run()};
          });
        },
      },
      '../../ui/TerminalProgress': terminalProgress,
      './installProgress': install,
    },
    globals
  );
  const {default: Terminal} = loadModule(
    url('features/console/Terminal.tsx'),
    {
      '../../ui/IconButton': {IconButton: Button},
      '../../components/ui/dropdown-menu': {
        DropdownMenu: children,
        DropdownMenuTrigger: nil,
        DropdownMenuContent: children,
        DropdownMenuItem: Button,
      },
      '../../Icons': {Icon: nil},
      '../shared/common': {
        useServer: () => ({server: {name: 'Server'}, base: '/server', permissions: ['control.console']}),
        useAction: () => ({
          run: work => (copyAction = work()),
          setSuccess: nil,
        }),
        can,
        Notice: nil,
      },
      './consoleViewport': viewport,
      './consoleOutput': output,
      './consoleHistory': history,
      './InstallOverlay': {
        InstallOverlay: overlay.InstallOverlay,
        useInstallOverlay: (scope, active, success) =>
          overlay.useInstallOverlay(
            scope,
            active,
            success,
            {current: {contains: element => overlayFocused && element === activeElement}},
            {current: {focus: options => (focus = options)}}
          ),
      },
    },
    {
      navigator: {clipboard: {writeText: async text => (copied = text)}},
      URL: {createObjectURL: blob => ((saved = blob), 'blob:test'), revokeObjectURL: nil},
      document: {
        body: {appendChild: nil},
        createElement: () => ({
          click() {
            downloaded = this.download;
          },
          remove: nil,
        }),
      },
      setTimeout: nil,
    }
  );
  const log = (...lines) => history.appendConsoleHistory(history.emptyConsoleHistory(), lines);
  const props = {
    status: 'offline',
    connection: 'Connected',
    history: log('JVM and mod loader output'),
    installHistory: log('Installer diagnostic', '#### 25%', '######## 52%'),
    installStream: log('Installer diagnostic'),
    installScope: '/server:attempt',
    installAttempt: 1,
    installSuccess: 'Installed',
    canReadInstallLog: true,
    installStages: [
      {id: 'prepare', label: 'Setting up environment', state: 'done'},
      {id: 'loader', label: 'Installing loader', state: 'done'},
      {id: 'download', label: 'Downloading server', state: 'running', progress: {value: 52}},
      {id: 'start', label: 'Starting server', state: 'waiting'},
    ],
  };
  const draw = overrides => {
    let markup;
    do {
      effectIndex = 0;
      changed = false;
      buttons.clear();
      markup = render(Terminal, {...props, ...overrides});
      for (const run of pendingEffects.splice(0)) run();
    } while (changed);
    return markup;
  };
  const advance = delay => {
    now += delay;
    for (const [timer, {fn, at}] of timers) {
      if (at > now) continue;
      timers.delete(timer);
      fn();
    }
  };
  return {
    draw,
    advance,
    log,
    props,
    focus: () => focus,
    copy: async label => {
      buttons.get(label)();
      await copyAction;
      return copied;
    },
    save: async label => {
      buttons.get(label)();
      return [downloaded, await saved.text()];
    },
  };
}

test('install stages overlay the streaming console and completed stages collapse into one row', () => {
  const f = terminalFixture();
  const markup = f.draw();
  assert.match(markup, /class="console-terminal-body"><div class="console-install" data-state="active"/);
  assert.match(markup, /role="list" aria-label="Installation stages"/);
  assert.match(markup, /2 steps done/);
  assert.doesNotMatch(markup, /Setting up environment|Installing loader/);
  assert.match(markup, /role="status">Downloading server<\/span>/);
  assert.match(markup, /role="progressbar" aria-label="Downloading server"[^>]*aria-valuenow="52"/);
  assert.match(markup, /Starting server.*Waiting/);
  const indices = [
    'console-terminal-header',
    'Installation stages',
    'Server console output',
    'Installer diagnostic',
    'JVM and mod loader output',
    'console-command-bar',
  ].map(text => markup.indexOf(text));
  assert.ok(indices.every((index, i) => index >= 0 && (i === 0 || index > indices[i - 1])));
  assert.doesNotMatch(markup, /Show full install log|Show live startup console|#### 25%/);
  const stages = f.props.installStages.map(stage =>
    stage.id === 'download' ? {...stage, progress: {value: 53}} : stage
  );
  const tick = f.draw({installStages: stages});
  assert.match(tick, /role="status">Downloading server<\/span>/);
  assert.match(tick, /aria-valuenow="53"/);
});

test('first startup streams by default and copy and save export the two logs separately', async () => {
  const f = terminalFixture();
  const markup = f.draw({
    status: 'starting',
    installStages: [{id: 'start', label: 'Starting server', state: 'running'}],
  });
  assert.match(markup, /role="progressbar" aria-label="Starting server"/);
  assert.match(markup, /JVM and mod loader output/);
  assert.equal(await f.copy('Copy console output'), 'JVM and mod loader output');
  assert.equal(await f.copy('Copy install log'), 'Installer diagnostic\n#### 25%\n######## 52%');
  assert.deepEqual(await f.save('Save console log'), ['Server-console.log', 'JVM and mod loader output']);
  assert.deepEqual(await f.save('Save install log'), [
    'Server-install.log',
    'Installer diagnostic\n#### 25%\n######## 52%',
  ]);
});

test('safe stages appear with allowed runtime output or a quiet permissions message', () => {
  const f = terminalFixture();
  const owner = {canReadInstallLog: false};
  for (const data of [owner, {...owner, history: f.log()}]) {
    const markup = f.draw(data);
    assert.match(markup, /aria-label="Downloading server"[^>]*aria-valuenow="52"/);
    assert.doesNotMatch(markup, /Installer diagnostic|Copy install log|Save install log/);
    if (data.history) {
      assert.match(markup, /Installer output is visible to administrators/);
      assert.doesNotMatch(markup, /JVM and mod loader output/);
    } else {
      assert.match(markup, /JVM and mod loader output/);
      assert.doesNotMatch(markup, /Installer output is visible to administrators/);
    }
  }
});

test('an observed successful first start waits, exits, and unmounts without stealing focus', () => {
  const f = terminalFixture();
  const success = {installStages: undefined, installSuccess: 'Server started', status: 'running'};
  assert.doesNotMatch(f.draw(success), /class="console-install"/);
  f.draw();
  assert.match(f.draw(success), /data-state="success".*Server started/);
  f.advance(999);
  assert.match(f.draw(success), /data-state="success"/);
  f.advance(1);
  assert.match(f.draw(success), /data-state="exiting"/);
  f.advance(449);
  assert.match(f.draw(success), /data-state="exiting"/);
  f.advance(1);
  const done = f.draw(success);
  assert.doesNotMatch(done, /class="console-install"/);
  assert.match(done, /JVM and mod loader output/);
  assert.equal(f.focus(), undefined);
});

test('ready-to-start success uses the reduced-motion duration and restores focus if needed', () => {
  const f = terminalFixture({reducedMotion: true, overlayFocused: true});
  f.draw();
  const installed = {installStages: undefined};
  assert.match(f.draw(installed), /data-state="success".*>Installed<\/span>/);
  f.advance(1000);
  assert.match(f.draw(installed), /data-state="exiting"/);
  f.advance(119);
  assert.match(f.draw(installed), /data-state="exiting"/);
  assert.equal(f.focus(), undefined);
  f.advance(1);
  assert.doesNotMatch(f.draw(installed), /class="console-install"/);
  assert.deepEqual(f.focus(), {preventScroll: true});
});

test('a failed stage remains visible and cancels an exit in progress', () => {
  const f = terminalFixture();
  f.draw();
  f.draw({installStages: undefined});
  f.advance(1000);
  assert.match(f.draw({installStages: undefined}), /data-state="exiting"/);
  const failed = {installStages: [{id: 'start', label: 'Starting server', state: 'failed'}]};
  assert.match(f.draw(failed), /data-state="active".*Starting server failed.*is-failed.*?/);
  f.advance(5000);
  assert.match(f.draw(failed), /data-state="active"/);
  assert.equal(f.focus(), undefined);
});

test('a failed transfer emits island feedback and shows a failed count with the dock closed', () => {
  const feedback = [];
  const {ServerTransfers} = loadModule(url('features/servers/ServerTransfers.tsx'), {
    '../../notifications': {
      Feedback: props => {
        if (props.message) feedback.push(props);
        return null;
      },
    },
    '../../lib': {Button: button},
    '../../ui/TerminalProgress': terminalProgress,
    '../shared/common': {can, useServer: () => ({server: {status: null}})},
    './useRemoteTransfers': {
      RemoteTransferContext: react.createContext(null),
      useRemoteTransferQueue: () => ({
        error: '',
        transfers: [{identifier: 'file-1', state: 'failed', error: 'Write failed', updated: Date.now()}],
        operations: [{id: 'operation-1', state: 'failed', code: 'DOWNLOAD_FAILED'}],
      }),
    },
    './remoteTransferModel': transfers,
    './operationEvents': operations,
  });
  const markup = render(ServerTransfers, {base: '/server', permissions: ['file.create']});
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /2 failed/);
  assert.doesNotMatch(markup, /pending|Write failed|class="server-transfer-list"/);
  assert.ok(feedback.some(event => event.eventKey === 'file-transfer:file-1' && event.message === 'Write failed'));
  assert.ok(feedback.some(event => event.eventKey === 'game-operation:operation-1' && event.tone === 'error'));
});

test('uploads keep a single named progress bar above the dashboard and per-file progress collapsed below', () => {
  let totalProgress = 37;
  const files = Object.fromEntries(
    Array.from({length: 12}, (_, id) => [
      id,
      {id, name: `file-${id}.zip`, progress: {uploadStarted: 1, bytesUploaded: 10, bytesTotal: 100}},
    ])
  );
  const {default: FileTransfers} = loadModule(url('features/files/FileTransfers.tsx'), {
    react: {
      ...react,
      useState: initial => react.useState(initial === null ? {} : initial === false ? true : initial),
    },
    '../servers/useRemoteTransfers': {default: () => ({start: nil})},
    '../shared/common': {can},
    '@uppy/core': {},
    '@uppy/tus': {},
    '@uppy/react/dashboard': {default: () => el('button', {id: 'upload-controls'}, 'Pause')},
    '@uppy/react': {useUppyState: (_queue, select) => select({files, totalProgress})},
    '@uppy/core/css/style.min.css': {},
    '@uppy/dashboard/css/style.min.css': {},
    '../../components/ui/button': {Button: button},
    '../../components/ui/collapsible': loadModule(url('components/ui/collapsible.tsx')),
    '../../ui/TerminalProgress': terminalProgress,
    '../../ui/terminalProgressModel': progress,
  });
  const props = {base: '/server', directory: '/', permissions: ['file.create']};
  const initial = render(FileTransfers, props);
  assert.match(initial, /aria-label="Uploading files"[^>]*aria-valuenow="37"/);
  assert.equal(initial.match(/role="progressbar"/g)?.length, 1);
  assert.ok(initial.indexOf('role="progressbar"') < initial.indexOf('id="upload-controls"'));
  assert.ok(initial.indexOf('id="upload-controls"') < initial.indexOf('Per-file progress'));
  assert.match(initial, /aria-expanded="false"[^>]*>Per-file progress<\/button>/);
  totalProgress = 55;
  assert.match(render(FileTransfers, props), /aria-label="Uploading files"[^>]*aria-valuenow="55"/);
});

test('desktop update bytes stay outside the phase announcement', () => {
  const sample = {stage: 'downloading', total: 1000, written: 370};
  const {DesktopUpdateProgress} = loadModule(url('features/desktop/DesktopUpdateControl.tsx'), {
    './desktopUpdates': {useDesktopUpdates: () => ({busy: true, operation: 'update-install', progress: sample})},
    '../../ui/TerminalProgress': terminalProgress,
    '../../ui/terminalProgressModel': {
      ...progress,
      formatBytesProgress: (written, total) => `${written} B of ${total} B`,
    },
  });
  for (const written of [370, 540]) {
    sample.written = written;
    const markup = render(DesktopUpdateProgress);
    assert.match(markup, /role="status">Downloading update<\/span>/);
    assert.match(markup, /role="progressbar" aria-label="Installing app update"/);
    assert.match(markup, new RegExp(`aria-valuenow="${written / 10}"`));
    assert.match(markup, new RegExp(`${written} B of 1000 B`));
  }
  sample.stage = 'preparing';
  const preparing = render(DesktopUpdateProgress);
  assert.match(preparing, /role="status">Verifying and preparing update<\/span>/);
  assert.match(preparing, /role="progressbar" aria-label="Installing app update"/);
});

test('busy SteamCMD status renders one check spinner', () => {
  const {default: RuntimeManagement} = loadModule(url('features/admin/runtimes/RuntimeManagement.tsx'), {
    react: {...react, useState: initial => react.useState(initial === '' ? '1' : initial)},
    '../../../lib': {
      Button: button,
      Field: children,
      Select: nil,
      rows: data => data,
      useAPI: path => ({
        data: path.endsWith('/steamcmd')
          ? {version: '1', supported: true, busy: true}
          : path.endsWith('/images')
            ? {images: []}
            : [{id: 1, name: 'Node'}],
      }),
    },
    '../shared': {Heading: nil, ErrorMessage: nil},
    '../../../ui/Settings': {
      SettingsRow: props => el('div', {}, props.label, props.description, props.control, props.children),
      SettingsSection: children,
      Switch: nil,
    },
    '../../shared/PendingSettings': {useDiscardSettings: nil, usePendingSetting: nil},
    '../../../ui/TerminalProgress': terminalProgress,
    '../../../format': {formatDateTime: nil},
    '../../../notifications': {Feedback: nil},
  });
  const markup = render(RuntimeManagement);
  assert.match(markup, /Checking…/);
  assert.equal(markup.match(/class="terminal-spinner"/g)?.length, 1);
});
