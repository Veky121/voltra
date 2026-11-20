import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {renderToString} from 'react-dom/server';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

// The helper is bundled against the same React the test renders with.
globalThis.__readyRouteReact = React;
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/hooks/readyRoute.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'react',
      setup(b) {
        b.onResolve({filter: /^react$/}, () => ({path: 'react', namespace: 'shared'}));
        b.onLoad({filter: /.*/, namespace: 'shared'}, () => ({
          contents:
            'const R=globalThis.__readyRouteReact;export const createElement=R.createElement,lazy=R.lazy,useState=R.useState;',
        }));
      },
    },
  ],
});
const {readyRoute} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const Page = ({name}) => React.createElement('main', null, `Servers for ${name}`);
const draw = Route =>
  renderToString(React.createElement(React.Suspense, {fallback: 'Loading'}, React.createElement(Route, {name: 'Ada'})));

test('a route whose module has loaded is drawn at once, with no loading state', async () => {
  let loads = 0;
  const Route = readyRoute(async () => {
    loads++;
    return {default: Page};
  });
  assert.match(draw(Route), /Loading/, 'before its module loads it is an ordinary lazy route');
  await Route.preload();
  const html = draw(Route);
  assert.match(html, /Servers for Ada/);
  assert.doesNotMatch(html, /Loading/);
  assert.equal(loads, 1, 'preloading and rendering share one load');
});

test('a failed preload is tried again when the route is next needed', async () => {
  let loads = 0;
  const Route = readyRoute(async () => {
    if (++loads === 1) throw new Error('offline');
    return {default: Page};
  });
  await assert.rejects(Route.preload(), /offline/);
  await Route.preload();
  assert.equal(loads, 2);
  assert.match(draw(Route), /Servers for Ada/);
});
