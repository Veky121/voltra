import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as model from '../src/client/gameSetupModel.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/client/GameQuickSetup.tsx', import.meta.url), 'utf8') + '\nexport {QuickSetupContent};';
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX}}).outputText;

function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}

function fixture({permissions=['*'], state='offline', reply}={}) {
  const fields = [
    {key:'ServerName', label:'Name', type:'text', value:'Before'},
    {key:'ServerPassword', label:'Password', type:'text', value:null, secret:true, configured:true},
    {key:'AdminPassword', label:'Admin', type:'text', value:null, secret:true, configured:true},
    {key:'LargeValue', label:'Large', type:'number', value:'9007199254740993123'},
  ];
  const data = {game:'native', file:'/server.json', fields, requires_stop:true, revision:'original-revision', documents:[], folders:[], help:[]};
  const slots=[], calls=[];
  let cursor=0, pendingChange;
  const react = {
    useState(initial) {const i=cursor++; if (!(i in slots)) slots[i]=initial; return [slots[i], value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
    useRef(initial) {const i=cursor++; if (!(i in slots)) slots[i]={current:initial}; return slots[i];},
    useEffect() {},
  };
  const modules = {'./PendingSettings':{PendingSettings:({children})=>children,usePendingSetting:(_key,_dirty,change)=>{pendingChange=change;}},
    react,
    'react-router-dom':{},
    '../lib':{api:async(path, options)=>{calls.push({path, ...options, payload:JSON.parse(options.body)}); return reply ? reply() : {attributes:{...data, revision:'saved-revision'}};}, unwrap:r=>r.attributes, Button:'button', Card:'section', ErrorBox:'div', Input:'input', Select:'select'},
    './common':{can:(p,v)=>p.includes('*')||p.includes(v), json:(method,body)=>({method,body:JSON.stringify(body)}), useServer:()=>({base:'/api/client/servers/fixture',permissions,server:{status:''}})},
    './gameSetupModel':model,
    './ServerDashboard':{useServerTelemetry:()=>({state,updated:1,error:''})},
    './GameSettingsFields':{GameSettingsFields:'settings-fields'},
    './ServerStartup':{}, './useGameRequest':{},
    './games-ui.css':{}, './steamGames.css':{},
  };
  const module={exports:{}};
  new Function('require','module','exports',compiled)(name=>Object.hasOwn(modules,name)?modules[name]:require(name),module,module.exports);
  const render=()=>{cursor=0;return module.exports.QuickSetupContent({data,search:'',onSaved(){},onDirty(){}});};
  return {
    calls,
    change(key,value) {find(render(),node=>node.type==='settings-fields').props.onChange(key,value);},
    save() {render();return pendingChange.save();},
  };
}

test('native settings save omits untouched credentials and unchanged numeric lexemes', async()=>{
  const f=fixture();
  f.change('ServerName','After');
  f.change('LargeValue','9007199254740993123');
  await f.save();
  assert.equal(f.calls.length,1);
  assert.deepEqual(f.calls[0].payload,{settings:{ServerName:'After'},revision:'original-revision'});
});

test('native settings save preserves explicit clear intent and large-number precision', async()=>{
  const f=fixture();
  f.change('ServerPassword','');
  f.change('LargeValue','9007199254740993124');
  await f.save();
  assert.deepEqual(f.calls[0].payload.settings,{ServerPassword:'',LargeValue:'9007199254740993124'});
  assert.equal(Object.hasOwn(f.calls[0].payload.settings,'AdminPassword'),false);
});

test('native settings save sends nothing while running, read-only, unchanged or already submitting', async()=>{
  for (const options of [{state:'running'},{permissions:['file.read-content']}]) {
    const f=fixture(options);f.change('ServerName','After');await f.save();assert.equal(f.calls.length,0);
  }
  const unchanged=fixture();await unchanged.save();assert.equal(unchanged.calls.length,0);
  let complete;
  const f=fixture({reply:()=>new Promise(resolve=>{complete=resolve;})});
  f.change('ServerName','After');const pending=f.save();await f.save();assert.equal(f.calls.length,1);
  complete({attributes:{fields:[],revision:'next'}});await pending;
});
