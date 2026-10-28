import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/client/Overview.tsx',import.meta.url),'utf8');
const hook=source.slice(source.indexOf('function useOverview()'),source.indexOf('\nfunction Meter'));
const compiled=ts.transpile(hook,{target:ts.ScriptTarget.ES2022});
const settle=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
const stats={attributes:{current_state:'running',resources:{cpu_absolute:42}}};
function harness(count,resource){
 let effect,visibility,now=20000,id=0,servers=[],writes=0;
 let states=Array.from({length:count},(_,i)=>({uuid:`u${i}`,identifier:`s${i}`,name:'Original',status:null}));
 const timers=new Map(),requests=[],signals=[];
 const document={hidden:false,addEventListener:(_,fn)=>visibility=fn,removeEventListener(){}};
 const api=async(path,options)=>{
  requests.push(path);
  if(path.includes('summary=overview'))return {data:states.map(s=>({attributes:s}))};
  signals.push(options.signal);
  return resource(path,options.signal);
 };
 const run=new Function('useState','useEffect','api','items','value','document','setTimeout','clearTimeout','Date',compiled+';return useOverview();');
 let stateIndex=0;
 run(initial=>{const index=stateIndex++;return [initial,value=>{if(index===0){servers=value;writes++;}}];},fn=>effect=fn,api,r=>r.data.map(s=>s.attributes),r=>r.attributes,document,(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;},key=>timers.delete(key),{now:()=>now});
 const cleanup=effect();
 return {requests,signals,timers,cleanup,get servers(){return servers;},get writes(){return writes;},setStates(value){states=value;},get states(){return states;},
  async advance(ms){const end=now+ms;await settle();while(true){const next=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await settle();}now=end;await settle();},
  async hidden(value){document.hidden=value;visibility();await settle();},
 };
}
test('four stalled workers time out, allowing a healthy queued server while states keep polling',async()=>{
 const h=harness(5,path=>path.includes('/s4/')?Promise.resolve(stats):new Promise(()=>{}));
 await h.advance(0);
 assert.equal(h.signals.length,4);
 await h.advance(1000);
 assert.equal(h.requests.filter(p=>p.includes('states=1')).length,1);
 h.setStates(h.states.map(s=>s.uuid==='u1'?{...s,status:'suspended'}:s));
 await h.advance(1000);
 assert.equal(h.servers.find(s=>s.uuid==='u1').liveState,'suspended');
 await h.advance(1050);
 assert.equal(h.servers.find(s=>s.uuid==='u4').resources.cpu_absolute,42);
 assert.equal(h.servers.find(s=>s.uuid==='u1').liveState,'suspended');
 assert.ok(h.signals.slice(0,4).every(s=>s.aborted));
 h.cleanup();await settle();assert.equal(h.timers.size,0);
});
test('removed membership and newer lifecycle cannot be overwritten by deferred resources',async()=>{
 const deferred=[];
 const h=harness(4,()=>new Promise(resolve=>deferred.push(resolve)));
 await h.advance(0);
 h.setStates(h.states.slice(1).map(s=>s.uuid==='u1'?{...s,status:'installing'}:s));
 await h.advance(1000);
 assert.deepEqual(h.servers.map(s=>s.uuid),['u1','u2','u3']);
 assert.equal(h.servers[0].liveState,'installing');
 deferred.forEach(resolve=>resolve(stats));await h.advance(50);
 assert.equal(h.servers.some(s=>s.uuid==='u0'),false);
 assert.equal(h.servers[0].liveState,'installing');
 assert.equal(h.servers[0].resources,undefined);
 assert.equal(h.servers[1].resources.cpu_absolute,42);
 h.cleanup();await settle();assert.equal(h.timers.size,0);
});
test('healthy results flush before another worker finishes; hidden tabs cancel and clear timers',async()=>{
 const h=harness(4,path=>path.includes('/s0/')?Promise.resolve(stats):new Promise(()=>{}));
 await h.advance(50);
 assert.equal(h.servers[0].liveState,'running');
 assert.equal(h.signals.length,4);
 await h.hidden(true);
 assert.ok(h.signals.slice(1).every(s=>s.aborted));
 assert.equal(h.timers.size,0);
 const count=h.requests.length;await h.advance(10000);assert.equal(h.requests.length,count);
 await h.hidden(false);await h.advance(0);
 assert.equal(h.requests.filter(p=>p.includes('per_page=100')).length,2);
 h.cleanup();await settle();assert.equal(h.timers.size,0);
});
test('metadata retains slower cadence and resources publish as a batch',async()=>{
 const h=harness(7,()=>Promise.resolve(stats));
 await h.advance(50);
 assert.equal(h.servers.filter(s=>s.liveState==='running').length,7);
 assert.equal(h.writes,2);
 await h.advance(14000);
 assert.equal(h.requests.filter(p=>p.includes('per_page=100')).length,1);
 await h.advance(1000);
 assert.equal(h.requests.filter(p=>p.includes('per_page=100')).length,2);
 h.cleanup();await settle();assert.equal(h.timers.size,0);
});
