import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// The early reads are matched to the page's requests by their exact text, in
// three places: the desktop host, startup.js, and the code that makes each
// request. If one drifts, nothing breaks; the head start just turns into a
// second request. This keeps the three in step.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const host = read('../../desktop/boot.go');
const startup = read('../public/startup.js');
const quoted = text => [...text.matchAll(/"(\/api\/[^"]+)"/g)].map(match => match[1]);
const block = name => host.slice(host.indexOf(`var ${name} = `)).split('\n}\n')[0];

const shell = quoted(block('bootPaths'));
const pages = quoted(block('bootPagePaths'));
const admin = quoted(block('bootAdminPaths'));
const overview = '/api/client?summary=overview&per_page=100';

// Where the page asks for each read.
const callers = {
  '/api/setup/status': '../src/setup.tsx',
  '/api/auth/session': '../src/setup.tsx',
  '/api/client/account': '../src/App.tsx',
  '/api/client/settings': '../src/App.tsx',
  '/api/client/account/server-navigation': '../src/ServerNavigation.tsx',
  '/api/client/artwork/catalog': '../src/client/ArtworkProvider.tsx',
  [overview]: '../src/client/Overview.tsx',
  '/api/client/game-library/catalog': '../src/client/gameLibraryCatalog.ts',
  '/api/application/servers?per_page=100': '../src/admin/FleetSummary.tsx',
  '/api/application/nodes?per_page=100': '../src/admin/FleetSummary.tsx',
};

test('the host and startup.js ask for the same shell reads', () => {
  assert.equal(shell.length, 6);
  assert.equal(host.match(/const bootAccountPath = "([^"]+)"/)[1], '/api/client/account');
  // Each path once, in the order startup.js first names it.
  const early = [...new Set([...startup.matchAll(/'(\/api\/[^']+)'/g)].map(match => match[1]))];
  assert.deepEqual(early, [...shell, overview]);
  assert.ok(pages.includes(overview));
});

test('every early read is a request the page really makes, character for character', () => {
  for (const path of [...shell, ...pages, ...admin]) {
    assert.ok(callers[path], `${path} has no known caller`);
    const source = read(callers[path]);
    assert.ok(source.includes(`'${path}'`) || source.includes(`"${path}"`), `${callers[path]} no longer requests ${path}`);
  }
});
