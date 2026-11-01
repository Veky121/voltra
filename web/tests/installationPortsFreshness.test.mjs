import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as model from '../src/client/gamePortsModel.ts';

const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../src/client/GamePorts.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const cached={ip:'0.0.0.0',ports:[{role:'game',port:8211,preferred_port:8211}],detail:'Assigned',forwarding:{status:'mapped',detail:'Cached',routes:[{internal_port:8211,public_host:'old.example',public_port:18211,protocol:'udp',status:'mapped',detail:'Cached'}]}};

function fixture() {
  const slots=[],requests=[],effects=[],timers=new Map();
  let cursor=0,nextTimer=0,updates=0;
  const react={
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{updates++;slots[i]=typeof value==='function'?value(slots[i]):value;}];},
    useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j])))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:effect()};});},
  };
  const modules={react,'../ui/Disclosure':{Disclosure:'details',DisclosureTrigger:'summary'},'./games-ui.css':{},'./gamePorts.css':{},'./gamePortsModel':model,'../lib':{
    api(path,options){return new Promise((resolve,reject)=>requests.push({path,options,resolve,reject}));},
    Button:'button',ErrorBox:'div',rows:r=>r.data.map(row=>row.attributes),unwrap:r=>r.attributes,
  }};
  const module={exports:{}};
  new Function('require','module','exports','sessionStorage','setTimeout','clearTimeout',compiled)(
    name=>Object.hasOwn(modules,name)?modules[name]:require(name),module,module.exports,
    {getItem:()=>JSON.stringify(cached),removeItem(){}},
    callback=>{const id=++nextTimer;timers.set(id,callback);return id;},id=>timers.delete(id),
  );
  return {
    requests,
    render(){cursor=0;const tree=module.exports.InstallationPortsNotice({identifier:'fixture'});return tree?.props.children[0]?.props.plan;},
    commit(){while(effects.length)effects.shift()();},
    tick(){const [id,callback]=timers.entries().next().value;timers.delete(id);callback();},
    unmount(){for(const slot of slots)slot?.cleanup?.();},
    get updates(){return updates;},
    get timers(){return timers.size;},
  };
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('actual notice distrusts cached forwarding, recovers on fresh response and clears stale success on failure',async()=>{
  const f=fixture();
  assert.equal(f.render().forwarding.status,'unknown');
  f.commit();
  assert.equal(f.requests[0].path,'/api/client/servers/fixture/proxy-routes');
  f.requests[0].resolve({data:[{attributes:{local_port:8211,public_port:28211,public_host:'fresh.example',protocol:'udp',status:'applied'}}]});
  await settle();
  const fresh=f.render();
  assert.equal(fresh.forwarding.status,'mapped');
  assert.equal(fresh.forwarding.routes[0].public_host,'fresh.example');
  f.tick();
  f.requests[1].reject(new Error('Status unavailable'));
  await settle();
  const failed=f.render();
  assert.equal(failed.forwarding.status,'unknown');
  assert.equal(failed.forwarding.routes[0].status,'unknown');
  assert.equal(failed.forwarding.routes[0].public_host,'fresh.example');
  assert.equal(cached.forwarding.status,'mapped');
  f.unmount();
  assert.equal(f.timers,0);
});

test('unmounted notice aborts its request and ignores a late refresh rejection',async()=>{
  const f=fixture();f.render();f.commit();
  f.unmount();const updates=f.updates;
  assert.equal(f.requests[0].options.signal.aborted,true);
  f.requests[0].reject(new Error('Aborted'));
  await settle();
  assert.equal(f.updates,updates);
  assert.equal(f.timers,0);
});
