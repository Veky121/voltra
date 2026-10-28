import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {build} from 'vite';
import {compressedAssets} from '../build/compressedAssets.ts';

test('gzip assets include Vite final dynamic import and CSS preload rewrites',async()=>{
 const root=await mkdtemp(join(tmpdir(),'voltra-compression-'));
 try{
  await writeFile(join(root,'index.html'),'<script type="module" src="/entry.js"></script>');
  await writeFile(join(root,'entry.js'),'document.body.onclick=()=>import("./page.js").then(m=>m.show());');
  await writeFile(join(root,'page.js'),'import "./page.css";export function show(){document.body.textContent="Loaded"}');
  await writeFile(join(root,'page.css'),'body{color:green}');
  await build({root,configFile:false,logLevel:'silent',plugins:[compressedAssets()]});
  const dir=join(root,'dist','assets');
  const files=(await readdir(dir)).filter(name=>/\.(js|css)$/.test(name));
  assert.ok(files.filter(name=>name.endsWith('.js')).length>=2,'fixture must contain a lazy route');
  assert.ok(files.some(name=>name.endsWith('.css')),'fixture must contain lazy CSS');
  for(const file of files){
   const raw=await readFile(join(dir,file));
   assert.deepEqual(gunzipSync(await readFile(join(dir,file+'.gz'))),raw,file);
   assert.ok(!raw.includes('__VITE_PRELOAD__'),file+' retains a preload marker');
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
