import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:[new URL('../src/hooks/queryCache.ts',import.meta.url).pathname.replace(/^\/(.:)/,'$1')],bundle:true,write:false,format:'esm',platform:'node'});
const c=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const tick=()=>new Promise(r=>setImmediate(r));
const path='/api/client/servers/one';
function network(){const calls=[];return {calls,request:(path,options)=>new Promise((resolve,reject)=>calls.push({path,options,resolve,reject}))};}
test('allowlist excludes sensitive and volatile reads',()=>{
 for(const suffix of ['game-settings','files/contents','resources','websocket','schedules','databases'])assert.equal(c.queryTTL(path+'/'+suffix),0);
 assert.equal(c.queryTTL('/api/auth/session'),0);assert(c.queryTTL('/api/client/account'));
 assert(c.queryTTL('/api/client/game-library/templates'));
});
test('dedupe, retained subscriber and fresh reuse',async()=>{
 c.purgeQueryCache();const n=network();let state;
 const a=c.observeQuery(path,n.request,()=>{}),b=c.observeQuery(path,n.request,s=>state=s);await tick();assert.equal(n.calls.length,1);
 a.unsubscribe();assert.equal(n.calls[0].options.signal.aborted,false);n.calls[0].resolve({v:1});await tick();b.unsubscribe();
 const d=c.observeQuery(path,n.request,s=>state=s);await tick();assert.equal(n.calls.length,1);assert.equal(state.data.v,1);d.unsubscribe();
});
test('refresh coalesces and mutation invalidation fences old responses',async()=>{
 c.purgeQueryCache();const n=network();let state;const a=c.observeQuery(path,n.request,s=>state=s);await tick();a.reload();a.reload();n.calls[0].resolve({v:1});await tick();assert.equal(n.calls.length,2);
 c.invalidateQueryCache();await tick();assert.equal(n.calls.length,3);n.calls[1].resolve({v:2});await tick();assert.equal(state.data.v,1);n.calls[2].resolve({v:3});await tick();assert.equal(state.data.v,3);a.unsubscribe();
});
test('session purge clears consumers and fences in-flight results',async()=>{
 c.purgeQueryCache();const n=network();let state;const a=c.observeQuery(path,n.request,s=>state=s);await tick();c.setQueryCacheScope('B/session2');n.calls[0].resolve({old:true});await tick();assert.equal(state.data,null);
 a.reload();await tick();n.calls[1].resolve({v:2});await tick();assert.equal(state.data.v,2);c.purgeQueryCache();assert.equal(state.data,null);a.unsubscribe();
});
test('absolute same origin completion URL normalizes',()=>{assert.equal(c.normalizedQueryPath('http://localhost/upload/complete?x=1'),'/upload/complete?x=1');assert.equal(c.normalizedQueryPath('https://external.invalid/upload'),'');});

test('navigation mutation preserves account and server data without requests',async()=>{
 c.purgeQueryCache();const n=network();let account,server;
 const a=c.observeQuery('/api/client/account',n.request,s=>account=s),b=c.observeQuery(path,n.request,s=>server=s);await tick();
 n.calls[0].resolve({id:1});n.calls[1].resolve({name:'one'});await tick();
 c.invalidateQueryCache(path+'/navigation');await tick();assert.equal(n.calls.length,2);assert.equal(account.data.id,1);assert.equal(server.data.name,'one');a.unsubscribe();b.unsubscribe();
});
test('forbidden refresh removes previously cached authority',async()=>{
 c.purgeQueryCache();const n=network();let state;const a=c.observeQuery(path,n.request,s=>state=s);await tick();n.calls[0].resolve({permissions:['*']});await tick();a.reload();await tick();n.calls[1].reject(Object.assign(new Error('Forbidden'),{status:403}));await tick();assert.equal(state.data,null);a.unsubscribe();
});
const apiBundle=await build({stdin:{contents:"export {api,queryCacheSessionIdentity} from './src/lib'; export {observeQuery,purgeQueryCache} from './src/hooks/queryCache';",resolveDir:new URL('..',import.meta.url).pathname.replace(/^\/(.:)/,'$1'),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'ui-stubs',setup(b){b.onResolve({filter:/components\/ui\/card|\.\/ui\/Select|\.\/ui\/Modal/},()=>({path:'ui',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const Card=()=>null;export const Select=()=>null;export const Modal=()=>null;'}));}}]});
const real=await import(`data:text/javascript;base64,${Buffer.from(apiBundle.outputFiles[0].text).toString('base64')}`);
test('api mutations target related data and silent session identity changes purge',async()=>{
 const oldFetch=globalThis.fetch,oldWindow=globalThis.window;
 globalThis.window=Object.assign(new EventTarget(),{location:{origin:'http://localhost'}});
 let body={authenticated:true,user:{id:1,root_admin:true}};
 globalThis.fetch=async()=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
 let state;const n=network();
 try{
  await real.api('/api/auth/session');
  const reader=real.observeQuery('/api/client/account',n.request,s=>state=s);await tick();n.calls[0].resolve({id:1});await tick();
  await real.api('http://localhost/api/client/servers/one/navigation',{method:'POST'});assert.equal(state.data.id,1);
  await real.api('/api/auth/session');assert.equal(state.data.id,1);
  body={authenticated:true,user:{id:2,root_admin:false}};await real.api('/api/auth/session');assert.equal(state.data,null);
  reader.unsubscribe();
 }finally{real.purgeQueryCache();globalThis.fetch=oldFetch;globalThis.window=oldWindow;}
});
test('absolute upload completion refreshes directory listings and preserves account',async()=>{
 c.purgeQueryCache();const n=network();let account,files;
 const a=c.observeQuery('/api/client/account',n.request,s=>account=s),b=c.observeQuery(path+'/files/list?directory=%2F',n.request,s=>files=s);await tick();
 n.calls[0].resolve({id:1});n.calls[1].resolve({data:['before']});await tick();
 c.invalidateQueryCache('http://localhost'+path+'/files/uploads/id/complete');await tick();assert.equal(n.calls.length,3);assert.equal(account.data.id,1);assert.deepEqual(files.data.data,['before']);
 n.calls[2].resolve({data:['after']});await tick();assert.deepEqual(files.data.data,['after']);a.unsubscribe();b.unsubscribe();
});
test('expired directory cache revalidates on return',async()=>{
 c.purgeQueryCache();const n=network();const original=Date.now;let now=10000;Date.now=()=>now;
 try{let state;const a=c.observeQuery(path+'/files/list?directory=%2F',n.request,s=>state=s);await tick();n.calls[0].resolve({data:[]});await tick();a.unsubscribe();now+=2001;
 const b=c.observeQuery(path+'/files/list?directory=%2F',n.request,s=>state=s);await tick();assert.equal(n.calls.length,2);assert.equal(state.loading,true);b.unsubscribe();
 }finally{Date.now=original;}
});
