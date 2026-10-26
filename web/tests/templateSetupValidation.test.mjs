import test from 'node:test';
import assert from 'node:assert/strict';
import {templateSetupProblems} from '../src/client/templateSetupValidation.ts';
import {templateVariableProblem} from '../src/client/gameTemplateModel.ts';

const password={name:'Web portal password',env_variable:'WEB_PASSWORD',default_value:'',rules:'required|string|min:12|max:64'};
const ready=(overrides={})=>({name:'FS25 server',node:{setup_available:true},memory:8192,memoryMaximum:16384,disk:102400,diskMaximum:204800,imageValid:true,portsReady:true,portsLoading:false,portsError:false,steamError:false,privateContent:false,privateSupported:false,fs25:true,savedLicence:false,variables:[password],environment:{WEB_PASSWORD:'valid-fixture-password',GAME_SERIAL:'fixture-serial',AUTO_DOWNLOAD:'true'},...overrides});
test('short FS25 password explains the disabled button without echoing it',()=>{
 const value='test123';const problems=templateSetupProblems(ready({environment:{WEB_PASSWORD:value,GAME_SERIAL:'fixture',AUTO_DOWNLOAD:'true'}}));
 assert.deepEqual(problems,[{field:'game-template-WEB_PASSWORD',message:'Web portal password: Use at least 12 characters.'}]);assert.ok(!JSON.stringify(problems).includes(value));
});
test('valid FS25 setup, saved licence, and manual installer path can proceed',()=>{
 assert.deepEqual(templateSetupProblems(ready()),[]);
 for(const overrides of [{savedLicence:true,environment:{WEB_PASSWORD:'valid-fixture-password',AUTO_DOWNLOAD:'true'}},{environment:{WEB_PASSWORD:'valid-fixture-password',AUTO_DOWNLOAD:'false'}}])assert.deepEqual(templateSetupProblems(ready(overrides)),[]);
 assert.ok(templateSetupProblems(ready({environment:{WEB_PASSWORD:'valid-fixture-password',AUTO_DOWNLOAD:'true'}})).some(p=>p.message.includes('administrator')));
});
test('advanced variable failures are named and linked, including numeric bounds',()=>{
 const variable={name:'Savegame index',env_variable:'SAVEGAME_INDEX',default_value:'1',rules:'required|integer|between:1,20'};
 const problems=templateSetupProblems(ready({variables:[password,variable],environment:{WEB_PASSWORD:'valid-fixture-password',GAME_SERIAL:'fixture',SAVEGAME_INDEX:'21'}}));
 assert.deepEqual(problems,[{field:'game-template-SAVEGAME_INDEX',message:'Savegame index: Enter no more than 20.'}]);
 assert.equal(templateVariableProblem(variable,{SAVEGAME_INDEX:'1.5'}),'Enter a whole number.');
});
test('resource, host, runtime, and port blockers are explained',()=>{
 for(const [overrides,field] of [[{name:''},'game-server-name'],[{node:undefined},'game-server-node'],[{memory:20000},'game-server-memory'],[{disk:300000},'game-server-storage'],[{imageValid:false},'game-runtime-image'],[{portsLoading:true},'game-template-ports'],[{portsError:true},'game-template-ports']])assert.ok(templateSetupProblems(ready(overrides)).some(p=>p.field===field));
 assert.deepEqual(templateSetupProblems(ready({node:{setup_available:false,unavailable_reason:'Host offline'}})).map(p=>p.message),['Host offline']);
});
test('Steam and publisher agreement gates remain enforced',()=>{
 assert.ok(templateSetupProblems(ready({steamError:true})).some(p=>/Steam/.test(p.message)));
 assert.ok(templateSetupProblems(ready({privateContent:true})).some(p=>/trusted worker/.test(p.message)));
 assert.ok(templateSetupProblems(ready({agreements:[{environment:'EULA',title:'Terms',accept_value:'a'.repeat(64)}]})).some(p=>/publisher terms/.test(p.message)));
});
test('optional blanks stay optional; conditional and excluded values are checked safely',()=>{
 assert.equal(templateVariableProblem({env_variable:'DLC_PRODUCT_KEY',default_value:'',rules:'nullable|string|max:64'},{}),'');
 const conditional={env_variable:'EXTRA',default_value:'',rules:'required_if:environment.MODE,custom|string|not_in:forbidden'};
 assert.equal(templateVariableProblem(conditional,{MODE:'default'}),'');
 assert.equal(templateVariableProblem(conditional,{MODE:'custom'}),'Enter a value.');
 assert.match(templateVariableProblem(conditional,{MODE:'custom',EXTRA:'forbidden'}),/not allowed/);
});
test('length checks count characters and never return an entered secret',()=>{
 assert.equal(templateVariableProblem(password,{WEB_PASSWORD:'é'.repeat(12)}),'');
 const secret='private-fixture-value-that-is-too-long';
 const problems=templateSetupProblems(ready({environment:{WEB_PASSWORD:secret,GAME_SERIAL:'fixture'},variables:[{...password,rules:'required|string|max:12'}]}));
 assert.match(problems[0].message,/12 characters/);assert.ok(!JSON.stringify(problems).includes(secret));
});
