import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as model from '../src/client/startupSettingsModel.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/client/ServerStartup.tsx',import.meta.url),'utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const baseVariable = {env_variable:'MAX_PLAYERS',name:'Player limit',rules:'required|integer|min:1|max:64',default_value:'8',server_value:'16',is_editable:true,is_overridden:true};
const secretVariable = {env_variable:'RCON_PASSWORD',name:'Console password',rules:'nullable|string|in:do-not-show,another-secret',default_value:'do-not-show',server_value:'another-secret',is_editable:true,secret:true,secret_configured:true,is_overridden:true};

function load({react = React,variables = [baseVariable,secretVariable],meta = {},permissions = ['*'],account = {},accountLoading = false,accountError = ''} = {}) {
  const context = {base:'/api/client/servers/fixture',server:{image:'runtime:v1',limits:{memory:4096}},permissions,reload(){}};
  const module = {exports:{}};
  const modules = {'./GameSwitch':{GameSwitch:props=>React.createElement('input',{...props,type:'checkbox',role:'switch'})},
    react,
    'react-router-dom':{Link:({to,children,...props})=>React.createElement('a',{href:to,...props},children)},
    '../lib':{
      api(){throw new Error('No real API calls allowed in this fixture.');},
      Button:({variant,children,...props})=>React.createElement('button',{type:'button',...props},children),
      Card:'section',Input:'input',Select:'select',
      useAPI(path){return path === '/api/client/account'
        ? {data:{attributes:account},loading:accountLoading,error:accountError,reload(){}}
        : {data:{data:variables.map(attributes=>({attributes})),meta},loading:false,error:'',reload(){}};},
    },
    './common':{
      can:(perms,permission)=>perms.includes('*')||perms.includes(permission),
      items:data=>data.data.map(item=>item.attributes),
      json:(method,body)=>({method,body:JSON.stringify(body)}),
      PageError:({error})=>error ? React.createElement('p',{role:'alert'},error) : null,
      useServer:()=>context,
      value:data=>data?.attributes ?? data,
    },
    './JavaSettings':{JavaSettings:({canChangeRuntime})=>React.createElement('div',{'data-java-runtime-allowed':String(canChangeRuntime)})},
    './startupSettingsModel':model,
    './startupSettings.css':{},
  };
  new Function('require','module','exports',compiled)(name=>Object.hasOwn(modules,name)?modules[name]:require(name),module,module.exports);
  return module.exports;
}

const render = options => renderToStaticMarkup(React.createElement(load(options).default));

test('render has named typed controls, masked secrets, separate save buttons and collapsed details', () => {
  const html = render({meta:{raw_startup_command:'run --players {{MAX_PLAYERS}} --password {{RCON_PASSWORD}} do-not-show another-secret'}});
  assert.match(html,/<input(?=[^>]*name="MAX_PLAYERS")(?=[^>]*type="number")[^>]*>/);
  assert.match(html,/<input(?=[^>]*name="RCON_PASSWORD")(?=[^>]*type="password")(?=[^>]*value="")[^>]*>/);
  assert.match(html,/Save value/);
  assert.match(html,/Reset to template default/);
  assert.match(html,/Template default/);
  assert.match(html,/Server override/);
  assert.match(html,/Saving does not restart or reinstall it/);
  assert.match(html,/<details class="startup-preview card">/);
  assert.match(html,/<details class="startup-advanced card">/);
  assert.doesNotMatch(html,/<details[^>]*\bopen\b/);
  assert.doesNotMatch(html,/do-not-show|another-secret/);
  assert.doesNotMatch(html,/textarea|Save all|Admin tools/);
});

test('read-only variables render without save, clear or reset actions', () => {
  const html = render({permissions:['startup.read'],meta:{java_managed:true}});
  assert.match(html,/Read-only/);
  assert.match(html,/<input(?=[^>]*name="MAX_PLAYERS")(?=[^>]*disabled)[^>]*>/);
  assert.doesNotMatch(html,/Save value|Clear value|Reset to template default|startup-advanced/);
  assert.match(html,/data-java-runtime-allowed="false"/);
  const denied = render({permissions:[]});
  assert.match(denied,/do not have permission/);
  assert.doesNotMatch(denied,/MAX_PLAYERS|RCON_PASSWORD|Command preview/);
});

test('template read-only is respected independently of account startup permission', () => {
  const html = render({variables:[{...baseVariable,is_editable:false}]});
  assert.match(html,/<input(?=[^>]*name="MAX_PLAYERS")(?=[^>]*disabled)[^>]*>/);
  assert.doesNotMatch(html,/Reset to template default/);
  assert.doesNotMatch(render({variables:[{...baseVariable,can_reset:false}]}),/Reset to template default/);
});

test('managed Java image is never exposed through the raw runtime selector', () => {
  const html = render({meta:{java_managed:true}});
  assert.doesNotMatch(html,/startup-advanced|Save image/);
  assert.match(html,/data-java-runtime-allowed="true"/);
  const restricted = render({permissions:['startup.read','startup.update'],meta:{java_managed:true}});
  assert.match(restricted,/data-java-runtime-allowed="false"/);
});

test('admin link requires a successful finished account response with boolean root_admin', () => {
  assert.match(render({account:{root_admin:true}}),/href="..\/admin-tools"/);
  for (const options of [{account:{root_admin:false}},{account:{root_admin:'true'}},{account:{root_admin:true},accountLoading:true},{account:{root_admin:true},accountError:'Denied'}]) assert.doesNotMatch(render(options),/Admin tools/);
});

// A small hook runner exercises field event handlers without a browser or network.
function fieldHarness(initial, save) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let variable = initial;
  const reports = [];
  const onDirty = (key,dirty)=>reports.push({key,dirty});
  const react = {
    ...React,
    useState(initial){
      const index = cursor++;
      if (!slots[index]) slots[index] = {value:typeof initial === 'function' ? initial() : initial};
      return [slots[index].value,next=>{slots[index].value=typeof next === 'function'?next(slots[index].value):next;}];
    },
    useRef(initial){const index=cursor++;return slots[index] ??= {current:initial};},
    useEffect(effect,deps){
      const index=cursor++;
      const old=slots[index];
      if (!old || deps.some((value,key)=>value!==old.deps[key])) effects.push(()=>{
        old?.cleanup?.();slots[index]={deps,cleanup:effect()};
      });
    },
  };
  const Field = load({react}).StartupVariableField;
  const harness = {
    reports,
    render(next){
      if (next) variable=next;
      cursor=0;effects=[];
      const tree=Field({variable,permitted:true,onSave:save,onDirty});
      for (const effect of effects) effect();
      return tree;
    },
  };
  return harness;
}
function all(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree,...React.Children.toArray(tree.props?.children).flatMap(all)];
}
const input = tree=>all(tree).find(node=>node.type==='input');
const button = (tree,text)=>all(tree).find(node=>node.props?.children===text);
const tick = ()=>new Promise(resolve=>setImmediate(resolve));

test('a field saves only its own draft, stays busy until confirmation and resets only explicitly', async () => {
  const writes=[];
  let confirm;
  const harness=fieldHarness(baseVariable,payload=>{writes.push(payload);return new Promise(resolve=>{confirm=resolve;});});
  input(harness.render()).props.onChange({target:{value:'32'}});
  let tree=harness.render();
  assert.equal(button(tree,'Save').props.disabled,false);
  tree.props.onSubmit({preventDefault(){}});
  tree=harness.render();
  assert.equal(tree.props['aria-busy'],true);
  assert.equal(input(tree).props.disabled,true);
  tree.props.onSubmit({preventDefault(){}});
  assert.deepEqual(writes,[{key:'MAX_PLAYERS',value:'32'}]);
  const saved={...baseVariable,server_value:'32'};
  confirm(saved);await tick();
  tree=harness.render(saved);tree=harness.render();
  assert.equal(button(tree,'Save').props.disabled,true);
  assert.equal(tree.props['aria-busy'],false);
  button(tree,'Reset to template default').props.onClick();
  assert.deepEqual(writes[1],{key:'MAX_PLAYERS',reset:true});
  confirm({...baseVariable,server_value:'8',is_overridden:false});await tick();
});

test('server refresh keeps unsaved drafts, while clean fields follow saved values', () => {
  const harness=fieldHarness(baseVariable,async()=>{throw new Error('unexpected save');});
  input(harness.render()).props.onChange({target:{value:'24'}});
  harness.render({...baseVariable,server_value:'32'});
  assert.equal(input(harness.render()).props.value,'24');
  const clean=fieldHarness(baseVariable,async()=>baseVariable);
  clean.render();clean.render({...baseVariable,server_value:'48'});
  assert.equal(input(clean.render()).props.value,'48');
});

test('secret starts blank, blank submit does nothing, clear is explicit, and failed writes preserve the draft', async () => {
  const writes=[];
  const harness=fieldHarness(secretVariable,async payload=>{writes.push(payload);throw new Error('backend echoed private-input');});
  let tree=harness.render();
  assert.equal(input(tree).props.value,'');
  tree.props.onSubmit({preventDefault(){}});await tick();
  assert.deepEqual(writes,[]);
  input(tree).props.onChange({target:{value:'private-input'}});
  tree=harness.render();tree.props.onSubmit({preventDefault(){}});await tick();
  tree=harness.render();
  assert.deepEqual(writes,[{key:'RCON_PASSWORD',value:'private-input'}]);
  assert.equal(input(tree).props.value,'private-input');
  assert.match(all(tree).find(node=>node.props?.role==='alert').props.children,/Could not save this secret/);
  assert.doesNotMatch(all(tree).find(node=>node.props?.role==='alert').props.children,/private-input/);
  button(tree,'Clear value').props.onClick();await tick();
  assert.deepEqual(writes[1],{key:'RCON_PASSWORD',value:''});
});


test('actual startup boolean enum renders an accessible switch',()=>{
 const html=renderToStaticMarkup(React.createElement(load().StartupVariableField,{variable:{...baseVariable,env_variable:'ENABLE_PVP',name:'Enable PVP',rules:'required|in:0,1',server_value:'1'},permitted:true,onSave(){},onDirty(){}}));
 assert.match(html,/role="switch"/);
 assert.match(html,/type="checkbox"/);
 assert.doesNotMatch(html,/<select/);
});
