import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import * as steamModel from '../src/client/privateSteamTemplateModel.ts';
import * as templateModel from '../src/client/gameTemplateModel.ts';
import * as startupModel from '../src/client/startupSettingsModel.ts';
import * as setupModel from '../src/client/gameSetupModel.ts';
import * as setupValidation from '../src/client/templateSetupValidation.ts';
const require=createRequire(import.meta.url),source=fs.readFileSync(new URL('../src/client/TemplateGames.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function load(){
 const module={exports:{}},modules={'./GameSwitch':{GameSwitch:props=>React.createElement('input',{...props,type:'checkbox',role:'switch'})},
  react:React,'react-router-dom':{useNavigate:()=>()=>{},useParams:()=>({}),Link:'a'},
  '../lib':{api(){throw Error('No network in component fixture');},Button:({children,variant,...props})=>React.createElement('button',props,children),Card:'section',ErrorBox:({children})=>React.createElement('div',null,children),Field:({label,hint,children})=>React.createElement('label',null,label,children,hint),Input:'input',Select:'select',unwrap:x=>x},
  './common':{json:()=>{}},'./GameSetupFields':{GameAgreementField:()=>null,GameMemoryField:()=>null,GameNameField:()=>null,GameNodeField:()=>null},
  './startupSettingsModel':startupModel,'./gameSetupModel':setupModel,'./templateSetupValidation':setupValidation,'./SteamGames':{SteamSetupForm:()=>null},'./useGameRequest':{useGameRequest:()=>({})},'./gameTemplateModel':templateModel,
  './GamePorts':{GamePorts:()=>null,useGamePortPlan:()=>({data:{ports:[]},loading:false,error:''}),rememberInstallationPorts(){}},
  './GameLibraryCard':{GameLibraryCard:()=>null,gameArtwork:()=>null},'./gameLibraryOrder':{compareGamePopularity:()=>0},'./minecraftCommunityModel':{isMinecraftTemplate:()=>false,minecraftProjectKey:()=>''},'./minecraftCommunityArtwork.json':{},'./privateSteamTemplateModel':steamModel,
 };
 new Function('require','module','exports',compiled)(name=>Object.hasOwn(modules,name)?modules[name]:require(name),module,module.exports);return module.exports.TemplateSetupForm;
}
const variables=[{name:'Steam user',env_variable:'STEAM_USERNAME',default_value:'hidden-account',rules:'nullable|string|max:64',user_viewable:true},{name:'Steam password',env_variable:'STEAM_PASSWORD',default_value:'hidden-password',rules:'nullable|string|max:64',user_viewable:true},{name:'Steam Guard',env_variable:'STEAM_GUARDCODE',default_value:'hidden-code',rules:'nullable|string|max:6',user_viewable:true},{name:'Branch password',env_variable:'SRCDS_BETAPASS',default_value:'hidden-beta',rules:'nullable|string',user_viewable:true},{name:'Game player limit',env_variable:'MAX_PLAYER',default_value:'6',rules:'required|integer|min:1',user_viewable:true},{name:'Game password',env_variable:'PASSWORD',default_value:'game-only',rules:'nullable|string',user_viewable:true},{name:'Public branch',env_variable:'SRCDS_BETAID',default_value:'preview',rules:'nullable|string',user_viewable:true}];
function options(){return {id:'fixture',name:'KF2 fixture',description:'fixture',detail:'Not native proof',verification:'not_verified',source:'https://example.invalid',available:true,variables,nodes:[{id:1,name:'Fixture node',available_memory:65536,available_disk:131072,setup_available:true,allocations:[]}],images:[{label:'fixture',value:'fixture:image'}],defaults:{memory:4096,disk:65536},steam_installation:{default_mode:'public',private_candidate:true,private_supported:false,private_reason:'Publication policy pending review',controls:{},coverage:'pending'}};}
test('actual generic form defers KF2 game defaults and retains anonymous installation without Steam secrets',()=>{
 const html=renderToStaticMarkup(React.createElement(load(),{options:options()}));
 assert.match(html,/<option value="public" selected="">Anonymous Steam installation/);
 assert.doesNotMatch(html,/Game player limit|Game password|value="game-only"/);assert.match(html,/Public branch/);assert.match(html,/value="preview"/);
 assert.doesNotMatch(html,/hidden-account|hidden-password|hidden-code|hidden-beta/);
 assert.match(html,/Private support for this recipe is pending review/);
 assert.match(html,/>Create server<\/button>/);assert.doesNotMatch(html,/<button(?=[^>]*disabled)[^>]*>Create server/);
});
test('actual form retains Banana private default/readiness gating without enabling unregistered candidate policy',()=>{
 const value=options();value.private_content_supported=true;value.steam_installation={...value.steam_installation,default_mode:'private',private_supported:true,coverage:'reviewed'};
 const html=renderToStaticMarkup(React.createElement(load(),{options:value}));
 assert.match(html,/<option value="private" selected="">Use my Steam account after preparation/);
 assert.match(html,/Private Steam installation is not enabled on this node/);
 assert.match(html,/<button(?=[^>]*disabled)[^>]*>Create server/);
 const pending={...value,private_content_supported:false,steam_installation:{...value.steam_installation,private_supported:false,private_reason:'Publication policy pending review'}};
 const blocked=renderToStaticMarkup(React.createElement(load(),{options:pending}));assert.match(blocked,/Publication policy pending review/);assert.match(blocked,/<button(?=[^>]*disabled)[^>]*>Create server/);
 const trusted={...value,nodes:value.nodes.map(node=>({...node,private_content_ready:true}))};
 const allowed=renderToStaticMarkup(React.createElement(load(),{options:trusted}));
 assert.doesNotMatch(allowed,/<button(?=[^>]*disabled)[^>]*>Create server/);
 const unsupportedTrusted={...pending,nodes:trusted.nodes};
 const unsupported=renderToStaticMarkup(React.createElement(load(),{options:unsupportedTrusted}));
 assert.match(unsupported,/<button(?=[^>]*disabled)[^>]*>Create server/);
});



test('required template input without a valid default stays in the shorter creation form',()=>{
 const value=options();value.variables=[...value.variables,{name:'Required installation input',env_variable:'INSTALL_KEY',default_value:'',rules:'required|string',user_viewable:true}];
 const html=renderToStaticMarkup(React.createElement(load(),{options:value}));
 assert.match(html,/Required installation input/);assert.match(html,/<button(?=[^>]*disabled)[^>]*>Create server/);
});
