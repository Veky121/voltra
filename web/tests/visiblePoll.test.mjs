import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:[new URL('../src/hooks/visiblePoll.ts',import.meta.url).pathname.replace(/^\/(.:)/,'$1')],bundle:true,write:false,format:'esm',platform:'node'});
const {visiblePoll}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const flush=async()=>{await Promise.resolve();await Promise.resolve()};

test('telemetry pauses hidden requests, resumes, backs off failures and cancels on stop',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const previous=globalThis.document;
  globalThis.document=Object.assign(new EventTarget(),{hidden:true});
  const requests=[];
  const stop=visiblePoll(signal=>new Promise((resolve,reject)=>{requests.push({signal,resolve,reject});signal.addEventListener('abort',()=>reject(new Error('cancelled')))}));
  t.after(()=>{stop();globalThis.document=previous});
  t.mock.timers.tick(60000);assert.equal(requests.length,0);
  document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));assert.equal(requests.length,1);
  document.dispatchEvent(new Event('visibilitychange'));assert.equal(requests.length,1);
  document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));assert.equal(requests[0].signal.aborted,true);
  await flush();t.mock.timers.tick(60000);assert.equal(requests.length,1);
  document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));assert.equal(requests.length,2);
  requests[1].reject(new Error('node unavailable'));await flush();
  t.mock.timers.tick(1000);assert.equal(requests.length,2);
  t.mock.timers.tick(1000);assert.equal(requests.length,3);
  requests[2].resolve();await flush();t.mock.timers.tick(1000);assert.equal(requests.length,4);
  stop();assert.equal(requests[3].signal.aborted,true);await flush();t.mock.timers.tick(60000);assert.equal(requests.length,4);
});
