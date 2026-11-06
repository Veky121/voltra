import {createRequire} from 'node:module';
import {mkdir, copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const {build} = require('esbuild');
const root = fileURLToPath(new URL('.', import.meta.url));
await mkdir(new URL('dist/', import.meta.url), {recursive: true});
await mkdir(new URL('dist/icons/', import.meta.url), {recursive: true});
for (const size of [16, 32, 48, 128]) {
  await copyFile(new URL(`../web/public/brand/voltra-${size}.png`, import.meta.url), new URL(`dist/icons/voltra-${size}.png`, import.meta.url));
}
await build({absWorkingDir: root, entryPoints: ['src/background.js', 'src/app.js'], outdir: 'dist', bundle: true, format: 'esm', target: 'chrome116'});
await build({absWorkingDir: root, entryPoints: ['src/content.js'], outdir: 'dist', bundle: true, format: 'iife', target: 'chrome116'});
for (const file of ['manifest.json', 'app.html', 'app.css', 'INSTALL.txt']) await copyFile(new URL(file, import.meta.url), new URL('dist/' + file, import.meta.url));
console.log('Built browser-addon/dist. Load this directory as an unpacked Chromium extension.');
