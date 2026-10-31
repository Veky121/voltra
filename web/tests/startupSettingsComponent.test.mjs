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
  const modules = {'./settingDescription':{settingDescription:text=>text}, './PendingSettings':{PendingSettings:({children})=>children,usePendingSetting(){}},'./GameSwitch':{GameSwitch:props=>React.createElement('input',{...props,type:'checkbox',role:'switch'})},
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

const render = (options = {}) => renderToStaticMarkup(React.createElement(load(options).default, {section:options.section || 'runtime'}));

test('settings have a short description, right-hand key, rules and default without individual actions',()=>{
 const html=render({section:'game',variables:[{...baseVariable,description:'Maximum number of players.'}]});
 assert.match(html,/Maximum number of players/);
 assert.match(html,/startup-variable-key[^>]*>MAX_PLAYERS/);
 assert.match(html,/Rules: required\|integer\|min:1\|max:64/);
 assert.match(html,/Default: 8/);
 assert.doesNotMatch(html,/Reset to template|Discard draft|>Save<|<form/);
});
test('password fields show validation rules while concealing stored values and defaults',()=>{
 const html=render({section:'game'});
 assert.doesNotMatch(html,/value="another-secret"|Default: do-not-show/);
 assert.match(html,/Rules: nullable\|string\|in:do-not-show,another-secret/);
 assert.match(html,/Default: Hidden/);
 assert.match(html,/type="password"/);
});
test('read-only and permission gates are preserved',()=>{
 assert.match(render({section:'game',permissions:['startup.read']}),/disabled/);
 assert.doesNotMatch(render({section:'game',permissions:[]}),/MAX_PLAYERS/);
});
test('client settings omit licences',()=>{
 const html=render({section:'game',variables:[baseVariable,...['GAME_SERIAL','DLC_PRODUCT_KEY'].map(env_variable=>({...secretVariable,env_variable}))]});
 assert.doesNotMatch(html,/GAME_SERIAL|DLC_PRODUCT_KEY|Game licence/);
});
