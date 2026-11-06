import {createRequire} from 'node:module';
import {mkdir, copyFile, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const {build} = require('esbuild');
const root = fileURLToPath(new URL('.', import.meta.url));
const base = JSON.parse(await readFile(new URL('manifest.json', import.meta.url)));
const firefox = JSON.parse(await readFile(new URL('manifest.firefox.json', import.meta.url)));
for (const [outdir, target, overrides] of [['dist', 'chrome116', {}], ['dist-firefox', 'firefox142', firefox]]) {
  await mkdir(new URL(`${outdir}/icons/`, import.meta.url), {recursive:true});
  const manifest = {...base, ...overrides};
  for (const key of Object.keys(manifest)) if (manifest[key] === null) delete manifest[key];
  await writeFile(new URL(`${outdir}/manifest.json`, import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
  for (const size of [16, 32, 48, 128]) {
    await copyFile(new URL(`../web/public/brand/voltra-${size}.png`, import.meta.url), new URL(`${outdir}/icons/voltra-${size}.png`, import.meta.url));
  }
  await build({absWorkingDir:root, entryPoints:['src/background.js','src/app.js'], outdir, bundle:true, format:'iife', target});
  await build({absWorkingDir:root, entryPoints:['src/content.js'], outdir, bundle:true, format:'iife', target});
  for (const file of ['app.html', 'app.css', 'INSTALL.txt', 'PRIVACY.md']) await copyFile(new URL(file, import.meta.url), new URL(`${outdir}/${file}`, import.meta.url));
  console.log(`Built browser-addon/${outdir}`);
}
