import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build, loadConfigFromFile} from 'vite';

test('publishing a second build preserves lazy modules referenced by an open first-build tab', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'voltra-assets-'));
  try {
    const loaded=await loadConfigFromFile({command:'build',mode:'production'},fileURLToPath(new URL('../vite.config.ts',import.meta.url)));
    assert.ok(loaded,'production Vite configuration loaded');
    await mkdir(path.join(root,'src'));
    await writeFile(path.join(root,'index.html'),'<script type="module" src="/src/main.js"></script>');
    await writeFile(path.join(root,'src/main.js'),'window.openAdmin=()=>import("./Admin.js");');
    const config={...loaded.config,configFile:false,root,publicDir:false,plugins:[],logLevel:'silent'};
    await writeFile(path.join(root,'src/Admin.js'),'export const version="first";');
    await build(config);
    const assets=path.join(root,'dist/assets');
    const oldAdmin=(await readdir(assets)).find(name=>/^Admin-.*\.js$/.test(name));
    assert.ok(oldAdmin,'first build has a separate lazy Admin module');
    const oldBytes=await readFile(path.join(assets,oldAdmin),'utf8');
    const oldIndex=await readFile(path.join(root,'dist/index.html'),'utf8');
    await writeFile(path.join(root,'src/Admin.js'),'export const version="second";');
    await build(config);
    assert.notEqual(await readFile(path.join(root,'dist/index.html'),'utf8'),oldIndex,'new navigations receive the new entry');
    assert.equal(await readFile(path.join(assets,oldAdmin),'utf8'),oldBytes,'open tabs can still fetch their original lazy module');
    assert.equal((await readdir(assets)).filter(name=>/^Admin-.*\.js$/.test(name)).length,2);
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});
