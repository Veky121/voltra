import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/hooks/useAPIRequest.ts',import.meta.url),'utf8');
const compiled=ts.transpile(source.slice(source.indexOf('export function')).replace('export function','function'),{target:ts.ScriptTarget.ES2022});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(live=false){
 let state,index=0;const hooks=[],effects=[],cleanups=[],timers=[],calls=[];let sample,hint,pending;
 const window=new EventTarget(),document=Object.assign(new EventTarget(),{hidden:false});
 const useRef=initial=>{const i=index++;return hooks[i]??=( {current:initial} )};
 const useState=initial=>{state=typeof initial==='function'?initial():initial;return [state,next=>state=typeof next==='function'?next(state):next]};
 const create=new Function('useState','useEffect','useRef','useCallback','observeQuery','readQuerySnapshot','applyLiveQuery','invalidateExactQuery','observeLivePath','isLivePathFresh','observeReadInvalidation','readPolicy','document','window','setInterval','clearInterval','fenceQueryResponse',compiled+';return useAPIRequest;');
 const hook=create(useState,fn=>effects.push(fn),useRef,fn=>fn,()=>undefined,()=>undefined,()=>{},()=>false,(_p,cb,onPending)=>{sample=cb;pending=onPending;return live?()=>{}:undefined},()=>false,(_p,cb)=>{hint=cb;return ()=>{}},()=>({domains:['files'],reconcileMs:15000}),document,window,fn=>{timers.push(fn);return timers.length},()=>{},()=>{});
 hook('/api/client/servers/a/files/list',(_path,options)=>new Promise((resolve,reject)=>calls.push({resolve,reject,options})));
 for(const effect of effects)cleanups.push(effect());
 return {calls,get state(){return state},poll:()=>timers[0](),pending:()=>pending(),sample:value=>sample(value),hint:()=>hint(),cleanup:()=>cleanups.forEach(fn=>fn?.())};
}
test('reconciliation ticks never starve a slow HTTP response',async()=>{
 const f=fixture();for(let i=0;i<10;i++)f.poll();assert.equal(f.calls.length,1);
 f.calls[0].resolve({data:['first']});await tick();assert.deepEqual(f.state.data,{data:['first']});assert.equal(f.calls.length,2);f.cleanup();
});
test('change hint fences an in-flight HTTP response and schedules one replacement',async()=>{
 const f=fixture();f.hint();f.hint();f.calls[0].resolve({data:['old']});await tick();assert.equal(f.state.data,null);assert.equal(f.calls.length,2);
 f.calls[1].resolve({data:['new']});await tick();assert.deepEqual(f.state.data,{data:['new']});f.cleanup();
});
test('socket snapshots win over older HTTP; transient errors retain content but revocation clears it',async()=>{
 const f=fixture(true);f.sample({status:200,data:{data:['live']}});f.calls[0].resolve({data:['old']});await tick();assert.deepEqual(f.state.data,{data:['live']});
 f.sample({status:503,data:{errors:[{detail:'Node unavailable'}]}});assert.deepEqual(f.state.data,{data:['live']});assert.equal(f.state.error,'Node unavailable');
 f.sample({status:403,data:{errors:[{detail:'Forbidden'}]}});assert.equal(f.state.data,null);f.cleanup();
});
test('unmounted requests are aborted and cannot write late results',async()=>{
 const f=fixture();f.cleanup();assert.equal(f.calls[0].options.signal.aborted,true);f.calls[0].resolve({old:true});await tick();assert.equal(f.state.data,null);
});


test('pending snapshot fences old HTTP without immediately starting a duplicate read',async()=>{
 const f=fixture(true);f.pending();assert.equal(f.calls.length,1);
 f.calls[0].resolve({data:['old']});await tick();assert.equal(f.state.data,null);assert.equal(f.calls.length,1);
 f.sample({status:200,data:{data:['current']}});assert.deepEqual(f.state.data,{data:['current']});f.cleanup();
});
