import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../src/client/ServerDashboard.tsx',import.meta.url),'utf8')+'\nexport {useTelemetry};';
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function fixture(){
  const slots=[],effects=[],requests=[],timers=new Map();let cursor=0,timer=0;
  const document={hidden:false,addEventListener(){},removeEventListener(){}};
  const schedule=callback=>{const id=++timer;timers.set(id,callback);return id;};
  const cancel=id=>timers.delete(id);
  const pollingSource=readFileSync(new URL('../src/hooks/visiblePoll.ts',import.meta.url),'utf8');
  const polling=ts.transpile(pollingSource,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
  const pollingModule={exports:{}};
  new Function('exports','document','setTimeout','clearTimeout',polling)(pollingModule.exports,document,schedule,cancel);
  const react={createContext:()=>({}),useContext:()=>({}),useRef:initial=>({current:initial}),
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
    useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:effect()};});}};
  const modules={react,'../lib':{api:(path,options)=>new Promise((resolve,reject)=>requests.push({path,options,resolve,reject}))},'./common':{value:r=>r},'../hooks/liveEvents':{observeLivePath:()=>()=>{},isLivePathFresh:()=>false},'../hooks/visiblePoll':pollingModule.exports};
  const module={exports:{}};
  new Function('require','module','exports','setTimeout','clearTimeout','document',compiled)(name=>Object.hasOwn(modules,name)?modules[name]:name==='react/jsx-runtime'?require(name):{},module,module.exports,schedule,cancel,document);
  return {requests,render(base,enabled=true){cursor=0;return module.exports.useTelemetry(base,enabled);},commit(){while(effects.length)effects.shift()();},unmount(){for(const s of slots)s?.cleanup?.();}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const running={current_state:'running',resources:{memory_bytes:2048,uptime:9000}};

test('changing server identity hides old state and resources before the new request completes',async()=>{
  const f=fixture();f.render('/server/first');f.commit();f.requests[0].resolve(running);await settle();
  assert.equal(f.render('/server/first').state,'running');
  const switched=f.render('/server/second');
  assert.equal(switched.state,'unknown');assert.equal(switched.updated,0);assert.deepEqual(switched.resources,{});assert.deepEqual(switched.samples,[]);
  f.commit();f.requests[1].resolve({current_state:'offline',resources:{}});await settle();
  const current=f.render('/server/second');assert.equal(current.state,'offline');assert.equal(current.samples.length,1);
  f.unmount();
});

test('late replies from an abandoned server cannot replace current server telemetry',async()=>{
  const f=fixture();f.render('/server/first');f.commit();
  f.render('/server/second');f.commit();assert.equal(f.requests[0].options.signal.aborted,true);
  f.requests[0].resolve(running);await settle();assert.equal(f.render('/server/second').updated,0);
  f.requests[1].resolve({current_state:'starting',resources:{uptime:1}});await settle();assert.equal(f.render('/server/second').state,'starting');
  f.unmount();
});

test('disabled telemetry clears stale readiness before installation polling resumes',async()=>{
  const f=fixture();f.render('/server/first');f.commit();f.requests[0].resolve(running);await settle();
  assert.equal(f.render('/server/first').state,'running');
  assert.equal(f.render('/server/first',false).updated,0);f.commit();
  assert.equal(f.render('/server/first',true).updated,0);f.commit();
  f.requests[1].reject(new Error('Node unavailable'));await settle();
  const failed=f.render('/server/first');assert.equal(failed.state,'unknown');assert.equal(failed.updated,0);assert.match(failed.error,/Node unavailable/);
  f.unmount();
});
