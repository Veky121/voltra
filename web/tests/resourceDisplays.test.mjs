import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {formatBytes} from '../src/format.ts';
import {formatBytesGB} from '../src/resourceUnits.ts';
import {calls, canonical, jsxAttributes, parse} from './sourceAst.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
async function bundle(contents, stubs = {}) {
  const output = await build({
    stdin: {contents, resolveDir: root, loader: 'tsx'},
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    loader: {'.css': 'empty', '.png': 'empty', '.svg': 'empty'},
    alias: {'@': `${root}/src`},
    logLevel: 'silent',
    // Bundled CommonJS packages still ask for Node built-ins by name.
    banner: {
      js: `import {createRequire as __voltraRequire} from 'node:module'; const require = __voltraRequire(${JSON.stringify(import.meta.url)});`,
    },
    plugins: [
      {
        name: 'fixtures',
        setup(builder) {
          for (const [pattern, contents] of Object.entries(stubs)) {
            builder.onResolve({filter: new RegExp(pattern)}, args => ({
              path: args.path,
              namespace: `fixture-${pattern}`,
            }));
            builder.onLoad({filter: /.*/, namespace: `fixture-${pattern}`}, () => ({
              contents,
              loader: 'js',
              resolveDir: root,
            }));
          }
        },
      },
    ],
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
}

// The real helpers and the real overview page, drawn from a saved list.
globalThis.location ??= new URL('http://127.0.0.1/');
const page = await bundle(`
  import React from 'react';
  import {renderToStaticMarkup} from 'react-dom/server';
  import {MemoryRouter} from 'react-router-dom';
  import Overview from './src/features/servers/Overview';
  import {writeOverviewSnapshot} from './src/features/servers/overviewSnapshot';
  import {queryCacheEpoch} from './src/hooks/queryCache';
  export {resourceUsageGB, resourceLimitGB, resourceReadingGB, bytes} from './src/features/shared/common';
  export function renderOverview(servers) {
    writeOverviewSnapshot(servers, queryCacheEpoch(), undefined);
    return renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Overview)));
  }`);
const {resourceUsageGB, resourceLimitGB, resourceReadingGB} = page;

test('resource readings convert byte usage and MiB limits independently to GB', () => {
  assert.equal(resourceReadingGB(512 * 1024 ** 2, 1024), '0.5 / 1 GB');
  assert.equal(resourceReadingGB(1024 ** 3, 512), '1 / 0.5 GB');
  assert.equal(resourceReadingGB(1024, 10240), '<0.1 / 10 GB');
  assert.equal(resourceReadingGB(2.21 * 1024 ** 3, 15000), '2.2 / 14.6 GB');
  assert.equal(resourceUsageGB(1024), '<0.001 GB');
  assert.equal(resourceLimitGB(1), '<0.001 GB');
});
test('zero usage, unlimited limits and absent data remain distinct', () => {
  assert.equal(resourceReadingGB(0, 0), '0 GB / ∞');
  assert.equal(resourceReadingGB(undefined, 1024), 'Unavailable');
  for (const value of [undefined, null, '', NaN, Infinity, -1]) {
    assert.equal(resourceUsageGB(value), 'Unavailable');
    assert.equal(resourceLimitGB(value), 'Unavailable');
  }
});

test('overview cards show memory and disk as byte usage over the MiB limit, in GB', () => {
  const previous = globalThis.localStorage;
  try {
    const values = new Map();
    globalThis.localStorage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    };
    const html = page.renderOverview([
      {
        uuid: 'a',
        identifier: 'a',
        name: 'alpha',
        node: 'Node 1',
        liveState: 'running',
        egg_name: 'Rust',
        limits: {cpu: 100, memory: 1024, disk: 4096},
        resources: {cpu_absolute: 5, memory_bytes: 512 * 1024 ** 2, disk_bytes: 3 * 1024 ** 3},
      },
    ]);
    assert.match(html, /resource-memory[^]*?>0\.5 \/ 1 GB</);
    assert.match(html, /resource-disk[^]*?>3 \/ 4 GB</);
  } finally {
    globalThis.localStorage = previous;
  }
});

test('storage summaries use GB; the file page reuses the shared summary', async () => {
  const storage = await bundle(
    `
    import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import ServerStorageSummary from './src/features/servers/ServerStorageSummary';
    import FileStorageSummary from './src/features/files/FileStorageSummary';
    export const render = props => renderToStaticMarkup(React.createElement(ServerStorageSummary, props));
    export const renderFiles = () => renderToStaticMarkup(React.createElement(FileStorageSummary));`,
    {
      '^\\.\\./shared/common$': `export const can=()=>true,useServer=()=>({server:{limits:{disk:2048},feature_limits:{backups:3}},permissions:['*'],base:'/api/client/servers/s'});`,
      '^\\./ServerDashboard$': `export const useServerTelemetry=()=>({resources:{disk_bytes:1536*1024**2},updated:1,error:''});`,
    }
  );
  const html = storage.render({
    backupResponse: {
      meta: {
        backup_count: 1,
        storage: {
          local_bytes: 1024 ** 3,
          remote_bytes: 0,
          other_bytes: 0,
          total_bytes: 1024 ** 3,
          pending_count: 0,
          failed_count: 0,
        },
      },
    },
  });
  assert.ok(html.includes(formatBytesGB(1536 * 1024 ** 2)), html);
  assert.ok(html.includes(` / ${formatBytesGB(2048 * 1024 ** 2)}`), html);
  assert.ok(html.includes(`${formatBytesGB(1024 ** 3)} local`), html);
  // The file page shows the same summary as a strip.
  const files = storage.renderFiles();
  assert.ok(files.includes(formatBytesGB(1536 * 1024 ** 2)), files);
  assert.equal(files, storage.render({strip: true}));
});

test('network rates, backups and file sizes keep the shared adaptive formatter', () => {
  // The helper pages use for file and backup sizes is the shared formatter.
  for (const value of [0, 1536, 5 * 1024 ** 2, 3.2 * 1024 ** 3, undefined])
    assert.equal(page.bytes(value), formatBytes(Number(value || 0)));
  assert.notEqual(page.bytes(1536), formatBytesGB(1536));
  // Live charts: memory in GB, network as an adaptive rate per second.
  const dashboard = parse(new URL('../src/features/servers/ServerDashboard.tsx', import.meta.url));
  const formats = jsxAttributes(dashboard, 'UsageChart', 'format').map(node => canonical(node, dashboard));
  assert.ok(formats.includes('formatBytesGB'), formats.join('\n'));
  assert.ok(
    formats.some(format => /^n => `\$\{bytes\(n\)\}\/s`$/.test(format)),
    formats.join('\n')
  );
  // Backup cards show each backup's size with the same helper.
  const operations = parse(new URL('../src/features/backups/Backups.tsx', import.meta.url));
  assert.ok(calls(operations, 'bytes').some(args => args.join() === 'b.bytes'));
});
