import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as operations from '../src/client/operationEvents.ts';
import * as transfers from '../src/client/remoteTransferModel.ts';

function fixture(permissions){
  const states=[],effects=[],requests=[],sockets=[],timers=new Map(),window=new EventTarget();let next=0;
  const react={createContext:()=>({}),useContext:()=>null,useRef:current=>({current}),useEffect:fn=>effects.push(fn),useState:initial=>{const index=states.length;states.push(initial);return [initial,update=>{states[index]=typeof update==='function'?update(states[index]):update}];}};
  class Socket{sent=[];constructor(){sockets.push(this)}send(raw){this.sent.push(JSON.parse(raw))}close(){this.onclose?.()}emit(event,line){this.onmessage({data:JSON.stringify({event,args:[line]})})}}
  const api=async path=>{requests.push(path);return path.endsWith('/websocket')?{socket:'ws://localhost',token:'fixture'}:{transfers:[]}};
  const modules={react,'./operationEvents':operations,'./remoteTransferModel':transfers,'../lib':{api},'../notifications/store':{captureErrorContext:()=>({}),reportPanelError:()=>{}},'./common':{can:(list,p)=>list.includes('*')||list.includes(p),value:x=>x}};
  const code=ts.transpileModule(readFileSync(new URL('../src/client/useRemoteTransfers.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={},timer=(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id},clear=id=>timers.delete(id);
  new Function('require','exports','window','WebSocket','location','setTimeout','clearTimeout','setInterval','clearInterval',code)(name=>modules[name]??{},exports,window,Socket,{href:'http://localhost'},timer,clear,timer,clear);
  exports.useRemoteTransferQueue('/server/fixture',permissions,()=>{});
  const cleanup=effects.map(effect=>effect()).filter(Boolean);
  return {requests,sockets,timers,events:()=>states[2],tick:async()=>{for(let i=0;i<5;i++)await Promise.resolve()},reset:()=>window.dispatchEvent(new Event('panel-auth-changed')),cleanup:()=>cleanup.forEach(fn=>fn())};
}
const report=(patch={})=>operations.operationPrefix+JSON.stringify({v:1,id:'fixture',sequence:1,at:new Date().toISOString(),source:'fixture',state:'running',phase:'download',code:'DOWNLOAD_RECEIVING',bytes:5,total:null,...patch});

test('authorized existing transfer socket requests replay and keeps script reports independent of file reconciliation',async()=>{
  const f=fixture(['file.read','websocket.connect']);try{
    await f.tick();assert.equal(f.sockets.length,1);const socket=f.sockets[0];socket.emit('auth success');
    assert.equal(socket.sent.filter(x=>x.event==='send logs').length,1);
    socket.emit('console output',report());assert.equal(f.events().length,1);
    for(const timer of f.timers.values())if(timer.delay===5000)timer.fn();await f.tick();assert.equal(f.events().length,1);
    socket.emit('console output',report({sequence:2,state:'completed',code:'DOWNLOAD_COMPLETE'}));
    socket.emit('console output',report());assert.equal(f.events()[0].state,'completed');
    f.reset();assert.equal(f.events().length,0);socket.emit('console output',report({id:'late'}));assert.equal(f.events().length,0);
  }finally{f.cleanup()}
});
test('file-only users never acquire console socket or replay; console-only users never fetch file data',async()=>{
  const files=fixture(['file.read']),consoleOnly=fixture(['websocket.connect']);try{
    await files.tick();await consoleOnly.tick();assert.equal(files.sockets.length,0);assert.ok(files.requests.every(path=>!path.endsWith('/websocket')));
    assert.equal(consoleOnly.sockets.length,1);assert.deepEqual(consoleOnly.requests,['/server/fixture/websocket']);assert.equal(consoleOnly.timers.size,0);
  }finally{files.cleanup();consoleOnly.cleanup()}
});
test('stale socket callbacks and unsupported message types cannot add script reports',async()=>{
  const f=fixture(['websocket.connect']);try{
    await f.tick();const socket=f.sockets[0];socket.emit('daemon message',report());assert.equal(f.events().length,0);
    socket.close();socket.emit('console output',report());assert.equal(f.events().length,0);
  }finally{f.cleanup()}
});
test('stale or future-dated pending reports never imply active progress',()=>{
  const now=Date.now(),event=operations.parseOperationEvent(report());
  assert.ok(operations.operationRecentlyActive(event,now));
  assert.equal(operations.operationRecentlyActive(event,now+31000),false);
  assert.equal(operations.operationRecentlyActive({...event,at:new Date(now+120000).toISOString()},now),false);
  assert.equal(operations.operationPending({...event,at:new Date(now-60000).toISOString()}),true);
});


test('healthy idle socket does not trigger five-second snapshot requests',async()=>{
 const f=fixture(['file.read','websocket.connect']);try{
  await f.tick();f.sockets[0].emit('auth success');await f.tick();const before=f.requests.length;
  for(const timer of f.timers.values())if(timer.delay===5000)timer.fn();await f.tick();
  assert.equal(f.requests.length,before);
 }finally{f.cleanup()}
});
