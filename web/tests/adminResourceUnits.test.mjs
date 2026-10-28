import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import * as units from '../src/resourceUnits.ts';
const require=createRequire(import.meta.url);
function load(file, mocks={}) {
  const source=readFileSync(new URL(file,import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  const modules={react:React,'react-router-dom':{Link:'a',useNavigate:()=>()=>{}},'../resourceUnits':units,'../lib':{Select:'select'},'../ui/Settings':{Switch:'input'},'./management-ui.css':{},...mocks};
  new Function('require','module','exports',compiled)(name=>Object.hasOwn(modules,name)?modules[name]:require(name),module,module.exports);
  return module.exports;
}
const shared=load('../src/admin/shared.tsx');
const fields=[shared.f('memory','Memory (GB)','number',{unit:'GB',default:8192}),shared.f('disk','Disk (GB)','number',{unit:'GB',default:10240}),shared.f('swap','Swap (GB)','number',{unit:'GB',swapSentinel:true}),shared.f('cpu','CPU (%)','number',{default:100}),shared.f('port','Port','number',{default:8080})];
const allNodes=element=>!element || typeof element!=='object'?[]:[element,...React.Children.toArray(element.props?.children).flatMap(allNodes)];
test('defaults and existing values display GB, while unrelated numbers remain unchanged',()=>{
  assert.deepEqual(shared.defaults(fields),{memory:8,disk:10,swap:0,cpu:100,port:8080});
  const draft=shared.resourceDraft(fields,{memory:8192,disk:512,swap:-1,cpu:50,port:25565});
  assert.deepEqual(draft,{memory:8,disk:0.5,swap:-1,cpu:50,port:25565});
  assert.deepEqual(shared.normalize(fields,draft),{memory:8192,disk:512,swap:-1,cpu:50,port:25565});
});
test('decimal GB rounds to integer payload, rejects invalid values and preserves sentinels',()=>{
  for(const value of ['8',8,'1.2345','0.0005',0]) {
    const result=shared.normalize(fields,{...shared.defaults(fields),memory:value});
    assert.equal(result.memory,Math.round(Number(value)*1024));
    assert.ok(Number.isInteger(result.memory));
  }
  for(const value of ['', ' ', 'no', Infinity, NaN, -1, '-0.1'])assert.throws(()=>shared.normalize(fields,{...shared.defaults(fields),memory:value}),/GB/);
  for(const value of [-0.5,-2])assert.throws(()=>shared.normalize(fields,{...shared.defaults(fields),swap:value}),/unlimited swap/);
  assert.equal(shared.normalize(fields,{...shared.defaults(fields),swap:'-1'}).swap,-1);
  assert.equal(shared.normalize(fields,{...shared.defaults(fields),swap:'0'}).swap,0);
  assert.equal(shared.normalize(fields,{...shared.defaults(fields),disk:'0'}).disk,0);
});
test('Fields renders decimal GB controls and change handler produces the correct payload',()=>{
  let value=shared.resourceDraft(fields,{memory:8192,disk:10240,swap:-1,cpu:100,port:8080});
  const tree=shared.Fields({fields,value,onChange:next=>{value=next}});
  const inputs=allNodes(tree).filter(node=>node.type==='input');
  assert.equal(inputs[0].props.value,8);
  assert.equal(inputs[0].props.step,'any');
  assert.equal(inputs[2].props.value,-1);
  assert.equal(inputs[2].props.min,-1);
  assert.equal(inputs[3].props.step,undefined);
  inputs[0].props.onChange({target:{value:'8.1254'}});
  assert.equal(shared.normalize(fields,value).memory,8320);
  const html=renderToStaticMarkup(tree);
  assert.match(html,/Memory \(GB\)/);
  assert.doesNotMatch(html,/MiB|GiB|\bMB\b/);
});
test('runtime rules load and save GB, rounding decimals and rejecting blank input',async()=>{
  let states=[],cursor=0,effects=[],calls=[];
  const react={...React,useState(initial){const index=cursor++;if(!(index in states))states[index]=initial;return [states[index],next=>{states[index]=typeof next==='function'?next(states[index]):next}]},useEffect(fn){effects.push(fn)}};
  const lib={api:async(path,options)=>{calls.push(JSON.parse(options.body));return {attributes:{rules:JSON.parse(options.body).rules}}},unwrap:value=>value.attributes,useAPI:()=>({data:{attributes:{rules:[{id:'rule',min_memory_mib:8192}]}},loading:false,error:''}),Button:'button',Card:'section',Field:'label',Input:'input',Select:'select'};
  const {MinecraftRuntimeRules}=load('../src/admin/MinecraftRuntimeRules.tsx',{react,'../lib':lib});
  const render=()=>{cursor=0;effects=[];return MinecraftRuntimeRules()};
  render();effects[0]();
  let tree=render();
  let memory=allNodes(tree).find(node=>node.type==='input'&&node.props.max===1024);
  assert.equal(memory.props.value,8);
  memory.props.onChange({target:{value:'1.2345'}});
  tree=render();
  const save=()=>allNodes(tree).find(node=>node.type==='button'&&node.props.onClick&&node.props.children==='Save runtime rules').props.onClick();
  await save();assert.equal(calls[0].rules[0].min_memory_mib,1264);
  tree=render();assert.equal(allNodes(tree).find(node=>node.type==='input'&&node.props.max===1024).props.value,1264/1024);
  memory=allNodes(tree).find(node=>node.type==='input'&&node.props.max===1024);
  memory.props.onChange({target:{value:''}});tree=render();await save();
  assert.equal(calls.length,1);assert.match(states[3],/GB/);
});
test('capacity formatting uses GB even below one GB',()=>{
  assert.equal(units.formatMiBGB(8192),'8 GB');
  assert.equal(units.formatMiBGB(512),'0.5 GB');
  assert.equal(units.formatBytesGB(1024**3),'1 GB');
});
test('node capacity and upload fields convert without changing ports or overallocation',()=>{
  const {Node}=load('../src/admin/infrastructure.tsx',{
    'react-router-dom':{useParams:()=>({id:'new'}),Link:'a'},
    './shared':{...shared,useAPI:()=>({data:null})},
    './node-pairing':{},'./infrastructure-ui.css':{},'../ui/Settings':{SettingsSection:'section'},
  });
  const specs=Node().props.fields;
  const defaults=shared.defaults(specs);
  assert.equal(defaults.upload_size,100/1024);
  const payload=shared.normalize(specs,{...defaults,memory:8,disk:100,upload_size:0.5,memory_overallocate:25,daemon_listen:8080});
  assert.equal(payload.memory,8192);assert.equal(payload.disk,102400);assert.equal(payload.upload_size,512);
  assert.equal(payload.memory_overallocate,25);assert.equal(payload.daemon_listen,8080);
  assert.throws(()=>shared.normalize(specs,{...defaults,memory:0,disk:100}),/positive GB/);
});
test('node table capacity renderers use GB including sub-GB values',()=>{
  const {NodeList}=load('../src/admin/node-pairing.tsx',{
    react:{...React,useState:()=>[false,()=>{}]},'../Icons':{Icon:'i'},
    './shared':{...shared,useAPI:()=>({data:{data:[]},loading:false,error:''}),rows:()=>[{id:1,memory:8192,disk:512}]},
    './node-pairing.css':{},'./infrastructure-ui.css':{},
  });
  const table=allNodes(NodeList()).find(node=>node.type===shared.DataTable);
  assert.equal(table.props.columns.find(column=>column.label==='Memory').render({memory:8192}),'8 GB');
  assert.equal(table.props.columns.find(column=>column.label==='Disk').render({disk:512}),'0.5 GB');
});

