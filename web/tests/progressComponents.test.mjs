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

test('startup console is available during starting, and uses the live log for copy and save', async () => {
  const buttons = new Map();
  let log = null;
  let copied;
  let downloaded;
  let saved;
  let copyAction;
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
  let firstNull;
  const draw = (Component, props) => {
    firstNull = true;
    return render(Component, props);
  };
  const {default: Terminal} = loadModule(
    url('features/console/Terminal.tsx'),
    {
      react: {
        ...react,
        useState(initial) {
          const state = react.useState(initial);
          if (initial === null && firstNull) {
            firstNull = false;
            return [log, next => (log = next(log))];
          }
          return state;
        },
      },
      '../../ui/IconButton': {IconButton: Button},
      '../../components/ui/button': {Button},
      '../../components/ui/dropdown-menu': {
        DropdownMenu: children,
        DropdownMenuTrigger: nil,
        DropdownMenuContent: children,
        DropdownMenuItem: Button,
      },
      '../../ui/TerminalProgress': terminalProgress,
      '../../Icons': {Icon: nil},
      '../shared/common': {
        useServer: () => ({server: {name: 'Server'}, base: '/server', permissions: []}),
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
      './installProgress': install,
    },
    {
      navigator: {clipboard: {writeText: async text => (copied = text)}},
      window: {getSelection: () => null},
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
  const props = {
    status: 'starting',
    connection: 'Connected',
    history: history.appendConsoleHistory(history.emptyConsoleHistory(), ['JVM and mod loader output']),
    installHistory: history.appendConsoleHistory(history.emptyConsoleHistory(), ['Installer diagnostic']),
    installStages: [{id: 'start', label: 'Starting server', state: 'running'}],
    installAttempt: 1,
  };
  const owner = draw(Terminal, props);
  assert.match(owner, /aria-expanded="false"[^>]*>Show live startup console<\/button>/);
  assert.doesNotMatch(owner, /full install log|Installer diagnostic|Save install log/);
  assert.match(draw(Terminal, {...props, status: 'unknown'}), /Show live startup console/);
  assert.match(draw(Terminal, {...props, canReadInstallLog: true}), /Show full install log/);
  // Simulate the selected log in the server render hook, then use its actual
  // toolbar handlers. The live console uses the same output element and tools.
  buttons.get('Show live startup console')();
  assert.match(draw(Terminal, props), /aria-expanded="true"[^>]*>Hide live startup console<\/button>/);
  buttons.get('Copy console output')();
  await copyAction;
  assert.equal(copied, 'JVM and mod loader output');
  buttons.get('Save console log')();
  assert.equal(downloaded, 'Server-console.log');
  assert.equal(await saved.text(), 'JVM and mod loader output');
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
