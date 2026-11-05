import * as settingDescription from '../src/client/settingDescription.ts';
import test from 'node:test';
import * as resourceUnits from '../src/resourceUnits.ts';
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
import * as cfxAdmission from '../src/client/cfxAdmission.ts';
const require=createRequire(import.meta.url),source=fs.readFileSync(new URL('../src/client/TemplateGames.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function load(){
 const module={exports:{}},modules={'./settingDescription':settingDescription,'../ui/PageHeading':{PageHeading:({children})=>React.createElement('header',null,children)},'../ui/Disclosure':{Disclosure:'details',DisclosureTrigger:'summary'},'./cfxAdmission':cfxAdmission,'../resourceUnits.ts':resourceUnits,'./GameSwitch':{GameSwitch:props=>React.createElement('input',{...props,type:'checkbox',role:'switch'})},
  react:React,'react-router-dom':{useNavigate:()=>()=>{},useParams:()=>({}),Link:'a'},
  '../lib':{api(){throw Error('No network in component fixture');},Button:({children,variant,...props})=>React.createElement('button',props,children),Card:'section',ErrorBox:({children})=>React.createElement('div',null,children),Field:({label,hint,children})=>React.createElement('label',null,label,children,hint),Input:'input',Select:'select',unwrap:x=>x},
  './common':{json:()=>{}},'./GameSetupFields':{GameAgreementField:()=>null,GameMemoryField:({value})=>React.createElement('input',{'data-fixture':'memory',value,readOnly:true}),GameNameField:()=>null,GameNodeField:({value})=>React.createElement('input',{'data-fixture':'node',value,readOnly:true})},
  './startupSettingsModel':startupModel,'./gameSetupModel':setupModel,'./templateSetupValidation':setupValidation,'./SteamGames':{SteamSetupForm:()=>null},'./useGameRequest':{useGameRequest:()=>({})},'./gameTemplateModel':templateModel,
  './GamePorts':{GamePorts:()=>null,useGamePortPlan:()=>({data:{ports:[]},loading:false,error:''}),rememberInstallationPorts(){}},
  './GameLibraryCard':{GameLibraryCard:()=>null,gameArtwork:()=>null},'./gameLibraryOrder':{compareGamePopularity:()=>0},'./minecraftCommunityModel':{isMinecraftTemplate:()=>false,minecraftProjectKey:()=>''},'./minecraftCommunityArtwork.json':{},'./privateSteamTemplateModel':steamModel,
 };
 new Function('require','module','exports',compiled)(name=>Object.hasOwn(modules,name)?modules[name]:require(name),module,module.exports);return module.exports.TemplateSetupForm;
}
const variables=[{name:'Steam user',env_variable:'STEAM_USERNAME',default_value:'hidden-account',rules:'nullable|string|max:64',user_viewable:true},{name:'Steam password',env_variable:'STEAM_PASSWORD',default_value:'hidden-password',rules:'nullable|string|max:64',user_viewable:true},{name:'Steam Guard',env_variable:'STEAM_GUARDCODE',default_value:'hidden-code',rules:'nullable|string|max:6',user_viewable:true},{name:'Branch password',env_variable:'SRCDS_BETAPASS',default_value:'hidden-beta',rules:'nullable|string',user_viewable:true},{name:'Game player limit',env_variable:'MAX_PLAYER',default_value:'6',rules:'required|integer|min:1',user_viewable:true},{name:'Game password',env_variable:'PASSWORD',default_value:'game-only',rules:'nullable|string',user_viewable:true},{name:'Public branch',env_variable:'SRCDS_BETAID',default_value:'preview',rules:'nullable|string',user_viewable:true}];

test('Sven catalog limits expose invalid defaults before creation and retain valid deferred controls',()=>{
 const catalog=JSON.parse(fs.readFileSync(new URL('../../internal/panel/game_library/overrides.json',import.meta.url),'utf8'));
 const controls=catalog['svencoop/egg-sven-co-op.json'].egg.variables;
 for(const [key,limit] of [['SC_NAME',40],['SC_PASSWORD',20]]){
  const control=controls.find(variable=>variable.env_variable===key);
  assert.ok(control);
  const ready=options();ready.variables=[{...control,default_value:'x'.repeat(limit)}];
  const valid=renderToStaticMarkup(React.createElement(load(),{options:ready}));
  assert.doesNotMatch(valid,/<button(?=[^>]*disabled)[^>]*>Create server/);
  const invalid=options();invalid.variables=[{...control,default_value:'x'.repeat(limit+1)}];
  const html=renderToStaticMarkup(React.createElement(load(),{options:invalid}));
  assert.match(html,/<button(?=[^>]*disabled)[^>]*>Create server/);
  assert.ok(html.includes(`id="game-template-${key}"`));
  assert.ok(html.includes(`maxLength="${limit}"`));
  assert.ok(html.includes(`Use no more than ${limit} characters.`));
  if(key==='SC_PASSWORD')assert.match(html,/<input(?=[^>]*id="game-template-SC_PASSWORD")(?=[^>]*type="password")[^>]*>/);
 }
});

test('conditional token prerequisite exposes its mode selector so offline creation is usable',()=>{
 const variables=[{name:'Online mode',env_variable:'ONLINE_MODE',default_value:'1',rules:'required|boolean',user_viewable:true},
  {name:'Cluster token',env_variable:'SERVER_TOKEN',default_value:'',rules:'nullable|required_if:environment.ONLINE_MODE,1|string|max:2048',user_viewable:true}];
 const online=options();online.variables=variables;
 const blocked=renderToStaticMarkup(React.createElement(load(),{options:online}));
 assert.ok(blocked.includes('id="game-template-ONLINE_MODE"'));
 assert.ok(blocked.includes('id="game-template-SERVER_TOKEN"'));
 assert.match(blocked,/<button(?=[^>]*disabled)[^>]*>Create server/);
 const offline=options();offline.variables=variables.map(v=>v.env_variable==='ONLINE_MODE'?{...v,default_value:'0'}:v);
 const allowed=renderToStaticMarkup(React.createElement(load(),{options:offline}));
 assert.ok(allowed.includes('id="game-template-ONLINE_MODE"'));
 assert.doesNotMatch(allowed,/<button(?=[^>]*disabled)[^>]*>Create server/);
});
function options(){return {id:'fixture',name:'KF2 fixture',description:'fixture',detail:'Not native proof',verification:'not_verified',source:'https://example.invalid',available:true,variables,nodes:[{id:1,name:'Fixture node',available_memory:65536,available_disk:131072,setup_available:true,allocations:[]}],images:[{label:'fixture',value:'fixture:image'}],defaults:{memory:4096,disk:65536},steam_installation:{default_mode:'public',private_candidate:true,private_supported:false,private_reason:'Publication policy pending review',controls:{},coverage:'pending'}};}
test('actual generic form defers KF2 game defaults and retains anonymous installation without Steam secrets',()=>{
 const html=renderToStaticMarkup(React.createElement(load(),{options:options()}));
 assert.match(html,/<option value="public" selected="">Anonymous Steam installation/);
 assert.doesNotMatch(html,/Game player limit|Game password|value="game-only"/);assert.match(html,/Public branch/);assert.match(html,/value="preview"/);
 assert.doesNotMatch(html,/hidden-account|hidden-password|hidden-code|hidden-beta/);
 assert.doesNotMatch(html,/Publication policy pending review|Private support for this recipe is pending review/);
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

test('creation prefers a node that fits the reviewed resource defaults',()=>{
 const value=options();value.defaults={memory:16384,disk:35840};
 value.nodes=[{...value.nodes[0],id:1,available_memory:8192},{...value.nodes[0],id:2,available_memory:32768}];
 const html=renderToStaticMarkup(React.createElement(load(),{options:value}));
 assert.match(html,/<input(?=[^>]*data-fixture="node")(?=[^>]*value="2")[^>]*>/);
 assert.match(html,/<input(?=[^>]*data-fixture="memory")(?=[^>]*value="16")[^>]*>/);
});

test('insufficient capacity keeps defaults visible and requires an explicit choice',()=>{
 const value=options();value.defaults={memory:16384,disk:35840};
 value.nodes=[{...value.nodes[0],available_memory:8192,available_disk:16384}];
 const html=renderToStaticMarkup(React.createElement(load(),{options:value}));
 assert.match(html,/<input(?=[^>]*data-fixture="memory")(?=[^>]*value="16")[^>]*>/);
 assert.match(html,/<input(?=[^>]*id="game-server-storage")(?=[^>]*value="35")[^>]*>/);
 assert.match(html,/<button(?=[^>]*disabled)[^>]*>Create server/);
 assert.match(html,/Lower the limits or choose another node/);
});

test('explicit installation acknowledgement stays visible and starts unaccepted',()=>{
 const value=options();
 value.variables=[...value.variables,{name:'Review runtime prerequisites',description:'Review the runtime terms before installing.',env_variable:'ACCEPT_WINDOWS_RUNTIME_LICENSES',default_value:'false',rules:'required|string|in:true,false',user_viewable:true}];
 const html=renderToStaticMarkup(React.createElement(load(),{options:value}));
 assert.match(html,/Review runtime prerequisites/);
 assert.match(html,/Review the runtime terms before installing/);
 assert.match(html,/<button(?=[^>]*disabled)[^>]*>Create server/);
 assert.doesNotMatch(html,/<input(?=[^>]*id="game-template-ACCEPT_WINDOWS_RUNTIME_LICENSES")(?=[^>]*\bchecked="")[^>]*>/);
});

test('legacy installation prerequisite remains visible and requires explicit acknowledgement',()=>{
 const value=options();
 value.variables=[...value.variables,{name:'Acknowledge legacy prerequisites',description:'Review the legacy prerequisites.',env_variable:'ACKNOWLEDGE_LEGACY_PREREQUISITES',default_value:'false',rules:'required|string|in:true,false',user_viewable:true}];
 const html=renderToStaticMarkup(React.createElement(load(),{options:value}));
 assert.match(html,/Acknowledge legacy prerequisites/);
 assert.match(html,/<button(?=[^>]*disabled)[^>]*>Create server/);
 assert.doesNotMatch(html,/<input(?=[^>]*id="game-template-ACKNOWLEDGE_LEGACY_PREREQUISITES")(?=[^>]*\bchecked="")[^>]*>/);
});

test('optional SCP publisher acceptance stays visible and off without blocking Console acceptance',()=>{
 const value=options();
 value.variables=[...value.variables,{name:'Accept SCP:SL EULA',description:'Default off; LocalAdmin prompts in Console.',env_variable:'SCPSL_ACCEPT_EULA',default_value:'0',rules:'required|boolean',user_viewable:true}];
 const html=renderToStaticMarkup(React.createElement(load(),{options:value}));
 assert.match(html,/Accept SCP:SL EULA/);
 assert.match(html,/LocalAdmin prompts in Console/);
 assert.doesNotMatch(html,/<button(?=[^>]*disabled)[^>]*>Create server/);
 assert.doesNotMatch(html,/<input(?=[^>]*id="game-template-SCPSL_ACCEPT_EULA")(?=[^>]*\bchecked="")[^>]*>/);
});


test('actual Cfx form keeps the selector and capacity editable and rejects dependent RedM defaults',()=>{
 for(const [game,capacity,blocked] of [['redm','48',true],['redm','32',false],['fivem','48',false]]){
  const ready=options();ready.id=cfxAdmission.fiveMTemplateID;ready.name='Cfx fixture';
  ready.variables=[{name:'Selected game',env_variable:'TXHOST_GAME_NAME',default_value:game,rules:'required|string|in:fivem,redm',user_viewable:true,user_editable:true},
   {name:'Player capacity',env_variable:'MAX_PLAYERS',default_value:capacity,rules:'required|integer|min:1|max:48',user_viewable:true,user_editable:true}];
  const html=renderToStaticMarkup(React.createElement(load(),{options:ready}));
  assert.ok(html.includes('id="game-template-TXHOST_GAME_NAME"'));
  assert.ok(html.includes('id="game-template-MAX_PLAYERS"'));
  if(blocked){
   assert.match(html,/<button(?=[^>]*disabled)[^>]*>Create server/);
   assert.match(html,/RedM requires a capacity between 1 and 32/);
  }else{
   assert.doesNotMatch(html,/<button(?=[^>]*disabled)[^>]*>Create server/);
   assert.doesNotMatch(html,/RedM requires a capacity between 1 and 32/);
  }
 }
});
