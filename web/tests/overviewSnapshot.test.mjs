import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const bundle=await build({stdin:{contents:"export * from './src/client/overviewSnapshot'; export * from './src/hooks/queryCache';",resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const c=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
test('overview return snapshot expires and cannot cross account boundaries or accept late writes',()=>{
 const realNow=Date.now;let now=10000;Date.now=()=>now;
 try{
  c.setQueryCacheScope('account-a');const epoch=c.queryCacheEpoch();
  c.writeOverviewSnapshot([{uuid:'a',liveState:'running'}],epoch);
  assert.equal(c.readOverviewSnapshot()[0].uuid,'a');
  now+=300001;assert.equal(c.readOverviewSnapshot(),undefined);
  c.writeOverviewSnapshot([{uuid:'a'}],epoch);
  c.setQueryCacheScope('account-b');assert.equal(c.readOverviewSnapshot(),undefined);
  c.writeOverviewSnapshot([{uuid:'late-a'}],epoch);assert.equal(c.readOverviewSnapshot(),undefined);
 }finally{Date.now=realNow}
});
test('cached initial reads remain request-specific and disappear at logout',async()=>{
 c.purgeQueryCache();const request=async()=>({data:'safe'});
 const watch=c.observeQuery('/api/client/account',request,()=>{});
 await new Promise(resolve=>setImmediate(resolve));watch.unsubscribe();
 assert.equal(c.readQuerySnapshot('/api/client/account',request).data.data,'safe');
 assert.equal(c.readQuerySnapshot('/api/client/account',async()=>null),undefined);
 c.purgeQueryCache();assert.equal(c.readQuerySnapshot('/api/client/account',request),undefined);
});
