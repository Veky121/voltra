import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const result=await build({
  entryPoints:[fileURLToPath(new URL('../src/hooks/useAPIRequest.ts',import.meta.url))],
  bundle:true,write:false,format:'esm',platform:'node',
  plugins:[{name:'hook-fixture',setup(build){
    build.onResolve({filter:/^react$/},()=>({path:'react',namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:
      ['useState','useEffect','useCallback','useRef'].map(name=>`export const ${name}=(...args)=>globalThis.__apiRequestFixture.${name}(...args);`).join('\n'),loader:'js'}));
  }}],
});
const {useAPIRequest}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

// Exercise the hook's public state transitions with deferred network responses.
// The browser receipt separately runs these transitions with React DOM.
function fixture(initialPath='/one') {
  let path=initialPath,index=0,pending=false,effects=[];
  const hooks=[],requests=[],renders=[];
  const changed=(old,deps)=>!old||deps.some((value,i)=>!Object.is(value,old.deps[i]));
  const f={requests,renders,value:null,
    useState(initial){
      const slot=index++;
      if(!hooks[slot])hooks[slot]={value:typeof initial==='function'?initial():initial};
      return [hooks[slot].value,next=>{hooks[slot].value=typeof next==='function'?next(hooks[slot].value):next;pending=true;}];
    },
    useRef(initial){return f.useState(()=>({current:initial}))[0];},
    useCallback(callback,deps){
      const slot=index++;
      if(changed(hooks[slot],deps))hooks[slot]={value:callback,deps};
      return hooks[slot].value;
    },
    useEffect(effect,deps){
      const slot=index++,previous=hooks[slot];
      if(changed(previous,deps)){
        const hook={deps,cleanup:previous?.cleanup};hooks[slot]=hook;
        effects.push(()=>{hook.cleanup?.();hook.cleanup=effect();});
      }
    },
    render(nextPath=path){
      path=nextPath;
      do {
        pending=false;index=0;globalThis.__apiRequestFixture=f;
        f.value=useAPIRequest(path,request);renders.push({path,...f.value});
        const run=effects;effects=[];for(const effect of run)effect();
      } while(pending);
      return f.value;
    },
    async settle(){await new Promise(resolve=>setImmediate(resolve));return f.render();},
    unmount(){for(const hook of hooks)hook.cleanup?.();},
  };
  function request(path,options){
    return new Promise((resolve,reject)=>requests.push({path,signal:options?.signal,resolve,reject}));
  }
  f.render();return f;
}

test('a changed URL never renders the previous resource, even before effects run',async()=>{
  const f=fixture();f.requests[0].resolve({server:'one',permissions:['*']});await f.settle();
  assert.equal(f.value.data.server,'one');const stableReload=f.value.reload;
  f.render('/two');
  assert(f.renders.filter(r=>r.path==='/two').every(r=>r.data===null&&r.loading));
  assert.equal(f.value.reload,stableReload);assert.equal(f.requests[0].signal.aborted,true);
  f.requests[1].resolve({server:'two',permissions:[]});await f.settle();
  assert.deepEqual(f.value.data,{server:'two',permissions:[]});f.unmount();
});

test('late responses cannot replace the active resource and unmount aborts requests',async()=>{
  const f=fixture();f.render('/two');
  f.requests[1].resolve({server:'two'});await f.settle();
  f.requests[0].resolve({server:'one'});await f.settle();
  assert.equal(f.value.data.server,'two');f.unmount();
  assert(f.requests.every(request=>request.signal.aborted));
});

test('polling coalesces refreshes and publishes a slow response before refreshing again',async()=>{
  const f=fixture();
  f.value.reload();f.value.reload();f.value.reload();
  assert.equal(f.requests.length,1);
  f.requests[0].resolve({version:1});await f.settle();
  assert.equal(f.requests.length,2);assert.deepEqual(f.value.data,{version:1});
  assert.equal(f.value.loading,true);
  f.requests[1].resolve({version:2});await f.settle();
  assert.equal(f.requests.length,2);assert.deepEqual(f.value.data,{version:2});
  assert.equal(f.value.loading,false);f.unmount();
});

test('same-resource refresh preserves data and a failed refresh reports its error',async()=>{
  const f=fixture();f.requests[0].resolve({version:1});await f.settle();
  f.value.reload();f.render();
  assert.deepEqual(f.value.data,{version:1});assert.equal(f.value.loading,true);
  f.requests[1].reject(new Error('Connection lost'));await f.settle();
  assert.deepEqual(f.value.data,{version:1});assert.equal(f.value.error,'Connection lost');
  assert.equal(f.value.loading,false);
  f.value.reload();f.render();assert.equal(f.value.error,'');f.unmount();
});

test('disabling a query immediately clears old errors and data and prevents reloads',async()=>{
  const f=fixture();f.requests[0].reject(new Error('Not allowed'));await f.settle();
  f.render(null);f.value.reload();
  assert(f.renders.filter(r=>r.path===null).every(r=>r.data===null&&r.error===''&&!r.loading));
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].signal.aborted,true);
  f.render('/three');assert.equal(f.requests.length,2);f.unmount();
});

test('a disabled query makes no request and a queued refresh cannot follow a URL change',async()=>{
  const f=fixture(null);f.value.reload();assert.equal(f.requests.length,0);
  f.render('/one');f.value.reload();f.render('/two');
  f.requests[0].resolve({server:'one'});await f.settle();
  assert.equal(f.requests.length,2);assert.equal(f.value.data,null);
  f.requests[1].resolve({server:'two'});await f.settle();
  assert.equal(f.value.data.server,'two');f.unmount();
});
