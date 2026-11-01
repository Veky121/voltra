import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:[new URL('../src/hooks/preloadRoute.ts',import.meta.url).pathname.replace(/^\/(.:)/,'$1')],bundle:true,write:false,format:'esm',platform:'node'});
const {preloadRoute}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('route prefetch shares the render load and retries failed prefetches',async()=>{
  let calls=0;
  const load=preloadRoute(async()=>{if(++calls===1)throw new Error('offline');return {default:'route'}});
  const prefetch=load();assert.equal(load(),prefetch);
  await assert.rejects(prefetch,/offline/);
  assert.deepEqual(await load(),{default:'route'});
  await load();assert.equal(calls,2);
});
