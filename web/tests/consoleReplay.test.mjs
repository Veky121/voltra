import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {ConsoleReplayOverlap,collectorLineKey} from '../src/client/consoleReplay.ts';
import {emptyConsoleHistory,appendConsoleHistory,consoleHistoryText} from '../src/client/consoleHistory.ts';
import {ConsoleLineQueue,CONSOLE_QUEUE_FRAME_MS} from '../src/client/consoleQueue.ts';
import {consoleOutput} from '../src/client/consoleOutput.ts';
import {consoleStateLine} from '../src/client/consoleLifecycle.ts';
import {consoleRunID,consoleRunChanged} from '../src/client/consoleRun.ts';

function fixture() {
  const effects=[], timers=new Map(), requests=[], sockets=[];
  const doc=Object.assign(new EventTarget(),{hidden:false});
  let history=emptyConsoleHistory(), nextTimer=0, cleanup, subscriber, fresh=false;
  const react={useEffect:fn=>effects.push(fn),useRef:current=>({current}),useState:initial=>{
    let state=typeof initial==='function'?initial():initial;
    return [state,update=>{state=typeof update==='function'?update(state):update;if(initial===emptyConsoleHistory)history=state;}];
  }};
  class Socket {
    sent=[];
    constructor(){sockets.push(this);}
    send(text){this.sent.push(JSON.parse(text));}
    close(){}
    emit(event,line){this.onmessage({data:JSON.stringify({event,args:[line]})});}
  }
  const api=path=>new Promise((resolve,reject)=>requests.push({path,resolve,reject}));
  const modules={react,'../hooks/liveEvents':{observeLivePath:(_path,fn)=>{subscriber=fn;return()=>{subscriber=undefined}},isLivePathFresh:()=>fresh},'../notifications/useErrorState':{useErrorState:()=>react.useState('')},'react/jsx-runtime':{jsx:()=>null,jsxs:()=>null},'../lib':{api},'./ServerDashboard':{useServerTelemetry:()=>({state:'unknown'})},'./consoleHistory':{emptyConsoleHistory,appendConsoleHistory},'./consoleQueue':{ConsoleLineQueue,CONSOLE_QUEUE_FRAME_MS},'./consoleReplay':{ConsoleReplayOverlap},'./consoleOutput':{consoleOutput},'./consoleLifecycle':{consoleStateLine},'./serverPower':{consolePowerEvent:'power'},'./common':{useServer:()=>({base:'/server',server:{},permissions:[]}),useAction:()=>({}),value:r=>r}};
  const code=ts.transpileModule(readFileSync(new URL('../src/client/Console.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  modules['./consoleRun']={consoleRunID,consoleRunChanged};
  const exports={};
  new Function('require','exports','window','document','WebSocket','location','setTimeout','clearTimeout',code)(name=>modules[name]??{},exports,{matchMedia:()=>({matches:true}),addEventListener(){},removeEventListener(){}},doc,Socket,{href:'http://localhost'},(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay});return id;},id=>timers.delete(id));
  exports.default();
  for(const effect of effects){const result=effect();if(result)cleanup=result;}
  const tick=async()=>{await Promise.resolve();await Promise.resolve();};
  const run=async delay=>{for(const [id,timer] of [...timers])if(timer.delay===delay){timers.delete(id);timer.fn();}await tick();};
  const respond=async data=>{const request=requests.find(r=>r.path.includes('console-history'));assert.ok(request);requests.splice(requests.indexOf(request),1);request.resolve(data);await tick();await run(0);};
  return {requests,sockets,run,respond,tick,visibility:hidden=>{doc.hidden=hidden;doc.dispatchEvent(new Event('visibilitychange'))},setFresh:value=>{fresh=value},emit:data=>subscriber?.({status:200,data}),text:()=>consoleHistoryText(history),cleanup:()=>cleanup()};
}
const entry=line=>({event:'console output',line});

test('deferred recovery includes disconnected output, suppresses live copies, resumes saved cursor',async()=>{
  const f=fixture();
  try {
    const ws=f.requests.find(r=>r.path.endsWith('/websocket'));ws.resolve({socket:'ws://localhost',token:'test'});await f.tick();
    const socket=f.sockets[0];socket.emit('auth success');
    await f.respond({cursor:'10',capture:{connected:true},data:[entry('saved')]});
    await f.run(1000);
    const failure=f.requests.find(r=>r.path.includes('console-history'));failure.reject(new Error('unavailable'));f.requests.splice(f.requests.indexOf(failure),1);await f.tick();
    socket.emit('console output','\x1b[31mlive\x1b[0m');socket.emit('console output','repeat');socket.emit('console output','repeat');await f.run(0);
    socket.onclose();
    await f.run(3000);
    assert.ok(f.requests.some(r=>r.path.endsWith('after=10')));
    await f.respond({cursor:'15',capture:{connected:true},more:true,data:[entry('\x1b[31mlive\x1b[0m'),entry('repeat'),entry('repeat'),entry('during disconnect'),{event:'panel message',line:'state saved'}]});
    assert.equal(f.text().split('live').length-1,1);assert.equal(f.text().split('repeat').length-1,2);
    assert.match(f.text(),/during disconnect/);assert.match(f.text(),/state saved/);assert.match(f.text(),/\x1b\[31m/);
    await f.run(10);assert.ok(f.requests.some(r=>r.path.endsWith('after=15')));
    socket.emit('console output','persistent copy');await f.run(0);assert.doesNotMatch(f.text(),/persistent copy/);
    await f.respond({cursor:'16',capture:{connected:true},data:[entry('persistent copy')]});assert.match(f.text(),/persistent copy/);
    assert.equal(socket.sent.filter(x=>x.event==='send logs').length,0);
  } finally {f.cleanup();}
});

test('reset clears provisional overlap and output; truncation is reported',async()=>{
  const f=fixture();try{
    await f.respond({cursor:'9',capture:{connected:false},data:[entry('old')]});
    await f.run(1000);
    await f.respond({reset:true,truncated:true,cursor:'2',capture:{connected:true},data:[entry('new')]});
    assert.doesNotMatch(f.text(),/old/);assert.match(f.text(),/new/);assert.match(f.text(),/Older output expired/);
  }finally{f.cleanup();}
});

test('overlap uses event and exact ANSI, preserves repeated occurrence counts, and bounds retention',()=>{
  const h=new ConsoleReplayOverlap(2,1000);
  h.record('console output','same');h.record('console output','same');
  assert.equal(h.consume('daemon message','same'),false);
  assert.equal(h.consume('console output','same'),true);
  h.record('console output','next');h.record('console output','last');
  assert.equal(h.consume('console output','same'),false);
  assert.equal(h.consume('console output','next'),true);
  h.record('console output','\x1b[31mred');assert.equal(h.consume('console output','red'),false);
  h.clear();assert.equal(h.consume('console output','last'),false);
  const small=new ConsoleReplayOverlap(100,10);small.record('console output','too long');assert.equal(small.consume('console output','too long'),false);
});


test('initial failure and deferred collector pages reconcile arrivals while a request is pending',async()=>{
  const f=fixture();try {
    const ws=f.requests.find(r=>r.path.endsWith('/websocket'));ws.resolve({socket:'ws://localhost',token:'test'});await f.tick();
    const socket=f.sockets[0];socket.emit('auth success');
    const failure=f.requests.find(r=>r.path.includes('console-history'));failure.reject(new Error('temporary'));f.requests.splice(f.requests.indexOf(failure),1);await f.tick();
    socket.emit('console output','first');await f.run(0);
    await f.run(3000);socket.emit('console output','arrived during request');await f.run(0);
    await f.respond({cursor:'1',more:true,capture:{connected:false},data:[entry('first')]});
    await f.run(10);
    await f.respond({cursor:'2',capture:{connected:true},data:[entry('arrived during request'),entry('missed by socket')]});
    assert.equal(f.text().split('first').length-1,1);
    assert.equal(f.text().split('arrived during request').length-1,1);
    assert.match(f.text(),/missed by socket/);
  }finally{f.cleanup();}
});

test('legacy 404 still requests the Wings tail and displays state events',async()=>{
  const f=fixture();try{
    const ws=f.requests.find(r=>r.path.endsWith('/websocket'));ws.resolve({socket:'ws://localhost',token:'test'});await f.tick();
    const socket=f.sockets[0];socket.emit('auth success');
    const failure=f.requests.find(r=>r.path.includes('console-history'));failure.reject(new Error('404 page not found'));await f.tick();
    assert.equal(socket.sent.filter(x=>x.event==='send logs').length,1);
    socket.emit('status','running');socket.emit('console output','legacy line');await f.run(0);
    assert.match(f.text(),/Current server state: running/);assert.match(f.text(),/legacy line/);
  }finally{f.cleanup();}
});


test('saved-first fallback output consumes its delayed socket occurrence',async()=>{
 const f=fixture();try{
  f.requests.find(r=>r.path.endsWith('/websocket')).resolve({socket:'ws://localhost',token:'test'});await f.tick();f.sockets[0].emit('auth success');
  await f.respond({cursor:'1',capture:{connected:false},data:[entry('saved first')]});
  f.sockets[0].emit('console output','saved first');await f.run(0);
  assert.equal(f.text().split('saved first').length-1,1);
 }finally{f.cleanup();}
});
test('overlap matches collector byte truncation at multibyte boundaries',()=>{
 const live='x'.repeat(16383)+'\u{1f30d}'.repeat(20);
 const saved='x'.repeat(16383)+' [line truncated by Voltra]';
 assert.equal(collectorLineKey(live),saved);assert.equal(collectorLineKey(saved),saved);
 const h=new ConsoleReplayOverlap();h.record('console output',live);
 assert.equal(h.consume('console output',saved),true);
 h.record('console output',saved);assert.equal(h.consume('console output',live),true);
});


test('healthy saved-log socket suppresses HTTP polling and deduplicates overlapping IDs',async()=>{
 const f=fixture();try{
  await f.respond({cursor:'10',capture:{connected:true},data:[{...entry('initial'),id:'10'}]});f.setFresh(true);
  for(let i=0;i<60;i++)await f.run(1000);
  assert.equal(f.requests.filter(r=>r.path.includes('console-history')).length,0);
  f.emit({after:'10',head:'13',cursor:'13',capture:{connected:true},data:[{...entry('same'),id:'12'},{...entry('same'),id:'13'}]});await f.run(0);
  f.emit({after:'10',head:'13',cursor:'13',capture:{connected:true},data:[{...entry('same'),id:'12'},{...entry('same'),id:'13'}]});await f.run(0);
  assert.equal(f.text().split('same').length-1,2);
  f.setFresh(false);await f.run(1000);assert.ok(f.requests.some(r=>r.path.endsWith('after=13')));
 }finally{f.cleanup()}
});

test('missed socket batches recover through HTTP and drain pages while socket stays fresh',async()=>{
 const f=fixture();try{
  await f.respond({cursor:'10',capture:{connected:true},data:[entry('initial')]});f.setFresh(true);
  f.emit({after:'15',head:'20',cursor:'20',capture:{connected:true},data:[]});
  assert.ok(f.requests.some(r=>r.path.endsWith('after=10')));
  await f.respond({cursor:'16',more:true,capture:{connected:true},data:[entry('recovered')]});
  await f.run(10);assert.ok(f.requests.some(r=>r.path.endsWith('after=16')));
  await f.respond({cursor:'20',capture:{connected:true},data:[entry('last page')]});
  assert.match(f.text(),/recovered/);assert.match(f.text(),/last page/);
  f.emit({after:'2',head:'2',cursor:'2',capture:{connected:true},data:[]});
  assert.ok(f.requests.some(r=>r.path.endsWith('after=20')));
  await f.respond({reset:true,cursor:'2',capture:{connected:true},data:[entry('new history')]});
  assert.doesNotMatch(f.text(),/initial/);assert.match(f.text(),/new history/);
 }finally{f.cleanup()}
});


test('hidden console pauses HTTP fallback and recovers on return',async()=>{
 const f=fixture();try{
  await f.respond({cursor:'10',capture:{connected:true},data:[]});f.visibility(true);
  for(let i=0;i<60;i++)await f.run(1000);
  assert.equal(f.requests.filter(r=>r.path.includes('console-history')).length,0);
  f.visibility(false);assert.ok(f.requests.some(r=>r.path.endsWith('after=10')));
 }finally{f.cleanup()}
});


test('new run reloads the retained tail for an already connected console',async()=>{
  const f=fixture();
  try{
    await f.respond({run_start:'0',cursor:'600',capture:{connected:true},data:[entry('old unwanted output'),entry('final crash diagnostic')]});
    f.setFresh(true);
    f.emit({run_start:'601',after:'600',head:'603',cursor:'603',capture:{connected:true},data:[{id:'601',event:'panel message',line:'New run.'},{id:'603',...entry('fresh startup')}]});
    await f.tick();
    assert.ok(f.requests.some(r=>r.path.endsWith('console-history?after=0')));
    await f.respond({run_start:'601',cursor:'603',capture:{connected:true},data:[entry('final crash diagnostic'),{event:'panel message',line:'New run.'},entry('fresh startup')]});
    assert.doesNotMatch(f.text(),/old unwanted/);
    assert.match(f.text(),/final crash diagnostic/);
    assert.match(f.text(),/fresh startup/);
    assert.equal(f.text().split('New run.').length-1,1);
    await f.run(1000);
    assert.equal(f.requests.filter(r=>r.path.includes('console-history')).length,0);
  }finally{f.cleanup()}
});

test('HTTP fallback detects a new run without a socket and reloads once',async()=>{
  const f=fixture();
  try{
    await f.respond({run_start:'10',cursor:'50',capture:{connected:true},data:[entry('old unwanted')]});
    await f.run(1000);
    await f.respond({run_start:'51',cursor:'52',capture:{connected:true},data:[entry('fresh startup')]});
    await f.run(10);
    assert.ok(f.requests.some(r=>r.path.endsWith('console-history?after=0')));
    await f.respond({run_start:'51',cursor:'52',capture:{connected:true},data:[entry('previous tail'),entry('fresh startup')]});
    assert.equal(f.text(),'previous tail\nfresh startup');
    await f.run(1000);
    assert.ok(f.requests.some(r=>r.path.endsWith('console-history?after=52')));
  }finally{f.cleanup()}
});
