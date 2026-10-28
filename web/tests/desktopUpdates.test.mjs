import test from 'node:test';
import assert from 'node:assert/strict';
import {updateAction,startUpdateChecks,updateChannels,useDesktopUpdates} from '../src/desktopUpdates.ts';
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
