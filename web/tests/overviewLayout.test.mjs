import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {
  gameIconFallback,
  overviewLayoutKey,
  readOverviewLayout,
  serverInitial,
  writeOverviewLayout,
} from '../src/features/servers/overviewLayout.ts';

function memory(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value))};
}
const broken = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('full');
  },
};

test('the overview opens as cards unless this browser chose the list', () => {
  assert.equal(readOverviewLayout(memory()), 'cards');
  assert.equal(readOverviewLayout(memory({[overviewLayoutKey]: 'list'})), 'list');
  assert.equal(readOverviewLayout(memory({[overviewLayoutKey]: 'table'})), 'cards');
  assert.equal(readOverviewLayout(undefined), 'cards');
  const store = memory();
  writeOverviewLayout('list', store);
  assert.equal(store.values.get(overviewLayoutKey), 'list');
  assert.equal(readOverviewLayout(store), 'list');
  writeOverviewLayout('cards', store);
  assert.equal(readOverviewLayout(store), 'cards');
});

test('blocked or full storage keeps the default and never throws', () => {
  assert.equal(readOverviewLayout(broken), 'cards');
  assert.doesNotThrow(() => writeOverviewLayout('list', broken));
});

test('a server without an icon falls back to its game icon, then to an initial', () => {
  assert.equal(gameIconFallback({id: 'rust', src: '/artwork/rust.svg', kind: 'game'}), '/artwork/rust.svg');
  assert.equal(
    gameIconFallback({id: 'minecraft', src: '/artwork/minecraft.svg', kind: 'game'}),
    '/game-icons/minecraft-official.png'
  );
  assert.equal(
    gameIconFallback(
      {id: 'minecraft', src: '/artwork/minecraft.svg', kind: 'game'},
      {src: '/game-icons/paper-official.png'}
    ),
    '/game-icons/paper-official.png'
  );
  // Placeholder artwork is not a game icon.
  assert.equal(gameIconFallback({id: 'server', src: '/artwork/server.svg', kind: 'fallback'}), undefined);
  assert.equal(serverInitial('  rust weekly'), 'R');
  assert.equal(serverInitial('[EU] Valheim'), 'E');
  assert.equal(serverInitial('élan'), 'É');
  assert.equal(serverInitial(''), '?');
  assert.equal(serverInitial(undefined), '?');
});

// The real page, drawn from a saved list, in each layout.
// Server rendering has no window; the shell reads only the address from it.
globalThis.location ??= new URL('http://127.0.0.1/');
const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({
  stdin: {
    contents: `
    import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {MemoryRouter} from 'react-router-dom';
    import Overview from './src/features/servers/Overview';
    import {writeOverviewSnapshot} from './src/features/servers/overviewSnapshot';
    import {queryCacheEpoch} from './src/hooks/queryCache';
    export function render(servers) {
      writeOverviewSnapshot(servers, queryCacheEpoch(), undefined);
      return renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Overview)));
    }`,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  loader: {'.css': 'empty', '.png': 'empty', '.svg': 'empty'},
  alias: {'@': `${root}/src`},
  // Bundled CommonJS packages still ask for Node built-ins by name.
  banner: {
    js: `import {createRequire as __voltraRequire} from 'node:module'; const require = __voltraRequire(${JSON.stringify(import.meta.url)});`,
  },
  logLevel: 'silent',
});
const page = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const servers = [
  {
    uuid: 'a',
    identifier: 'a',
    name: 'alpha',
    node: 'Node 1',
    liveState: 'running',
    egg_name: 'Rust',
    limits: {cpu: 100, memory: 1024, disk: 1024},
  },
  {
    uuid: 'b',
    identifier: 'b',
    name: 'beta',
    node: 'Node 1',
    liveState: 'offline',
    limits: {cpu: 100, memory: 1024, disk: 1024},
  },
];

test('cards stay the default view; the list draws the same servers as rows', () => {
  const previous = globalThis.localStorage;
  try {
    globalThis.localStorage = memory();
    const cards = page.render(servers);
    assert.match(cards, /class="overview-server-grid"/);
    assert.doesNotMatch(cards, /overview-server-list/);
    assert.match(cards, /aria-label="Server view"/);
    globalThis.localStorage = memory({[overviewLayoutKey]: 'list'});
    const list = page.render(servers);
    assert.match(list, /<ul class="overview-server-list" aria-label="Servers">/);
    assert.equal(list.match(/class="overview-row"/g)?.length, 2);
    assert.doesNotMatch(list, /overview-server-grid/);
    // One vocabulary for the state, and the initial when there is no game icon.
    assert.match(list, /data-tone="success"[^>]*><span class="status-dot"><\/span>Running/);
    assert.match(list, /data-tone="neutral"[^>]*><span class="status-dot"><\/span>Offline/);
    assert.match(list, /server-identity-initial[^>]*>B</);
  } finally {
    globalThis.localStorage = previous;
  }
});
