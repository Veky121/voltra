import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:[new URL('../src/hooks/liveEvents.ts',import.meta.url).pathname.replace(/^\/(.:)/,'$1')],bundle:true,write:false,format:'esm',platform:'node'});
const {observeLiveNavigation,observeLivePath,isLivePathFresh,livePathAllowed}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('live navigation coalesces events, resyncs on reconnect, and stops at auth boundary',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const previousWindow=globalThis.window,previousSocket=globalThis.WebSocket;
  const instances=[];
  class Socket {
    constructor(url){this.url=String(url);instances.push(this)}
    close(){this.closed=true;this.onclose?.()}
    message(value){this.onmessage?.({data:JSON.stringify(value)})}
  }
  globalThis.window=Object.assign(new EventTarget(),{location:{href:'https://panel.test/'}});
  globalThis.WebSocket=Socket;
  let refreshes=0;
  const stop=observeLiveNavigation(()=>refreshes++);
  t.after(()=>{stop();globalThis.window=previousWindow;globalThis.WebSocket=previousSocket});
  const first=instances[0];assert.equal(first.url,'wss://panel.test/api/client/events');
  first.message({type:'ready',version:1});
  for(let i=0;i<50;i++)first.message({type:'navigation.invalidated',version:1});
  t.mock.timers.tick(75);assert.equal(refreshes,1);
  first.message({type:'navigation.invalidated',version:2});
  first.onmessage({data:'malformed'});t.mock.timers.tick(75);assert.equal(refreshes,1);
  first.close();t.mock.timers.tick(40000);assert.equal(instances.length,2);
  instances[1].message({type:'ready',version:1});t.mock.timers.tick(75);assert.equal(refreshes,2);
  window.dispatchEvent(new Event('panel-auth-changed'));
  assert.equal(instances[1].closed,true);t.mock.timers.tick(60000);assert.equal(instances.length,2);
});

test('topic subscriptions share one socket, fence revisions, pause hidden and fall back on disconnect',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const oldWindow=globalThis.window,oldSocket=globalThis.WebSocket,oldDocument=globalThis.document;
 const sockets=[];
 class Socket{constructor(){this.sent=[];sockets.push(this)}send(raw){this.sent.push(JSON.parse(raw))}close(){this.onclose?.()}message(packet){this.onmessage?.({data:JSON.stringify({version:1,...packet})})}}
 globalThis.window=Object.assign(new EventTarget(),{location:{href:'https://panel.test/'}});
 globalThis.document=Object.assign(new EventTarget(),{hidden:false});globalThis.WebSocket=Socket;
 const path='/api/client/servers/one/resources';const seen=[];
 const stopA=observeLivePath(path,sample=>seen.push(sample));const stopB=observeLivePath(path,()=>{});
 t.after(()=>{stopA();stopB();globalThis.window=oldWindow;globalThis.WebSocket=oldSocket;globalThis.document=oldDocument});
 assert.equal(sockets.length,1);const socket=sockets[0];socket.message({type:'ready',capabilities:['snapshots']});t.mock.timers.tick(75);
 const first=socket.sent.at(-1);assert.deepEqual(first.paths,[path]);
 socket.message({type:'snapshot',path,revision:first.revision-1,status:200,data:{old:true}});assert.equal(seen.length,0);
 socket.message({type:'snapshot',path,revision:first.revision,status:200,data:{fresh:true}});assert.equal(seen.length,1);assert.equal(isLivePathFresh(path),true);
 const late=[];const stopLate=observeLivePath(path,sample=>late.push(sample));assert.equal(late.length,1);assert.deepEqual(late[0].data,{fresh:true});stopLate();
 document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));t.mock.timers.tick(75);assert.deepEqual(socket.sent.at(-1).paths,[]);assert.equal(isLivePathFresh(path),false);
 document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));t.mock.timers.tick(75);const revision=socket.sent.at(-1).revision;
 socket.message({type:'snapshot',path,revision,status:403,data:{errors:[{detail:'revoked'}]}});assert.equal(isLivePathFresh(path),false);assert.equal(seen.at(-1).status,403);
 socket.close();assert.equal(isLivePathFresh(path),false);const stale=[];const stopStale=observeLivePath(path,sample=>stale.push(sample));assert.equal(stale.length,0);stopStale();
 assert.equal(livePathAllowed('/api/client/servers/one/console-history'),true);
 assert.equal(livePathAllowed('/api/client/servers/one/files/contents'),false);assert.equal(livePathAllowed('/api/client/servers/one/steam/private'),false);
});
