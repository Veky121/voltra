import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// Bundle local TS dependencies; keep React shared with the server renderer.
const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/desktopUpdates.ts',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node',packages:'external'});
const module={exports:{}};
new Function('require','module','exports',compiled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {updateAction,startUpdateChecks,updateChannels,useDesktopUpdates}=module.exports;
test('automatic checks respect cadence and staged updates; manual actions stay available',async()=>{
 const originalFetch=globalThis.fetch,originalNow=Date.now;
 let now=10000000,requests=[],state='idle',channel='release',interval,focus;
 Date.now=()=>now;
 globalThis.document={visibilityState:'visible'};
 globalThis.window={setTimeout, setInterval:fn=>{interval=fn;return 0},addEventListener:(name,fn)=>{if(name==='focus')focus=fn},removeEventListener:()=>{}};
 globalThis.fetch=async(url,options)=>{requests.push(url);if(url.endsWith('/updates'))state='available';if(url.endsWith('/update-install'))state='ready';if(url.endsWith('/update-channel')){channel=JSON.parse(options.body).channel;state='idle'}return new Response(JSON.stringify({state,channel,version:'0.1.0',available_version:'0.2.0'}));};
 try{
  const stop=startUpdateChecks();await new Promise(resolve=>setTimeout(resolve,300));
  assert.deepEqual(requests,['/desktop/update-status','/desktop/updates']);
  interval();focus();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(requests.length,2);
  await updateAction('update-install');now+=7200000;interval();assert.equal(requests.length,3,'never overwrite staged update');
  await updateAction('update-channel',{channel:'nightly'});await updateAction('updates',{},true);assert.equal(requests.at(-1),'/desktop/updates');
  await updateAction('updates');assert.equal(requests.filter(x=>x==='/desktop/updates').length,3,'manual checks bypass cadence');
  stop();
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;delete globalThis.window;delete globalThis.document;}
});

test('channel choices expose only canonical Release and Nightly',()=>{
 assert.deepEqual(updateChannels,[{value:'release',label:'Release'},{value:'nightly',label:'Nightly'}]);
});


test('failed restart publishes authoritative staged state and permits retry',async()=>{
 const {createElement}=await import('react');
 const {renderToStaticMarkup}=await import('react-dom/server');
 let observed;
 function Probe(){observed=useDesktopUpdates();return null;}
 const originalFetch=globalThis.fetch;
 let fail=true;
 globalThis.fetch=async()=>new Response(JSON.stringify({channel:'nightly',state:fail?'ready':'error',version:'1.0.0',available_version:'2.0.0',error:fail?'Restart failed; retry.':'Staging lost.'}),{status:409});
 try{
  assert.equal(await updateAction('update-restart'),false);
  renderToStaticMarkup(createElement(Probe));
  assert.equal(observed.status.state,'ready');assert.equal(observed.status.error,'Restart failed; retry.');assert.equal(observed.busy,false);
  fail=false;await updateAction('update-restart');renderToStaticMarkup(createElement(Probe));
  assert.equal(observed.status.state,'error','must replace stale ready state');
  assert.equal(observed.error,'Staging lost.');
 }finally{globalThis.fetch=originalFetch;}
});

test('nightly display is compact without changing release or beta identifiers',()=>{
 const {formatDesktopVersion}=module.exports;
 assert.equal(formatDesktopVersion('v0.1.0-nightly.20261106.48'),'0.1.0-20261106.48');
 assert.equal(formatDesktopVersion('0.1.0-nightly.20261106.48'),'0.1.0-20261106.48');
 assert.equal(formatDesktopVersion('v0.1.0-beta.2'),'0.1.0-beta.2');
 assert.equal(formatDesktopVersion('0.1.0'),'0.1.0');
});

test('automatic and manual operations expose busy state and prevent duplicate requests',async()=>{
 const {createElement}=await import('react');
 const {renderToStaticMarkup}=await import('react-dom/server');
 let observed,finish,calls=0;
 function Probe(){observed=useDesktopUpdates();return null;}
 const originalFetch=globalThis.fetch;
 globalThis.fetch=()=>{
  calls++;
  return new Promise(resolve=>{
   finish=()=>resolve(Response.json({channel:'nightly',state:'up-to-date',version:'0.1.0'}));
  });
 };
 try{
  for(const operation of ['update-status','updates','update-install','update-restart']){
   const pending=updateAction(operation);
   renderToStaticMarkup(createElement(Probe));
   assert.equal(observed.busy,true);
   assert.equal(observed.operation,operation);
   const before=calls;
   assert.equal(await updateAction('updates'),false);
   assert.equal(calls,before);
   finish();await pending;
   renderToStaticMarkup(createElement(Probe));
   assert.equal(observed.busy,false);
   assert.equal(observed.operation,null);
  }
 }finally{globalThis.fetch=originalFetch;}
});
