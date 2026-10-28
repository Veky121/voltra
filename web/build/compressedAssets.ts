import {gzipSync} from 'node:zlib';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Plugin} from 'vite';

export function compressedAssets():Plugin{return {
 name:'voltra-compressed-assets',apply:'build',
 async writeBundle(options,bundle){
  if(!options.dir)return;
  // Vite rewrites dynamic-import preload markers in generateBundle. Compress
  // final files after those rewrites, so gzip and identity bytes always agree.
  const directory=options.dir;
  await Promise.all(Object.keys(bundle).filter(name=>/\.(js|css)$/.test(name)).map(async name=>{
   const path=join(directory,name);
   await writeFile(`${path}.gz`,gzipSync(await readFile(path),{level:9}));
  }));
 }
}}
