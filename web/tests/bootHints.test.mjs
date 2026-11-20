import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'vite';
import {bootHints} from '../build/bootHints.ts';

async function fixture(options) {
  const root = await mkdtemp(join(tmpdir(), 'voltra-hints-'));
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html lang="en"><head><title>Voltra</title></head><body><script type="module" src="/entry.js"></script></body></html>'
  );
  await writeFile(
    join(root, 'entry.js'),
    'import "./entry.css";document.body.onclick=()=>import("./route.js").then(m=>m.open());'
  );
  await writeFile(join(root, 'entry.css'), 'body{margin:0}');
  await writeFile(
    join(root, 'route.js'),
    'import "./route.css";import {label} from "./shared.js";export const open=()=>import("./page.js").then(m=>m.show(label));'
  );
  await writeFile(join(root, 'route.css'), 'main{color:green}');
  await writeFile(
    join(root, 'page.js'),
    'import "./page.css";import {label} from "./shared.js";export const show=text=>{document.body.textContent=text+label};'
  );
  await writeFile(join(root, 'page.css'), 'section{color:blue}');
  await writeFile(join(root, 'shared.js'), 'export const label="Loaded";');
  await build({root, configFile: false, logLevel: 'silent', plugins: [bootHints(options)]});
  return {root, html: await readFile(join(root, 'dist', 'index.html'), 'utf8')};
}

test('the first page is listed in the document, once per file and without the entry', async () => {
  const {root, html} = await fixture({desktop: false, routes: ['/route.js', '/page.js', '/missing.js']});
  try {
    const listed = html.match(/<meta name="voltra-first-page" content="([^"]+)">/)?.[1].split(' ') ?? [];
    const entry = html.match(/<script type="module" crossorigin src="([^"]+)">/)[1];
    const entryStyle = html.match(/<link rel="stylesheet" crossorigin href="([^"]+)">/)[1];
    assert.ok(
      listed.some(href => /\/assets\/route-[^.]+\.js$/.test(href)),
      html
    );
    assert.ok(
      listed.some(href => /\/assets\/page-[^.]+\.js$/.test(href)),
      html
    );
    assert.deepEqual(
      listed
        .filter(href => href.endsWith('.css'))
        .map(href => href.replace(/-[^.]+\.css$/, '.css'))
        .sort(),
      ['/assets/page.css', '/assets/route.css']
    );
    assert.equal(new Set(listed).size, listed.length, 'a shared module is listed once');
    assert.ok(!listed.includes(entry) && !listed.includes(entryStyle), 'the entry is already loading');
    for (const href of listed) await access(join(root, 'dist', href));
    assert.ok(
      !/rel="(modulepreload|preload)"[^>]+(route|page)-/.test(html),
      'startup.js decides whether to fetch them'
    );
    assert.ok(!html.includes('data-voltra-desktop'));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('the desktop build marks its document and a build without the routes lists nothing', async () => {
  const {root, html} = await fixture({desktop: true, routes: ['/missing.js']});
  try {
    assert.match(html, /<html data-voltra-desktop lang="en">/);
    assert.ok(!html.includes('voltra-first-page'));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
