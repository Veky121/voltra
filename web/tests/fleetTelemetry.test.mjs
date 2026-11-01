import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:[new URL('../src/admin/fleetTelemetry.ts',import.meta.url).pathname.replace(/^\/(.:)/,'$1')],bundle:true,write:false,format:'esm',platform:'node'});
const {observeFleetTelemetry}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function fixture(t,request){
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const old=globalThis.document;globalThis.document=Object.assign(new EventTarget(),{hidden:false});
 const callbacks=new Map(),fresh=new Set(),calls=[],seen=[];
 const stop=observeFleetTelemetry({nodes:['node'],servers:['server']},values=>seen.push(values),{
  request:(path,options)=>{calls.push(path);return request(path,options)},
  observe:(path,cb)=>{callbacks.set(path,cb);return()=>callbacks.delete(path)},fresh:path=>fresh.has(path),
 });
 t.after(()=>{stop();globalThis.document=old});
 const tick=async ms=>{t.mock.timers.tick(ms);for(let i=0;i<10;i++)await Promise.resolve()};
 return {calls,seen,stop,tick,callbacks,fresh,emit:usage=>{fresh.add('server');callbacks.get('server')({status:200,data:{resources:{cpu_absolute:usage}}})}};
}
test('healthy fleet shares socket readings and avoids repeated capacity or resource requests',async t=>{
 const f=fixture(t,async path=>{assert.equal(path,'node');return {cpu_count:16}});
 f.emit(125);await f.tick(1000);await f.tick(50);
 for(let i=0;i<12;i++){f.emit(125+i);await f.tick(5000)}
 assert.deepEqual(f.calls,['node']);assert.equal(f.seen.at(-1).node,16);assert.equal(f.seen.at(-1).server,136);
 f.stop();assert.equal(f.callbacks.size,0);await f.tick(600000);assert.deepEqual(f.calls,['node']);
});
test('stale fleet falls back, newer socket wins HTTP race, and hidden tabs stop polling',async t=>{
 let resolveServer;
 const f=fixture(t,path=>path==='node'?Promise.resolve({cpu_count:8}):new Promise(resolve=>{resolveServer=resolve}));
 await f.tick(1000);assert.deepEqual(f.calls,['node','server']);
 f.emit(250);resolveServer({resources:{cpu_absolute:5}});await f.tick(50);await f.tick(50);
 assert.equal(f.seen.at(-1).server,250);
 document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));await f.tick(600000);assert.equal(f.calls.length,2);
 document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));await f.tick(1000);assert.deepEqual(f.calls,['node','server','node']);
 f.fresh.clear();await f.tick(5000);assert.equal(f.calls.at(-1),'server');resolveServer({resources:{cpu_absolute:50}});await f.tick(50);await f.tick(50);assert.equal(f.seen.at(-1).server,50);
});
